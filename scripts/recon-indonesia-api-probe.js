// Probe for additional /api/master-dropdown/* endpoints. Try the obvious
// names. Anything that returns 200 with JSON is worth recording.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon";

const PROBES = [
  // Obvious enumerations the form uses.
  { url: "/api/master-dropdown/province", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/provinces", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/country", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/countries", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/nationality", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/airport", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/airports", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/seaport", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/sea-port", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/place-of-arrival-air", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/place-of-arrival-sea", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/air-transport-type", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/vessel-type", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/purpose-travel", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/travel-purpose", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/residence-type", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/accommodation-type", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/dial-code", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/calling-code", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/phone-code", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/mobile-code", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/immigration-office", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/city", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/visa-type", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/sex", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/gender", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/airline", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/air-flight", body: { deviceLang: "EN" } },
  { url: "/api/master-dropdown/air-flight-v2", body: { deviceLang: "EN" } }, // no code — see what happens
  { url: "/api/master-dropdown/mode-transport", body: { deviceLang: "EN" } },
  // Submission endpoints — POST will probably 400 without payload, but we'll see.
  { url: "/api/arrival-card/submit", body: {} },
  { url: "/api/arrival-card/save", body: {} },
  { url: "/api/arrival-card/foreigner/submit", body: {} },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.connectOverCDP(CDP);
  const cleanCtx = await browser.newContext();
  const results = [];
  for (const p of PROBES) {
    const url = "https://allindonesia.imigrasi.go.id" + p.url;
    try {
      const r = await cleanCtx.request.post(url, {
        data: p.body,
        headers: { "content-type": "application/json" },
        timeout: 10000,
      });
      const status = r.status();
      const body = (await r.text()).slice(0, 800);
      let json = null;
      try { json = JSON.parse(body); } catch {}
      const responseCode = json?.responseCode || null;
      const dataCount = Array.isArray(json?.transactionDetail?.data)
        ? json.transactionDetail.data.length
        : Array.isArray(json?.transactionDetail)
        ? json.transactionDetail.length
        : null;
      results.push({ url: p.url, status, responseCode, dataCount, sample: body.slice(0, 200) });
      console.log(`${status}  ${p.url}  rc=${responseCode || "?"}  count=${dataCount}`);
    } catch (e) {
      results.push({ url: p.url, error: String(e).slice(0, 150) });
      console.log("ERR " + p.url + " " + String(e).slice(0, 80));
    }
  }
  fs.writeFileSync(path.join(OUT, "api-probe.json"), JSON.stringify(results, null, 2));

  // Re-run successful endpoints with a richer query for cataloging.
  const winners = results.filter((r) => r.status === 200 && r.responseCode === "00" && (r.dataCount || 0) > 0);
  console.log("\n=== Working endpoints with data ===");
  for (const w of winners) console.log(" ", w.url, "→", w.dataCount, "rows");

  await cleanCtx.close();
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
