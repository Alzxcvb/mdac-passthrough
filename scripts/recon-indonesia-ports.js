// Scrape the airport, seaport, and vessel-type lists from the live DOM.
// These aren't exposed via /api/master-dropdown/* (they 500 anonymous) so
// we capture them by walking the virtuoso pickers.
//
// Stays on step 3, preserves user's burner state otherwise. Resets Mode
// switching only enough to expose each picker, then leaves Mode=AIR.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon/api";

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
    if (!r.url().includes("/api/")) return;
    reqs.push({ method: r.method(), url: r.url(), postData: r.postData() || null });
  });
  page.on("response", async (resp) => {
    if (!resp.url().includes("/api/")) return;
    const m = reqs.find((q) => q.url === resp.url() && !q.status);
    if (!m) return;
    m.status = resp.status();
    try { m.responseJson = await resp.json().catch(() => null); } catch (_) {}
  });

  const openByClick = async (id) => {
    return await page.evaluate((id) => {
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
  };

  const closePicker = async () => {
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(120); }
    await page.mouse.click(5, 5).catch(() => {});
    await page.waitForTimeout(200);
  };

  const scrapeOpenPicker = async () => {
    const collected = new Map();
    const grab = async () => {
      const items = await page.evaluate(() => {
        const s = document.querySelector('[data-virtuoso-scroller="true"]');
        if (!s) return null;
        const rows = [...s.querySelectorAll('[data-index]')];
        return {
          rows: rows.map((r) => ({ index: parseInt(r.getAttribute("data-index"), 10), text: (r.innerText || "").trim() })).filter((r) => Number.isFinite(r.index)),
          scrollTop: s.scrollTop, scrollHeight: s.scrollHeight, clientHeight: s.clientHeight,
        };
      });
      if (!items) return null;
      for (const r of items.rows) collected.set(r.index, r.text);
      return items;
    };
    let snap = await grab();
    if (!snap) return [];
    let lastTop = -1;
    for (let step = 0; step < 200; step++) {
      await page.evaluate(() => {
        const s = document.querySelector('[data-virtuoso-scroller="true"]');
        if (s) s.scrollTop = s.scrollTop + s.clientHeight * 0.7;
      });
      await page.waitForTimeout(110);
      snap = await grab();
      if (!snap) break;
      const atBottom = snap.scrollTop + snap.clientHeight >= snap.scrollHeight - 4;
      if (atBottom || snap.scrollTop === lastTop) { await page.waitForTimeout(120); await grab(); break; }
      lastTop = snap.scrollTop;
    }
    return [...collected.entries()].sort((a, b) => a[0] - b[0]).map(([_, t]) => t);
  };

  const pickByText = async (text) => {
    await page.evaluate(() => { const s = document.querySelector('[data-virtuoso-scroller="true"]'); if (s) s.scrollTop = 0; });
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
      await page.waitForTimeout(100);
    }
    return false;
  };

  // 1. Airport list (already in AIR mode).
  console.log("scraping airports...");
  await openByClick("smta_place_of_arrival_air_foreigner");
  await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5000 }).catch(() => {});
  const airports = await scrapeOpenPicker();
  await closePicker();
  fs.writeFileSync(path.join(OUT, "place-arrival-air.txt"), airports.join("\n"));
  fs.writeFileSync(path.join(OUT, "place-arrival-air.json"), JSON.stringify(airports.map((a) => {
    const m = a.match(/^([A-Z]{3})\s*-\s*(.*)$/);
    return m ? { iata: m[1], name: m[2] } : { iata: null, name: a };
  }), null, 2));
  console.log("  airports:", airports.length, "saved");

  // 2. Switch to SEA to expose seaport + vessel-type.
  console.log("\nswitching Mode to SEA...");
  await openByClick("smta_mode_transport_foreigner");
  await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5000 }).catch(() => {});
  await pickByText("SEA");
  await page.waitForTimeout(800);
  const stillOpen = await page.evaluate(() => !!document.querySelector('[data-virtuoso-scroller="true"]'));
  if (stillOpen) await closePicker();

  console.log("scraping seaports...");
  await openByClick("smta_place_of_arrival_sea_foreigner");
  await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5000 }).catch(() => {});
  const seaports = await scrapeOpenPicker();
  await closePicker();
  fs.writeFileSync(path.join(OUT, "place-arrival-sea.txt"), seaports.join("\n"));
  fs.writeFileSync(path.join(OUT, "place-arrival-sea.json"), JSON.stringify(seaports, null, 2));
  console.log("  seaports:", seaports.length, "saved");

  console.log("\nscraping vessel types...");
  await openByClick("smta_vessel_type_foreigner");
  await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5000 }).catch(() => {});
  const vessels = await scrapeOpenPicker();
  await closePicker();
  fs.writeFileSync(path.join(OUT, "vessel-type.json"), JSON.stringify(vessels, null, 2));
  console.log("  vessel types:", vessels.length, "→", vessels.join(" | "));

  // 3. Switch back to AIR to leave the form in its prior state.
  console.log("\nswitching Mode back to AIR...");
  await openByClick("smta_mode_transport_foreigner");
  await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5000 }).catch(() => {});
  await pickByText("AIR");
  await page.waitForTimeout(700);
  const stillOpen2 = await page.evaluate(() => !!document.querySelector('[data-virtuoso-scroller="true"]'));
  if (stillOpen2) await closePicker();

  fs.writeFileSync("/tmp/claude/indonesia-recon/ports.network.json", JSON.stringify(reqs, null, 2));
  console.log("\nDone. New XHRs captured:", reqs.length);
  for (const r of reqs) console.log("  ", r.method, r.url, r.status || "(pending)");

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
