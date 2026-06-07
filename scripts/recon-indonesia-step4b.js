// Retry: dismiss alert, re-fire air-flight-v2 cascade by re-picking
// Air Transport Type, pick Flight Name, then Next again.
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
  await page.bringToFront();

  const reqs = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http")) return;
    if (/\.(png|jpg|jpeg|svg|gif|woff2?|css|ico|js|map)(\?|$)/i.test(r.url())) return;
    reqs.push({ ts: Date.now(), method: r.method(), url: r.url(), postData: r.postData() || null, headers: r.headers() });
  });
  page.on("response", async (resp) => {
    const m = reqs.find((q) => q.url === resp.url() && !q.status);
    if (!m) return;
    m.status = resp.status();
    m.responseHeaders = resp.headers();
    try {
      const ct = (resp.headers()["content-type"] || "").toLowerCase();
      if (ct.includes("json")) m.responseJson = await resp.json().catch(() => null);
    } catch (_) {}
  });

  const openByClick = async (id) => page.evaluate((id) => {
    const inp = document.getElementById(id);
    if (!inp) return { ok: false };
    let n = inp; let target = inp;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      if (getComputedStyle(n).cursor === "pointer") { target = n; break; }
    }
    const r = target.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window };
    target.dispatchEvent(new MouseEvent("mousedown", opts));
    target.dispatchEvent(new MouseEvent("mouseup", opts));
    target.dispatchEvent(new MouseEvent("click", opts));
    return { ok: true };
  }, id);

  const closePicker = async () => {
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(120); }
    await page.mouse.click(5, 5).catch(() => {});
    await page.waitForTimeout(200);
  };

  const pickByText = async (text, scrollFirst = true) => {
    if (scrollFirst) await page.evaluate(() => { const s = document.querySelector('[data-virtuoso-scroller="true"]'); if (s) s.scrollTop = 0; });
    for (let pass = 0; pass < 80; pass++) {
      const found = await page.evaluate((text) => {
        const s = document.querySelector('[data-virtuoso-scroller="true"]');
        if (!s) return { ok: false, done: true };
        const rows = [...s.querySelectorAll('[data-index]')];
        for (const r of rows) {
          if ((r.innerText || "").trim() === text) {
            const inner = r.querySelector('._list_dropdown_1plhr_8') || r;
            const rect = inner.getBoundingClientRect();
            const opts = { bubbles: true, cancelable: true, clientX: rect.left + 20, clientY: rect.top + rect.height / 2, view: window };
            inner.dispatchEvent(new MouseEvent("mousedown", opts));
            inner.dispatchEvent(new MouseEvent("mouseup", opts));
            inner.dispatchEvent(new MouseEvent("click", opts));
            return { ok: true };
          }
        }
        s.scrollTop = s.scrollTop + s.clientHeight * 0.7;
        return { ok: false };
      }, text);
      if (found.ok) return true;
      if (found.done) return false;
      await page.waitForTimeout(120);
    }
    return false;
  };

  // 1. Dismiss any existing modal (the "Incomplete Data!" OK button or leftover popup).
  console.log("dismissing alerts/modals...");
  await page.evaluate(() => {
    // Click any visible button labelled OK.
    const btns = [...document.querySelectorAll("button, [role='button']")];
    const ok = btns.find((b) => (b.innerText || "").trim() === "OK");
    if (ok && ok.offsetParent) ok.click();
  });
  await page.waitForTimeout(500);
  await closePicker();

  // 2. Re-pick Air Transport Type to fire air-flight-v2 cascade.
  console.log("re-picking Air Transport Type...");
  const reqsBeforeCascade = reqs.length;
  await openByClick("smta_air_transport_type_foreigner");
  await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5000 }).catch(() => {});
  await pickByText("COMMERCIAL FLIGHT");
  await page.waitForTimeout(1500);
  let stillOpen = await page.evaluate(() => !!document.querySelector('[data-virtuoso-scroller="true"]'));
  if (stillOpen) await closePicker();
  console.log("  cascade XHRs after Air Type re-pick:", reqs.length - reqsBeforeCascade);

  // 3. Open Flight Name picker; should now have rows.
  console.log("opening Flight Name picker...");
  await openByClick("smta_flight_name_foreigner");
  await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const firstAirline = await page.evaluate(() => {
    const s = document.querySelector('[data-virtuoso-scroller="true"]');
    if (!s) return null;
    const r = [...s.querySelectorAll('[data-index]')][0];
    return r ? (r.innerText || "").trim() : null;
  });
  console.log("  first airline visible:", firstAirline);
  if (firstAirline) {
    await pickByText(firstAirline, false);
    await page.waitForTimeout(700);
  }
  stillOpen = await page.evaluate(() => !!document.querySelector('[data-virtuoso-scroller="true"]'));
  if (stillOpen) await closePicker();

  // 4. Confirm the field is filled.
  const filled = await page.evaluate(() => ({
    flightName: document.getElementById("smta_flight_name_foreigner")?.value,
    flightNoPrefix: document.getElementById("smta_flight_no_prefix_foreigner")?.value,
    flightNoPrefixDisabled: document.getElementById("smta_flight_no_prefix_foreigner")?.disabled,
    flightNo: document.getElementById("smta_flight_no_foreigner")?.value,
    hotelName: document.getElementById("smta_hotel_name_foreigner")?.value,
    immigrationOffice: document.getElementById("smta_hotel_nearest_immigration_office_foreigner")?.value,
  }));
  console.log("filled state:", filled);

  // 5. Click Next.
  console.log("\nclicking Next...");
  const reqsBeforeNext = reqs.length;
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const nxt = btns.find((b) => (b.innerText || "").trim() === "Next" && !b.disabled);
    if (!nxt) return false;
    nxt.scrollIntoView({ behavior: "instant", block: "center" });
    nxt.click();
    return true;
  });
  console.log("  Next clicked:", clicked);

  await page.waitForURL(/declaration|review|complete|step/i, { timeout: 10000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);

  console.log("URL after Next:", page.url());

  // Snapshot whatever we got.
  await page.screenshot({ path: path.join(OUT, "step4-attempt2.png"), fullPage: true });
  fs.writeFileSync(path.join(OUT, "step4-attempt2.html"), await page.content());
  const post = await page.evaluate(() => ({
    url: location.href,
    headings: [...document.querySelectorAll("h1,h2,h3,h4")].map((h) => h.innerText.trim().slice(0, 200)),
    inputs: [...document.querySelectorAll("input, textarea, select")].map((el) => ({ id: el.id, type: el.type, value: (el.value || "").slice(0, 60), placeholder: el.placeholder })),
    buttons: [...document.querySelectorAll("button, [role='button']")].map((b) => ({ text: (b.innerText || "").trim().slice(0, 80), disabled: b.disabled })),
    visibleText: document.body.innerText.slice(0, 1500),
  }));
  fs.writeFileSync(path.join(OUT, "step4-attempt2.snapshot.json"), JSON.stringify(post, null, 2));

  const transitionReqs = reqs.slice(reqsBeforeNext);
  fs.writeFileSync(path.join(OUT, "step3-to-4-attempt2.network.json"), JSON.stringify(transitionReqs, null, 2));
  console.log("\nXHRs during Next click:", transitionReqs.length);
  for (const r of transitionReqs) {
    if (r.url.includes("/api/")) console.log("  ", r.method, r.url, r.status || "(pending)");
  }
  console.log("\nheadings:", post.headings.slice(0, 5));
  console.log("buttons:", post.buttons.map((b) => b.text).filter(Boolean).slice(0, 8));
  console.log("input count:", post.inputs.length);

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
