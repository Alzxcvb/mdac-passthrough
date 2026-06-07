// Fill remaining required fields on step 3 with safe placeholders, click
// Next to advance to step 4 (Declaration). Capture all network during the
// transition. Snapshot step 4 structure + html + screenshot. DO NOT click
// any final submit button on step 4.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("mode-of-transport") || p.url().includes("declaration") || p.url().includes("arrival-card-submission"));
  if (!page) { console.error("no relevant tab"); process.exit(2); }
  await page.bringToFront();
  for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(120); }

  const reqs = [];
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith("http")) return;
    if (/\.(png|jpg|jpeg|svg|gif|woff2?|css|ico|js|map)(\?|$)/i.test(u)) return;
    reqs.push({ ts: Date.now(), method: r.method(), url: u, type: r.resourceType(), postData: r.postData() || null, headers: r.headers() });
  });
  page.on("response", async (resp) => {
    const u = resp.url();
    const m = reqs.find((q) => q.url === u && !q.status);
    if (!m) return;
    m.status = resp.status();
    m.responseHeaders = resp.headers();
    try {
      const ct = (resp.headers()["content-type"] || "").toLowerCase();
      if (ct.includes("json")) m.responseJson = await resp.json().catch(() => null);
    } catch (_) {}
  });

  // Helpers (same as before).
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

  const setDropdown = async (id, value) => {
    await openByClick(id);
    await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5000 }).catch(() => {});
    const ok = await pickByText(value);
    await page.waitForTimeout(700);
    const stillOpen = await page.evaluate(() => !!document.querySelector('[data-virtuoso-scroller="true"]'));
    if (stillOpen) await closePicker();
    return ok;
  };

  const typeIntoSearch = async (text) => {
    const search = page.locator('input[placeholder="Search" i]').first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill(text);
      await page.waitForTimeout(1500);
    }
  };

  // 1. Pick Flight Name. Open the picker, type a search; pick the first result.
  console.log("step 3: picking Flight Name (any airline)...");
  await openByClick("smta_flight_name_foreigner");
  await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  // pick first airline visible
  const firstAirline = await page.evaluate(() => {
    const s = document.querySelector('[data-virtuoso-scroller="true"]');
    if (!s) return null;
    const r = [...s.querySelectorAll('[data-index]')][0];
    return r ? (r.innerText || "").trim() : null;
  });
  if (firstAirline) {
    await pickByText(firstAirline, false);
    await page.waitForTimeout(700);
  }
  let stillOpen = await page.evaluate(() => !!document.querySelector('[data-virtuoso-scroller="true"]'));
  if (stillOpen) await closePicker();
  console.log("  picked:", firstAirline);

  // 2. Fill Flight Number (3 digits).
  console.log("step 3: filling Flight Number...");
  const fno = page.locator('#smta_flight_no_foreigner');
  await fno.fill("001");
  await page.waitForTimeout(300);

  // 3. Pick Hotel Name. Open picker, search "test" (we know that returns OTHERS), pick first.
  console.log("step 3: picking Hotel Name (OTHERS)...");
  await openByClick("smta_hotel_name_foreigner");
  await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5000 }).catch(() => {});
  await typeIntoSearch("test");
  const firstHotel = await page.evaluate(() => {
    const s = document.querySelector('[data-virtuoso-scroller="true"]');
    if (!s) return null;
    const r = [...s.querySelectorAll('[data-index]')][0];
    return r ? (r.innerText || "").trim() : null;
  });
  if (firstHotel) {
    await pickByText(firstHotel, false);
    await page.waitForTimeout(700);
  }
  stillOpen = await page.evaluate(() => !!document.querySelector('[data-virtuoso-scroller="true"]'));
  if (stillOpen) await closePicker();
  console.log("  picked hotel:", firstHotel);

  // Snapshot pre-Next state.
  const preNext = await page.evaluate(() => {
    return [...document.querySelectorAll("input, textarea")].map((el) => ({ id: el.id, value: (el.value || "").slice(0, 80) }));
  });
  fs.writeFileSync(path.join(OUT, "step3-pre-next.json"), JSON.stringify(preNext, null, 2));

  // Mark a baseline for the Next-click XHR capture.
  const reqsBeforeNext = reqs.length;

  console.log("\nclicking Next...");
  // Find Next button. It's text=Next at the bottom.
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const nxt = btns.find((b) => (b.innerText || "").trim() === "Next");
    if (!nxt) return false;
    nxt.scrollIntoView({ behavior: "instant", block: "center" });
    nxt.click();
    return true;
  });
  if (!clicked) { console.error("Next button not found"); await browser.close(); process.exit(3); }

  // Wait for URL change.
  try {
    await page.waitForURL(/declaration|step|customs|review|complete/i, { timeout: 8000 });
  } catch (_) {
    // No URL change — might still be on step 3 with validation errors.
  }
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);

  console.log("URL after Next:", page.url());

  // Snapshot step 4.
  await page.screenshot({ path: path.join(OUT, "step4.png"), fullPage: true });
  fs.writeFileSync(path.join(OUT, "step4.html"), await page.content());
  const step4 = await page.evaluate(() => {
    return {
      url: location.href,
      title: document.title,
      headings: [...document.querySelectorAll("h1,h2,h3,h4")].map((h) => h.innerText.trim().slice(0, 200)),
      inputs: [...document.querySelectorAll("input, textarea, select")].map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        name: el.name || null,
        type: el.type || null,
        placeholder: el.placeholder || null,
        readonly: el.hasAttribute("readonly"),
        disabled: el.disabled,
        value: el.value ? String(el.value).slice(0, 80) : null,
      })),
      buttons: [...document.querySelectorAll("button, [role='button']")].map((b) => ({
        text: (b.innerText || "").trim().slice(0, 80),
        disabled: b.disabled,
        id: b.id || null,
      })),
      labels: [...document.querySelectorAll("label, p, h1, h2, h3, h4")].map((l) => l.innerText.trim()).filter((t) => t.length > 0 && t.length < 200),
    };
  });
  fs.writeFileSync(path.join(OUT, "step4.snapshot.json"), JSON.stringify(step4, null, 2));

  // Save network captured during transition.
  const transitionReqs = reqs.slice(reqsBeforeNext);
  fs.writeFileSync(path.join(OUT, "step3-to-4.network.json"), JSON.stringify(transitionReqs, null, 2));
  console.log("\nXHRs during transition:", transitionReqs.length);
  for (const r of transitionReqs) {
    if (r.url.includes("/api/")) console.log("  ", r.method, r.url, r.status || "(pending)", r.postData ? "body=" + r.postData.slice(0, 200) : "");
  }
  console.log("\nstep4 input count:", step4.inputs.length, "buttons:", step4.buttons.length);
  console.log("headings:", step4.headings.slice(0, 5));
  console.log("buttons:", step4.buttons.map((b) => b.text).filter(Boolean).slice(0, 8));

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
