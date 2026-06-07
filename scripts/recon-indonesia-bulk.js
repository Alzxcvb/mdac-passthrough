// Dump every working /api/master-dropdown endpoint we know of, plus probe
// new variants. Save full responses to disk for adapter use.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon/api";

const KNOWN = [
  { name: "province", url: "/api/master-dropdown/province", body: { deviceLang: "EN" } },
  { name: "country", url: "/api/master-dropdown/country", body: { deviceLang: "EN" } },
  { name: "city", url: "/api/master-dropdown/city", body: { deviceLang: "EN" } },
  { name: "purpose-travel", url: "/api/master-dropdown/purpose-travel", body: { deviceLang: "EN" } },
  { name: "residence-type", url: "/api/master-dropdown/residence-type", body: { deviceLang: "EN" } },
  { name: "gender", url: "/api/master-dropdown/gender", body: { deviceLang: "EN" } },
  { name: "air-flight", url: "/api/master-dropdown/air-flight", body: { deviceLang: "EN" } },
];

const PROBES_MORE = [
  "/api/master-dropdown/transport-type",
  "/api/master-dropdown/transport-air-type",
  "/api/master-dropdown/transport-sea-type",
  "/api/master-dropdown/mode-of-transport",
  "/api/master-dropdown/place-arrival-air",
  "/api/master-dropdown/place-arrival-sea",
  "/api/master-dropdown/airport-arrival",
  "/api/master-dropdown/seaport-arrival",
  "/api/master-dropdown/sea-vessel-type",
  "/api/master-dropdown/air-transport",
  "/api/master-dropdown/sea-transport",
  "/api/master-dropdown/visa",
  "/api/master-dropdown/visa-stay-permit",
  "/api/master-dropdown/kitas",
  "/api/master-dropdown/kitap",
  "/api/master-dropdown/airline-iata",
  "/api/master-dropdown/iata",
  "/api/master-dropdown/flight-name",
  "/api/master-dropdown/airport-iata",
  // submit candidates
  "/api/spi/submit",
  "/api/foreigner/submit",
  "/api/std/submit",
  "/api/smta/submit",
  "/api/arrival-card/foreigner-individual/submit",
  "/api/foreigner-individual/submit",
  // retrieve / lookup
  "/api/arrival-card/retrieve",
  "/api/arrival-card/lookup",
  "/api/arrival-card/get",
  "/api/foreigner-individual/get",
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.connectOverCDP(CDP);
  const cleanCtx = await browser.newContext();

  const summary = [];

  // 1. Dump all known endpoints to disk.
  for (const e of KNOWN) {
    const url = "https://allindonesia.imigrasi.go.id" + e.url;
    try {
      const r = await cleanCtx.request.post(url, { data: e.body, headers: { "content-type": "application/json" }, timeout: 15000 });
      const status = r.status();
      const text = await r.text();
      const data = JSON.parse(text);
      const td = data.transactionDetail;
      const rows = Array.isArray(td) ? td : (Array.isArray(td?.data) ? td.data : []);
      fs.writeFileSync(path.join(OUT, `${e.name}.json`), JSON.stringify(data, null, 2));
      summary.push({ name: e.name, url: e.url, status, rc: data.responseCode, rows: rows.length, sampleKeys: rows[0] ? Object.keys(rows[0]) : null });
      console.log(`  ${e.name}: ${rows.length} rows. keys: ${rows[0] ? Object.keys(rows[0]).join(",") : "—"}`);
    } catch (err) {
      summary.push({ name: e.name, error: String(err).slice(0, 100) });
      console.log("ERR", e.name, String(err).slice(0, 80));
    }
  }

  // 2. Probe more endpoints.
  console.log("\n=== probing more endpoints ===");
  const more = [];
  for (const u of PROBES_MORE) {
    const url = "https://allindonesia.imigrasi.go.id" + u;
    try {
      const r = await cleanCtx.request.post(url, { data: { deviceLang: "EN" }, headers: { "content-type": "application/json" }, timeout: 8000 });
      const status = r.status();
      const text = (await r.text()).slice(0, 1000);
      let data = null;
      try { data = JSON.parse(text); } catch {}
      const rc = data?.responseCode;
      const td = data?.transactionDetail;
      const rows = Array.isArray(td) ? td.length : (Array.isArray(td?.data) ? td.data.length : 0);
      more.push({ url: u, status, rc, rows, sample: text.slice(0, 300) });
      if (status === 200 && rc === "00" && rows > 0) {
        console.log(`  ✓ ${u} ${rows} rows`);
      } else if (status === 200) {
        console.log(`  ${status}  ${u}  rc=${rc} rows=${rows}`);
      } else {
        console.log(`  ${status}  ${u}`);
      }
    } catch (err) {
      more.push({ url: u, error: String(err).slice(0, 100) });
    }
  }

  fs.writeFileSync(path.join(OUT, "_summary.json"), JSON.stringify({ known: summary, probed: more }, null, 2));
  console.log("\n=== FINAL SUMMARY ===");
  console.log("Working endpoints:");
  for (const s of summary.filter((x) => x.rows > 0)) {
    console.log(`  ${s.url}  (${s.rows} rows, keys: ${(s.sampleKeys || []).join(",")})`);
  }
  for (const m of more.filter((x) => x.status === 200 && x.rc === "00" && x.rows > 0)) {
    console.log(`  ${m.url}  (${m.rows} rows)`);
  }

  await cleanCtx.close();
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
