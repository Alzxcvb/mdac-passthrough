// Try to decode the wg() string table by running it from inside the live
// page context. The minified code defines wg=xg, where xg is a webpack
// string-lookup function. If wg is exposed on window, we can call it directly.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon";

(async () => {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("allindonesia.imigrasi.go.id"));
  if (!page) { console.error("no tab"); process.exit(2); }

  // wg is likely inside a webpack closure. Approach: read the JS source from
  // disk, locate the wg/xg function definitions, eval them in isolation.
  const js = fs.readFileSync(path.join(OUT, "main.js"), "utf8");

  // Find the xg function — it's the runtime string lookup.
  // Webpack pattern: function xg(){var e=[...strings...];return (xg=function(t){return e[t-X]})(...);}
  const xgRegex = /function (\w+)\(\)\{var \w+=(\[(?:"[^"]*",?){50,}\]);return \(\w+=function\(\w+\)\{return \w+\[\w+-(\d+)\]\}\)/;
  const m = js.match(xgRegex);
  if (m) {
    console.log("found xg-style table at offset", js.indexOf(m[0]));
    console.log("offset constant:", m[3]);
  } else {
    console.log("xg pattern not found — checking simpler patterns");
  }

  // Alternative: any function that has "var X=[" with hundreds of strings.
  const tableRegex = /var (\w+)=\[((?:"[^"]*"(?:,|\]))){150,}/g;
  const tables = [...js.matchAll(tableRegex)];
  console.log("string-table candidates:", tables.length);
  for (const t of tables.slice(0, 5)) {
    const sample = t[0].slice(0, 200);
    console.log("  candidate var name:", t[1], "sample:", sample.slice(0, 80) + "...");
  }

  // Best path: run wg(176) etc. inside the page. Try to find wg on window.
  const out = await page.evaluate(() => {
    const w = window;
    const candidates = [];
    for (const key of Object.keys(w)) {
      try {
        const v = w[key];
        if (typeof v === "function" && v.length === 1) {
          // try v(176) — if it returns a string, plausible.
          const r = v(176);
          if (typeof r === "string" && r.length > 2 && r.length < 100) {
            candidates.push({ key, sample: r });
          }
        }
      } catch (_) {}
    }
    return candidates;
  });
  console.log("window-level fn candidates:", out.length);
  for (const c of out.slice(0, 10)) console.log(`  ${c.key} → "${c.sample}"`);

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
