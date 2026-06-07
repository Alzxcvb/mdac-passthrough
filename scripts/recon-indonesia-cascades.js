// Hunt the 3 cascaded/typeahead pickers that returned 0 options:
//   - smta_residential_city_foreigner (cascaded from province)
//   - smta_hotel_name_foreigner (typeahead/search)
//   - smta_flight_name_foreigner (cascaded from airport + air-transport-type)
// Capture every XHR fired during these interactions.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("mode-of-transport"));
  if (!page) { console.error("not on mode-of-transport"); process.exit(2); }
  await page.bringToFront();
  for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(120); }

  const reqs = [];
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith("http")) return;
    if (/\.(png|jpg|jpeg|svg|gif|woff2?|css|ico)(\?|$)/i.test(u)) return;
    reqs.push({ ts: Date.now(), method: r.method(), url: u, type: r.resourceType(), postData: r.postData() || null });
  });
  page.on("response", async (resp) => {
    const u = resp.url();
    const m = reqs.find((q) => q.url === u && !q.status);
    if (!m) return;
    m.status = resp.status();
    try {
      const ct = (resp.headers()["content-type"] || "").toLowerCase();
      if (ct.includes("json")) m.responseJson = await resp.json().catch(() => null);
      else if (ct.includes("text")) m.responseText = (await resp.text().catch(() => "")).slice(0, 6000);
    } catch (_) {}
  });

  const openByClick = async (id) => {
    return await page.evaluate((id) => {
      const inp = document.getElementById(id);
      if (!inp) return { ok: false };
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
      inp.focus();
      return { ok: true };
    }, id);
  };
  const closePicker = async () => {
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(120); }
    await page.mouse.click(5, 5).catch(() => {});
    await page.waitForTimeout(200);
  };
  const pickOption = async (text) => {
    await page.evaluate(() => { const s = document.querySelector('[data-virtuoso-scroller="true"]'); if (s) s.scrollTop = 0; });
    for (let pass = 0; pass < 60; pass++) {
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
    const ok = await pickOption(value);
    await page.waitForTimeout(700);
    const stillOpen = await page.evaluate(() => !!document.querySelector('[data-virtuoso-scroller="true"]'));
    if (stillOpen) await closePicker();
    return ok;
  };

  const tagged = (label) => {
    const start = reqs.length;
    return () => reqs.slice(start).map((r) => ({ method: r.method, url: r.url, status: r.status, postData: r.postData, responseSummary: r.responseJson ? JSON.stringify(r.responseJson).slice(0, 400) : (r.responseText || "").slice(0, 200) }));
  };

  const findings = {};

  // ---- 1. residential_city: cascade from province ----
  console.log("=== residential_city cascade ===");
  // Reset to clean state: AIR + RESIDENTIAL.
  await setDropdown("smta_mode_transport_foreigner", "AIR");
  await setDropdown("smta_residence_type_foreigner", "RESIDENTIAL");

  // Try city before province.
  let getNew = tagged("city-before-province");
  await openByClick("smta_residential_city_foreigner");
  await page.waitForTimeout(1000);
  await closePicker();
  findings.cityBeforeProvince = { xhrs: getNew() };

  // Set province, then city.
  console.log("setting province=BALI");
  getNew = tagged("province-pick");
  await setDropdown("smta_residential_province_foreigner", "BALI");
  findings.afterProvinceSet_xhrs = getNew();

  console.log("opening city picker after province set");
  getNew = tagged("city-after-province");
  await openByClick("smta_residential_city_foreigner");
  await page.waitForTimeout(1500);
  // Scrape options
  const cityOptions = await page.evaluate(() => {
    const s = document.querySelector('[data-virtuoso-scroller="true"]');
    if (!s) return [];
    return [...s.querySelectorAll('[data-index]')].map((r) => (r.innerText || "").trim());
  });
  findings.cityAfterProvince = { sample: cityOptions, xhrs: getNew() };
  console.log("  city options visible:", cityOptions.length, cityOptions.slice(0, 8).join(" | "));
  await closePicker();

  // ---- 2. hotel_name: typeahead ----
  console.log("\n=== hotel_name typeahead ===");
  await setDropdown("smta_residence_type_foreigner", "HOTEL");

  getNew = tagged("hotel-open");
  await openByClick("smta_hotel_name_foreigner");
  await page.waitForTimeout(1000);
  // Type "hyatt" into search.
  const search = page.locator('input[placeholder="Search" i]').first();
  if (await search.isVisible().catch(() => false)) {
    await search.fill("hyatt");
    await page.waitForTimeout(2000);
  }
  const hotelOptions = await page.evaluate(() => {
    const s = document.querySelector('[data-virtuoso-scroller="true"]');
    if (!s) return [];
    return [...s.querySelectorAll('[data-index]')].map((r) => (r.innerText || "").trim()).slice(0, 15);
  });
  findings.hotelHyattSearch = { sample: hotelOptions, xhrs: getNew() };
  console.log("  hotel matches for 'hyatt':", hotelOptions.length, hotelOptions.slice(0, 5).join(" | "));
  await closePicker();

  // Try a longer query — full city name.
  getNew = tagged("hotel-bali-search");
  await openByClick("smta_hotel_name_foreigner");
  await page.waitForTimeout(500);
  if (await search.isVisible().catch(() => false)) {
    await search.fill("bali");
    await page.waitForTimeout(2000);
  }
  const baliHotels = await page.evaluate(() => {
    const s = document.querySelector('[data-virtuoso-scroller="true"]');
    if (!s) return [];
    return [...s.querySelectorAll('[data-index]')].map((r) => (r.innerText || "").trim()).slice(0, 15);
  });
  findings.hotelBaliSearch = { sample: baliHotels, xhrs: getNew() };
  await closePicker();

  // ---- 3. flight_name cascade ----
  console.log("\n=== flight_name cascade ===");
  await setDropdown("smta_mode_transport_foreigner", "AIR");
  await page.waitForTimeout(500);

  getNew = tagged("flight-name-no-prereqs");
  await openByClick("smta_flight_name_foreigner");
  await page.waitForTimeout(1000);
  const flightBefore = await page.evaluate(() => {
    const s = document.querySelector('[data-virtuoso-scroller="true"]');
    if (!s) return [];
    return [...s.querySelectorAll('[data-index]')].map((r) => (r.innerText || "").trim());
  });
  findings.flightNameNoPrereqs = { sample: flightBefore.slice(0, 10), xhrs: getNew() };
  await closePicker();

  console.log("setting place_of_arrival_air=CGK");
  getNew = tagged("set-airport");
  await setDropdown("smta_place_of_arrival_air_foreigner", "CGK - SOEKARNO-HATTA AIRPORT");
  findings.afterAirportSet_xhrs = getNew();

  console.log("setting air_transport_type=COMMERCIAL FLIGHT");
  getNew = tagged("set-air-type");
  await setDropdown("smta_air_transport_type_foreigner", "COMMERCIAL FLIGHT");
  findings.afterAirTypeSet_xhrs = getNew();

  getNew = tagged("flight-name-after-prereqs");
  await openByClick("smta_flight_name_foreigner");
  await page.waitForTimeout(1500);
  const flightAfter = await page.evaluate(() => {
    const s = document.querySelector('[data-virtuoso-scroller="true"]');
    if (!s) return [];
    return [...s.querySelectorAll('[data-index]')].map((r) => (r.innerText || "").trim()).slice(0, 20);
  });
  findings.flightNameAfterPrereqs = { sample: flightAfter, xhrs: getNew() };
  console.log("  flight options after prereqs:", flightAfter.length, flightAfter.slice(0, 5).join(" | "));

  // Try search inside flight name dropdown.
  if (await search.isVisible().catch(() => false)) {
    getNew = tagged("flight-name-ga");
    await search.fill("GA");
    await page.waitForTimeout(2000);
    const flightGA = await page.evaluate(() => {
      const s = document.querySelector('[data-virtuoso-scroller="true"]');
      if (!s) return [];
      return [...s.querySelectorAll('[data-index]')].map((r) => (r.innerText || "").trim()).slice(0, 15);
    });
    findings.flightNameSearchGA = { sample: flightGA, xhrs: getNew() };
  }
  await closePicker();

  fs.writeFileSync(path.join(OUT, "step3-cascades.json"), JSON.stringify(findings, null, 2));
  fs.writeFileSync(path.join(OUT, "step3-cascade.network.json"), JSON.stringify(reqs, null, 2));
  console.log("\nDone. Total XHRs captured:", reqs.length);
  for (const r of reqs) {
    if (/api|search|graphql/i.test(r.url)) {
      console.log("  *", r.method, r.url, r.status || "(pending)");
    }
  }

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
