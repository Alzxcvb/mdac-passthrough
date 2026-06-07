// Probe step 1 + step 2 submit endpoints with a proper guest token + signed
// pre-sign sequence + minimal body. Use a fake submissionId so we don't
// pollute the real submission. Read each rejection's responseDesc to learn
// required fields.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon";
const ORIGIN = "https://allindonesia.imigrasi.go.id";

(async () => {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = await browser.newContext();

  // 1. Get a guest token.
  const guestRes = await ctx.request.post(ORIGIN + "/api/authentication/guest-wna", {
    data: { deviceLang: "EN" },
    headers: { "content-type": "application/json" },
  });
  const guestJson = JSON.parse(await guestRes.text());
  const guestToken = guestJson.transactionDetail?.token;
  console.log("guest token:", guestToken ? guestToken.slice(0, 80) + "..." : null);
  if (!guestToken) { console.error("no token"); process.exit(2); }

  const FAKE_ID = "ID_PROBE_" + Date.now().toString(16);

  const COMMON_HEADERS = {
    "content-type": "application/json",
    "accept": "application/json",
    "origin": ORIGIN,
    "referer": ORIGIN + "/arrival-card-submission/personal-information",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  };

  // Helper: pre-sign + submit pair.
  const signedPost = async (submitPath, body) => {
    const sigRes = await ctx.request.post(ORIGIN + "/api/pre-sign", {
      data: body,
      headers: {
        ...COMMON_HEADERS,
        "x-token": guestToken,
        "x-path": submitPath,
      },
    });
    const sigJson = JSON.parse(await sigRes.text());
    // pre-sign returns { signature, timestamp } at top level — not wrapped in transactionDetail.
    const submitRes = await ctx.request.post(ORIGIN + submitPath, {
      data: body,
      headers: {
        ...COMMON_HEADERS,
        "x-token": guestToken,
        "x-signature": sigJson.signature || "",
        "x-timestamp": String(sigJson.timestamp || ""),
      },
    });
    const submitText = await submitRes.text();
    return { sig: sigJson, submit: { status: submitRes.status(), text: submitText.slice(0, 1500) } };
  };

  const tries = [
    {
      name: "step1-profile-data-empty",
      path: "/api/register-form/foreigner/profile-data",
      body: { deviceLang: "EN", accountType: "WNA", submissionId: FAKE_ID },
    },
    {
      name: "step1-documents-empty",
      path: "/api/register-form/foreigner/documents",
      body: { deviceLang: "EN", accountType: "WNA", submissionId: FAKE_ID },
    },
    {
      name: "step1-account-empty",
      path: "/api/register-form/foreigner/account",
      body: { deviceLang: "EN", accountType: "WNA", submissionId: FAKE_ID },
    },
    {
      name: "step2-travel-individu-empty",
      path: "/api/travel/individu",
      body: { deviceLang: "EN", accountType: "WNA", submissionId: FAKE_ID },
    },
    {
      name: "step2-travel-group-empty",
      path: "/api/travel/group",
      body: { deviceLang: "EN", accountType: "WNA", submissionId: FAKE_ID, groupId: "" },
    },
    {
      name: "step3-mode-transport-empty",
      path: "/api/mode-transport-address/submit",
      body: { deviceLang: "EN", accountType: "WNA", submissionId: FAKE_ID, groupId: "" },
    },
    {
      name: "step4-declaration-captcha-empty",
      path: "/api/declaration-captcha/submit",
      body: { deviceLang: "EN", accountType: "WNA", submissionId: FAKE_ID, groupId: "" },
    },
    {
      name: "step4-declaration-empty",
      path: "/api/declaration/submit",
      body: { deviceLang: "EN", accountType: "WNA", submissionId: FAKE_ID, groupId: "" },
    },
    {
      name: "submission-inquiry-individual",
      path: "/api/submission/inquiry-individual",
      body: { deviceLang: "EN", submissionId: FAKE_ID },
    },
    {
      name: "retrieve-inquiry-individual",
      path: "/api/retrieve/inquiry-individual",
      body: { deviceLang: "EN", submissionId: FAKE_ID },
    },
  ];

  const results = [];
  for (const t of tries) {
    console.log("===", t.name, t.path);
    try {
      const r = await signedPost(t.path, t.body);
      const sigOk = !!r.sig.signature;
      console.log(`  pre-sign: ${sigOk ? "OK sig=" + r.sig.signature.slice(0,16) + "... ts=" + r.sig.timestamp : "FAIL"}`);
      console.log(`  submit:   ${r.submit.status} ${r.submit.text.slice(0, 300)}`);
      results.push({ name: t.name, path: t.path, body: t.body, sigResponse: r.sig, submitStatus: r.submit.status, submitBody: r.submit.text });
    } catch (e) {
      console.log("  ERR:", String(e).slice(0, 100));
      results.push({ name: t.name, path: t.path, body: t.body, error: String(e).slice(0, 100) });
    }
  }

  fs.writeFileSync(path.join(OUT, "step12-probes.json"), JSON.stringify(results, null, 2));
  await ctx.close();
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
