// Capture full request/response headers + bodies for the master-dropdown
// cascade endpoints. Re-fires search-hotel (cheapest payload) and inspects
// auth requirements. Also tries calling each endpoint anonymously to see
// whether session cookies are required.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("allindonesia.imigrasi.go.id"));
  if (!page) { console.error("no allindonesia tab"); process.exit(2); }
  await page.bringToFront();

  const captured = [];
  page.on("request", (r) => {
    if (!r.url().includes("/api/")) return;
    captured.push({
      ts: Date.now(),
      method: r.method(),
      url: r.url(),
      headers: r.headers(),
      postData: r.postData() || null,
    });
  });
  page.on("response", async (resp) => {
    if (!resp.url().includes("/api/")) return;
    const m = captured.find((q) => q.url === resp.url() && !q.responseHeaders);
    if (!m) return;
    m.status = resp.status();
    m.responseHeaders = resp.headers();
    try {
      const ct = (resp.headers()["content-type"] || "").toLowerCase();
      if (ct.includes("json")) m.responseJson = await resp.json().catch(() => null);
    } catch (_) {}
  });

  // Trigger one cascade so we can read headers.
  if (page.url().includes("mode-of-transport")) {
    // Open hotel picker, type 'b'.
    const open = async () => {
      await page.evaluate(() => {
        const inp = document.getElementById("smta_hotel_name_foreigner");
        if (!inp) return;
        let n = inp; let target = inp;
        for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.cursor === "pointer") { target = n; break; }
        }
        const r = target.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window };
        target.dispatchEvent(new MouseEvent("mousedown", opts));
        target.dispatchEvent(new MouseEvent("mouseup", opts));
        target.dispatchEvent(new MouseEvent("click", opts));
      });
      await page.waitForTimeout(500);
    };
    await open();
    const search = page.locator('input[placeholder="Search" i]').first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill("test");
      await page.waitForTimeout(2000);
    }
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(120); }
  }

  // Cookies for the page context.
  const cookies = await ctx.cookies("https://allindonesia.imigrasi.go.id");

  // Anonymous fetch — does the API care about origin/cookies?
  const anonResults = [];
  for (const target of [
    "https://allindonesia.imigrasi.go.id/api/master-dropdown/search-hotel",
  ]) {
    try {
      const r = await page.evaluate(async (u) => {
        // call from page context (carries cookies + origin)
        const r1 = await fetch(u, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deviceLang: "EN", hotelName: "test" }),
        });
        return { ok: r1.ok, status: r1.status, headers: Object.fromEntries(r1.headers.entries()), body: (await r1.text()).slice(0, 500) };
      }, target);
      anonResults.push({ url: target, fromPage: r });
    } catch (e) { anonResults.push({ url: target, error: String(e) }); }
  }

  // No-cookie fetch via headless context — simulates a fresh client.
  // Only run if Playwright lets us create a clean context (we're connected via CDP, so use a request newContext)
  let cleanResult = null;
  try {
    const cleanCtx = await browser.newContext();
    const r = await cleanCtx.request.post("https://allindonesia.imigrasi.go.id/api/master-dropdown/search-hotel", {
      data: { deviceLang: "EN", hotelName: "test" },
      headers: { "content-type": "application/json" },
    });
    cleanResult = { ok: r.ok(), status: r.status(), headers: r.headers(), body: (await r.text()).slice(0, 500) };
    await cleanCtx.close();
  } catch (e) { cleanResult = { error: String(e) }; }

  fs.writeFileSync(path.join(OUT, "api-headers.json"), JSON.stringify({
    captured: captured.map((c) => ({ method: c.method, url: c.url, status: c.status, requestHeaders: c.headers, postData: c.postData, responseHeaders: c.responseHeaders, responseSample: c.responseJson ? JSON.stringify(c.responseJson).slice(0, 500) : null })),
    cookies,
    anonResults,
    cleanResult,
  }, null, 2));

  console.log("Captured XHR count:", captured.length);
  for (const c of captured) {
    const auth = c.headers.authorization || c.headers["x-api-key"] || c.headers["x-auth"] || c.headers["x-csrf-token"];
    console.log(`  ${c.method} ${c.url} → ${c.status} ; auth header: ${auth ? auth.slice(0, 50) + "..." : "none"} ; cookie: ${c.headers.cookie ? "yes" : "no"}`);
  }
  console.log("\nCookies on the domain:", cookies.length, cookies.map((c) => c.name).join(", "));
  console.log("\nFrom-page fetch result:", anonResults[0]?.fromPage ? `${anonResults[0].fromPage.status} body: ${anonResults[0].fromPage.body.slice(0, 100)}` : anonResults[0]?.error);
  console.log("\nClean-context fetch result:", cleanResult);

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
