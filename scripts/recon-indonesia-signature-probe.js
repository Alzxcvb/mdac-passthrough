// X-signature reverse-engineering probe.
//
// Strategy:
//  A. Fire pre-sign + submit from inside the LIVE page context (page.evaluate
//     uses the page's fetch, same origin/cookies/whatever else). If it works,
//     we know the signature is purely (token + path + body + timestamp) and
//     the off-page failure is something else.
//  B. Run the same fetch from Node via Playwright's request-context. Compare.
//  C. Print every header difference between the two calls.
//
// We use a fake submissionId so we don't pollute real records (pollution
// requires a complete valid step-1+step-2+step-3 chain, which our payload
// doesn't form).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon";
const ORIGIN = "https://allindonesia.imigrasi.go.id";

(async () => {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("allindonesia.imigrasi.go.id"));
  if (!page) { console.error("no allindonesia tab"); process.exit(2); }
  await page.bringToFront();

  const FAKE_ID = "ID_SIGPROBE_" + Date.now().toString(16);
  const TARGET = "/api/mode-transport-address/submit";
  const body = {
    deviceLang: "EN",
    accountType: "WNA",
    groupId: "",
    submissionId: FAKE_ID,
    modeTransport: "1",
    purposeTravel: "5",
    purposeTravelOthers: "",
    placeArrival: "277",
    flightType: "1",
    flightName: "90",
    flightCode: "8G",
    flightNumber: "001",
    vehicleType: "", vehicleNumber: "",
    vesselType: "", vesselName: "",
    residenceType: "2",
    immigrationOffice: "KANTOR IMIGRASI KELAS I NON TPI JAKARTA PUSAT",
    postalCode: "10110",
    province: "3f05235f-b7a0-4332-abaa-f1d065326cca",
    hotelCity: "ce349395-9f65-47f3-822e-78c2f0164941",
    hotelName: "2395",
    hotelAddress: "", hotelNameOthers: "",
    address: "", city: "", accomodation: "",
  };

  // ---- A. In-page test: use the page's own fetch ----
  console.log("=== A. In-page fetch ===");
  const inPage = await page.evaluate(async ({ origin, target, body }) => {
    // Pull the guest token from localStorage / cookies the SPA already set.
    // The captured live request used `x-token` for the FIRST guest token
    // issued at session start. Try to find it on window or rely on a fresh fetch.
    const guestRes = await fetch(`${origin}/api/authentication/guest-wna`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceLang: "EN" }),
    });
    const guestJson = await guestRes.json();
    const token = guestJson.transactionDetail.token;

    const sigRes = await fetch(`${origin}/api/pre-sign`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-token": token,
        "x-path": target,
      },
      body: JSON.stringify(body),
    });
    const sigJson = await sigRes.json();

    const submitRes = await fetch(`${origin}${target}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-token": token,
        "x-signature": sigJson.signature,
        "x-timestamp": String(sigJson.timestamp),
      },
      body: JSON.stringify(body),
    });
    const submitText = await submitRes.text();
    return {
      token: token.slice(0, 80) + "...",
      sig: sigJson,
      submitStatus: submitRes.status,
      submitBody: submitText.slice(0, 800),
      // Also capture the BODY STRING that fetch was given.
      bodyStringified: JSON.stringify(body),
      bodyLen: JSON.stringify(body).length,
    };
  }, { origin: ORIGIN, target: TARGET, body });
  console.log("  pre-sign:", inPage.sig);
  console.log("  submit status:", inPage.submitStatus);
  console.log("  submit body (first 400 chars):", inPage.submitBody.slice(0, 400));
  console.log("  body stringified length:", inPage.bodyLen);

  // ---- B. Off-page (Node) test: same body, same headers ----
  console.log("\n=== B. Off-page (Node via Playwright request) ===");
  const offCtx = await browser.newContext();
  const offGuestRes = await offCtx.request.post(`${ORIGIN}/api/authentication/guest-wna`, {
    data: { deviceLang: "EN" },
    headers: { "content-type": "application/json" },
  });
  const offGuestJson = JSON.parse(await offGuestRes.text());
  const offToken = offGuestJson.transactionDetail.token;

  const offSigRes = await offCtx.request.post(`${ORIGIN}/api/pre-sign`, {
    data: body,
    headers: {
      "content-type": "application/json",
      "x-token": offToken,
      "x-path": TARGET,
    },
  });
  const offSig = JSON.parse(await offSigRes.text());

  const offSubmitRes = await offCtx.request.post(`${ORIGIN}${TARGET}`, {
    data: body,
    headers: {
      "content-type": "application/json",
      "x-token": offToken,
      "x-signature": offSig.signature,
      "x-timestamp": String(offSig.timestamp),
    },
  });
  const offSubmitText = await offSubmitRes.text();
  console.log("  pre-sign:", offSig);
  console.log("  submit status:", offSubmitRes.status());
  console.log("  submit body (first 400 chars):", offSubmitText.slice(0, 400));

  // ---- Diagnosis ----
  console.log("\n=== diff ===");
  console.log("In-page worked:", inPage.submitStatus === 200);
  console.log("Off-page worked:", offSubmitRes.status() === 200);
  if (inPage.submitStatus === 200 && offSubmitRes.status() !== 200) {
    console.log("→ Signature requires something only the page provides (cookies, origin, automatic browser headers).");
  } else if (inPage.submitStatus === 200 && offSubmitRes.status() === 200) {
    console.log("→ Off-page works! Earlier failure was likely a different cause.");
  }

  fs.writeFileSync(path.join(OUT, "sig-probe.json"), JSON.stringify({ inPage, offPage: { sig: offSig, submitStatus: offSubmitRes.status(), submitBody: offSubmitText } }, null, 2));
  await offCtx.close();
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
