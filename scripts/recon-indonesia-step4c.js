// Linear, no-rollback fill of step 3 + Next click. Order matters because
// each cascade pick clears downstream fields.
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
    try { if ((resp.headers()["content-type"] || "").includes("json")) m.responseJson = await resp.json().catch(() => null); } catch (_) {}
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

  const setDropdown = async (id, text, longerWait = false) => {
    await openByClick(id);
    await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5000 }).catch(() => {});
    if (longerWait) await page.waitForTimeout(1000);
    const ok = await pickByText(text, false);
    await page.waitForTimeout(700);
    const stillOpen = await page.evaluate(() => !!document.querySelector('[data-virtuoso-scroller="true"]'));
    if (stillOpen) await closePicker();
    return ok;
  };

  // 0. Dismiss any leftover modal.
  await page.evaluate(() => {
    const ok = [...document.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === "OK");
    if (ok && ok.offsetParent) ok.click();
  });
  await closePicker();
  await page.waitForTimeout(500);

  // Order:
  //   Mode (already AIR)
  //   Place of Arrival (already CGK)
  //   Air Transport Type — re-pick to fire cascade
  //   Flight Name — pick first
  //   Flight Number — type
  //   Hotel Name — pick first match for "test"
  console.log("setting Air Transport Type=COMMERCIAL FLIGHT (refresh cascade)");
  await setDropdown("smta_air_transport_type_foreigner", "COMMERCIAL FLIGHT");

  console.log("re-picking Place of Arrival=CGK (cleared by Air Type cascade)");
  await setDropdown("smta_place_of_arrival_air_foreigner", "CGK - SOEKARNO-HATTA AIRPORT");

  console.log("setting Flight Name=AERO DILI (after waiting for cascade)");
  await setDropdown("smta_flight_name_foreigner", "AERO DILI", true);

  // Verify the prefix auto-filled.
  const fState = await page.evaluate(() => ({
    name: document.getElementById("smta_flight_name_foreigner")?.value,
    prefix: document.getElementById("smta_flight_no_prefix_foreigner")?.value,
  }));
  console.log("  flight state:", fState);

  // Fill Flight Number.
  console.log("filling Flight Number=001");
  await page.locator("#smta_flight_no_foreigner").fill("001");
  await page.waitForTimeout(300);

  console.log("setting Hotel Name (search 'hyatt' → first match)");
  await openByClick("smta_hotel_name_foreigner");
  await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5000 }).catch(() => {});
  const search = page.locator('input[placeholder="Search" i]').first();
  await search.fill("");
  await page.waitForTimeout(300);
  await search.fill("hyatt");
  await page.waitForTimeout(2000);
  // Pick whatever the first row is.
  const firstHotel = await page.evaluate(() => {
    const s = document.querySelector('[data-virtuoso-scroller="true"]');
    if (!s) return null;
    const rows = [...s.querySelectorAll('[data-index]')];
    return rows.length ? (rows[0].innerText || "").trim() : null;
  });
  console.log("  first hotel:", firstHotel);
  if (firstHotel) {
    // Use Playwright's real click on the first virtuoso row.
    const row = page.locator('[data-virtuoso-scroller="true"] [data-index]').first();
    try {
      await row.click({ force: true });
    } catch (e) {
      console.log("  Playwright click failed:", String(e).slice(0, 100));
    }
    await page.waitForTimeout(900);
    // If still not picked, try clicking the inner ._list_dropdown_ wrapper.
    const v = await page.evaluate(() => document.getElementById("smta_hotel_name_foreigner")?.value);
    if (!v || v.startsWith("Select")) {
      console.log("  retry: clicking ._list_dropdown_ inner...");
      const inner = page.locator('[data-virtuoso-scroller="true"] ._list_dropdown_1plhr_8').first();
      try { await inner.click({ force: true }); } catch (e) { console.log("  inner click failed:", String(e).slice(0, 100)); }
      await page.waitForTimeout(900);
    }
  }
  let stillOpen = await page.evaluate(() => !!document.querySelector('[data-virtuoso-scroller="true"]'));
  if (stillOpen) await closePicker();

  const filled = await page.evaluate(() => ({
    mode: document.getElementById("smta_mode_transport_foreigner")?.value,
    purpose: document.getElementById("smta_purpose_travel_foreigner")?.value,
    port: document.getElementById("smta_place_of_arrival_air_foreigner")?.value,
    airType: document.getElementById("smta_air_transport_type_foreigner")?.value,
    flightName: document.getElementById("smta_flight_name_foreigner")?.value,
    flightPrefix: document.getElementById("smta_flight_no_prefix_foreigner")?.value,
    flightNo: document.getElementById("smta_flight_no_foreigner")?.value,
    accommodation: document.getElementById("smta_residence_type_foreigner")?.value,
    hotel: document.getElementById("smta_hotel_name_foreigner")?.value,
    immigrationOffice: document.getElementById("smta_hotel_nearest_immigration_office_foreigner")?.value,
  }));
  console.log("\nfilled state:", filled);

  // Click Next.
  const reqsBeforeNext = reqs.length;
  console.log("\nclicking Next...");
  await page.evaluate(() => {
    const nxt = [...document.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === "Next" && !b.disabled);
    if (nxt) { nxt.scrollIntoView({ behavior: "instant", block: "center" }); nxt.click(); }
  });
  await page.waitForURL(/declaration|review|complete|customs|finalize|step|confirm/i, { timeout: 12000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);

  console.log("URL after Next:", page.url());

  await page.screenshot({ path: path.join(OUT, "step4-attempt3.png"), fullPage: true });
  fs.writeFileSync(path.join(OUT, "step4-attempt3.html"), await page.content());
  const post = await page.evaluate(() => ({
    url: location.href,
    headings: [...document.querySelectorAll("h1,h2,h3,h4")].map((h) => h.innerText.trim().slice(0, 200)),
    inputs: [...document.querySelectorAll("input, textarea, select")].map((el) => ({
      id: el.id || null, type: el.type, placeholder: el.placeholder || null, value: (el.value || "").slice(0, 80), readonly: el.hasAttribute("readonly"), disabled: el.disabled,
    })),
    buttons: [...document.querySelectorAll("button, [role='button']")].map((b) => ({ text: (b.innerText || "").trim().slice(0, 80), disabled: b.disabled, id: b.id })),
    bodyText: document.body.innerText.slice(0, 2500),
  }));
  fs.writeFileSync(path.join(OUT, "step4-attempt3.snapshot.json"), JSON.stringify(post, null, 2));

  const transitionReqs = reqs.slice(reqsBeforeNext);
  fs.writeFileSync(path.join(OUT, "step3-to-4-attempt3.network.json"), JSON.stringify(transitionReqs, null, 2));
  console.log("\nXHRs during Next:", transitionReqs.length);
  for (const r of transitionReqs) {
    if (r.url.includes("/api/")) console.log("  ", r.method, r.url, r.status || "(pending)", r.postData ? "body=" + r.postData.slice(0, 200) : "");
  }
  console.log("\nheadings:", post.headings.slice(0, 6));
  console.log("input count:", post.inputs.length, "buttons:", post.buttons.map((b) => b.text).filter(Boolean).slice(0, 8));

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
