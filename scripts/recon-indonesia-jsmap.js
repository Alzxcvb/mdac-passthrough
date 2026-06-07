// Pull the JS chunks loaded by the SPA, grep them for /api/ endpoint strings.
// Helps surface the final submit URL without having to click Submit.
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

  // Find all loaded JS scripts.
  const scripts = await page.evaluate(() => {
    return [...document.querySelectorAll("script[src]")].map((s) => s.src).filter((s) => s.startsWith("http"));
  });
  console.log("scripts loaded:", scripts.length);

  // Use a clean context to fetch each (no auth needed for static JS).
  const cleanCtx = await browser.newContext();
  const allEndpoints = new Set();
  for (const u of scripts) {
    try {
      const r = await cleanCtx.request.get(u, { timeout: 15000 });
      if (r.status() !== 200) continue;
      const text = await r.text();
      const matches = text.match(/\/api\/[a-z0-9/_\-]+/gi) || [];
      for (const m of matches) allEndpoints.add(m);
      console.log(`  ${u.split("/").pop().slice(0, 60)} : ${matches.length} matches`);
    } catch (e) {
      console.log("  err:", u, String(e).slice(0, 80));
    }
  }
  const sorted = [...allEndpoints].sort();
  fs.writeFileSync(path.join(OUT, "js-endpoints.json"), JSON.stringify(sorted, null, 2));
  console.log("\n=== unique /api/ endpoints found in JS:", sorted.length);
  for (const e of sorted) console.log("  ", e);

  await cleanCtx.close();
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
