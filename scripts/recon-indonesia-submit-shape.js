// Probe /declaration-captcha/submit and /declaration/submit with safe-but-
// invalid bodies to learn the required field shape from the validation error.
// Use a fake submissionId so we don't accidentally finalize the real one.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon";

(async () => {
  const browser = await chromium.connectOverCDP(CDP);
  const cleanCtx = await browser.newContext();

  const FAKE_ID = "ID_RECON_PROBE_" + Date.now();

  // Get a fresh CAPTCHA token to include.
  const cap = await cleanCtx.request.get("https://allindonesia.imigrasi.go.id/api/captcha/generate");
  const capJson = JSON.parse(await cap.text());
  const token = capJson.transactionDetail.token;
  const code = capJson.transactionDetail.code;
  const decoded = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
  console.log("captcha JWT decoded:", decoded);

  const tries = [
    {
      tag: "min-empty",
      url: "/api/declaration-captcha/submit",
      body: {},
    },
    {
      tag: "with-language-only",
      url: "/api/declaration-captcha/submit",
      body: { deviceLang: "EN" },
    },
    {
      tag: "with-fake-submission-id",
      url: "/api/declaration-captcha/submit",
      body: { deviceLang: "EN", submissionId: FAKE_ID, accountType: "WNA", captchaToken: token, captchaCode: decoded.captchaCode },
    },
    {
      tag: "alt-keys",
      url: "/api/declaration-captcha/submit",
      body: { deviceLang: "EN", submissionId: FAKE_ID, accountType: "WNA", token: token, code: decoded.captchaCode },
    },
    {
      tag: "with-uuid-key",
      url: "/api/declaration-captcha/submit",
      body: { deviceLang: "EN", submissionId: FAKE_ID, accountType: "WNA", uuid: decoded.uuid, captchaCode: decoded.captchaCode },
    },
    {
      tag: "decl-submit-empty",
      url: "/api/declaration/submit",
      body: { deviceLang: "EN", submissionId: FAKE_ID, accountType: "WNA" },
    },
    {
      tag: "guest-wna-empty",
      url: "/api/authentication/guest-wna",
      body: { deviceLang: "EN" },
    },
    {
      tag: "register-form-foreigner-empty",
      url: "/api/register-form/foreigner",
      body: { deviceLang: "EN" },
    },
    {
      tag: "retrieve-inquiry-individual-empty",
      url: "/api/retrieve/inquiry-individual",
      body: { deviceLang: "EN" },
    },
    {
      tag: "submission-inquiry-individual-empty",
      url: "/api/submission/inquiry-individual",
      body: { deviceLang: "EN" },
    },
  ];

  const results = [];
  for (const t of tries) {
    const url = "https://allindonesia.imigrasi.go.id" + t.url;
    try {
      const r = await cleanCtx.request.post(url, { data: t.body, headers: { "content-type": "application/json" }, timeout: 10000 });
      const status = r.status();
      const text = (await r.text()).slice(0, 1500);
      console.log(`---  ${t.tag}  → ${status}\n  body: ${JSON.stringify(t.body).slice(0, 200)}\n  response: ${text.slice(0, 600)}\n`);
      results.push({ tag: t.tag, url: t.url, body: t.body, status, response: text });
    } catch (e) {
      console.log("ERR " + t.tag, String(e).slice(0, 100));
      results.push({ tag: t.tag, url: t.url, body: t.body, error: String(e).slice(0, 100) });
    }
  }

  fs.writeFileSync(path.join(OUT, "submit-shape-probes.json"), JSON.stringify(results, null, 2));
  await cleanCtx.close();
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
