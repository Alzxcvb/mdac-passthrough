// Round 2 of API probing now that we know the place-transport pattern.
// Try transportId 1-5, hunt for vessel-type / transport-mode endpoints, and
// re-attempt submit-style endpoints with body shapes we've seen.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon/api";

const PROBES_PT = [1, 2, 3, 4, 5].map((id) => ({
  url: "/api/master-dropdown/place-transport",
  body: { deviceLang: "EN", transportId: String(id) },
  tag: `place-transport-${id}`,
}));

const PROBES_GUESS = [
  { url: "/api/master-dropdown/transport-mode", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/transport", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/sea-vessel", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/transport-vessel", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/sea-transport-type", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/vessel-type-transport", body: { deviceLang: "EN", transportId: "3" } },
  { url: "/api/master-dropdown/transport-type", body: { deviceLang: "EN", transportId: "1" } },
  { url: "/api/master-dropdown/transport-type", body: { deviceLang: "EN", transportId: "3" } },
  { url: "/api/master-dropdown/visa-type", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/visa", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/kitas-kitap", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/immigration", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/immigration-office-by-city", body: { deviceLang: "EN", cityId: "b1fb33d3-f91d-4765-8ee5-a77c3525fa11" } },
  { url: "/api/master-dropdown/airline-by-airport", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/airline", body: { deviceLang: "EN", code: "CM" } },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.connectOverCDP(CDP);
  const cleanCtx = await browser.newContext();

  const all = [...PROBES_PT, ...PROBES_GUESS];
  const winners = [];
  for (const p of all) {
    const url = "https://allindonesia.imigrasi.go.id" + p.url;
    try {
      const r = await cleanCtx.request.post(url, { data: p.body, headers: { "content-type": "application/json" }, timeout: 10000 });
      const status = r.status();
      const text = await r.text();
      let data = null; try { data = JSON.parse(text); } catch {}
      const rc = data?.responseCode;
      const td = data?.transactionDetail;
      const rows = Array.isArray(td) ? td : (Array.isArray(td?.data) ? td.data : null);
      const count = rows ? rows.length : 0;
      const ok = status === 200 && rc === "00" && count > 0;
      if (ok) {
        winners.push({ probe: p, count, sample: rows[0], file: p.tag || p.url.replace(/\//g, "_") });
        console.log(`  ✓ ${p.url} ${JSON.stringify(p.body)} → ${count} rows. sample:`, JSON.stringify(rows[0]).slice(0, 100));
        const fname = (p.tag || p.url.split("/").pop()) + ".json";
        fs.writeFileSync(path.join(OUT, fname), JSON.stringify(data, null, 2));
      } else {
        console.log(`  ${status} ${p.url} ${JSON.stringify(p.body)} rc=${rc} rows=${count}`);
      }
    } catch (err) {
      console.log("ERR " + p.url + " " + String(err).slice(0, 80));
    }
  }

  fs.writeFileSync(path.join(OUT, "_probe2-winners.json"), JSON.stringify(winners, null, 2));
  console.log("\nWinners:");
  for (const w of winners) console.log(`  ${w.probe.url}  ${JSON.stringify(w.probe.body)} → ${w.count} rows`);

  await cleanCtx.close();
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
