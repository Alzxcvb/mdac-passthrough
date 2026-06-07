// After step3-walk left selections in a state that hid sub-dropdowns, set
// AIR + RESIDENTIAL to expose the rest, then scrape every remaining picker.
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

  const openByClick = async (id) => {
    return await page.evaluate((id) => {
      const inp = document.getElementById(id);
      if (!inp) return { ok: false, reason: "no input " + id };
      let n = inp;
      let target = inp;
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
    for (let step = 0; step < 80; step++) {
      await page.evaluate(() => {
        const s = document.querySelector('[data-virtuoso-scroller="true"]');
        if (!s) return; s.scrollTop = s.scrollTop + s.clientHeight * 0.7;
      });
      await page.waitForTimeout(100);
      snap = await grab();
      if (!snap) break;
      const atBottom = snap.scrollTop + snap.clientHeight >= snap.scrollHeight - 4;
      if (atBottom || snap.scrollTop === lastTop) { await page.waitForTimeout(120); await grab(); break; }
      lastTop = snap.scrollTop;
    }
    return [...collected.entries()].sort((a, b) => a[0] - b[0]).map(([_, t]) => t);
  };

  const closePicker = async () => {
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(120); }
    await page.mouse.click(5, 5).catch(() => {});
    await page.waitForTimeout(200);
  };

  const pickOption = async (text) => {
    await page.evaluate(() => {
      const s = document.querySelector('[data-virtuoso-scroller="true"]');
      if (s) s.scrollTop = 0;
    });
    for (let pass = 0; pass < 60; pass++) {
      const found = await page.evaluate((text) => {
        const s = document.querySelector('[data-virtuoso-scroller="true"]');
        if (!s) return { ok: false, done: true };
        const rows = [...s.querySelectorAll('[data-index]')];
        for (const r of rows) {
          const t = (r.innerText || "").trim();
          if (t === text) {
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

  // Set Mode=AIR, Accommodation=RESIDENTIAL, Purpose=HOLIDAY (any non-OTHERS) to expose all sub-dropdowns.
  console.log("setting Mode=AIR");
  await setDropdown("smta_mode_transport_foreigner", "AIR");
  console.log("setting Purpose=HOLIDAY/SIGHTSEEING/LEISURE");
  await setDropdown("smta_purpose_travel_foreigner", "HOLIDAY/SIGHTSEEING/LEISURE");
  console.log("setting Accommodation=RESIDENTIAL");
  await setDropdown("smta_residence_type_foreigner", "RESIDENTIAL");

  // Snapshot current input list to find all sub-dropdowns now visible.
  const visible = await page.evaluate(() => {
    return [...document.querySelectorAll("input")].map((el) => ({
      id: el.id || null,
      placeholder: el.placeholder || null,
      readonly: el.hasAttribute("readonly"),
      value: el.value ? String(el.value).slice(0, 80) : null,
    }));
  });
  fs.writeFileSync(path.join(OUT, "step3-air-residential.json"), JSON.stringify(visible, null, 2));
  await page.screenshot({ path: path.join(OUT, "step3-air-residential.png"), fullPage: true });
  console.log("\nVisible inputs after AIR+RESIDENTIAL:", visible.length);
  for (const i of visible) console.log("  ", i.id || "(no-id)", i.readonly ? "[readonly]" : "", i.value ? "= " + i.value : "", i.placeholder ? "ph: " + i.placeholder : "");

  // Sub-dropdowns to scrape (every readonly input we don't already have options for).
  const KNOWN = new Set(["smta_mode_transport_foreigner", "smta_purpose_travel_foreigner", "smta_residence_type_foreigner"]);
  const subDropdowns = visible.filter((v) => v.readonly && v.id && !KNOWN.has(v.id) && v.value && /Select|^$/.test(v.value));

  console.log("\nSub-dropdowns to scrape:", subDropdowns.map((s) => s.id).join(", "));

  const subResults = {};
  for (const sd of subDropdowns) {
    console.log("\n--- scraping", sd.id);
    await openByClick(sd.id);
    await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5000 }).catch(() => {});
    const opts = await scrapeOpenPicker();
    subResults[sd.id] = { count: opts.length, sample: opts.slice(0, 8), tail: opts.slice(-3), full: opts };
    console.log("  ", opts.length, "options. sample:", opts.slice(0, 5).join(" | "));
    await closePicker();
  }

  // Switch to HOTEL accommodation and scrape its sub-dropdowns.
  console.log("\nsetting Accommodation=HOTEL");
  await setDropdown("smta_residence_type_foreigner", "HOTEL");
  const hotelVisible = await page.evaluate(() => {
    return [...document.querySelectorAll("input")].map((el) => ({
      id: el.id || null, placeholder: el.placeholder || null, readonly: el.hasAttribute("readonly"), value: el.value ? String(el.value).slice(0, 80) : null,
    }));
  });
  fs.writeFileSync(path.join(OUT, "step3-air-hotel.json"), JSON.stringify(hotelVisible, null, 2));
  const hotelSubs = hotelVisible.filter((v) => v.readonly && v.id && !KNOWN.has(v.id) && !subResults[v.id] && v.value && /Select|^$/.test(v.value));
  for (const sd of hotelSubs) {
    if (subResults[sd.id]) continue;
    console.log("\n--- scraping (HOTEL)", sd.id);
    await openByClick(sd.id);
    await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5000 }).catch(() => {});
    const opts = await scrapeOpenPicker();
    subResults[sd.id] = { count: opts.length, sample: opts.slice(0, 8), tail: opts.slice(-3), full: opts };
    await closePicker();
  }

  // Switch back to AIR but Purpose=OTHERS to expose travel_purpose_name_others (free text — no options).
  // and then SEA mode for sea-specific dropdowns.
  console.log("\nsetting Mode=SEA");
  await setDropdown("smta_mode_transport_foreigner", "SEA");
  const seaVisible = await page.evaluate(() => {
    return [...document.querySelectorAll("input")].map((el) => ({
      id: el.id || null, placeholder: el.placeholder || null, readonly: el.hasAttribute("readonly"), value: el.value ? String(el.value).slice(0, 80) : null,
    }));
  });
  fs.writeFileSync(path.join(OUT, "step3-sea-hotel.json"), JSON.stringify(seaVisible, null, 2));
  const seaSubs = seaVisible.filter((v) => v.readonly && v.id && !KNOWN.has(v.id) && !subResults[v.id] && v.value && /Select|^$/.test(v.value));
  for (const sd of seaSubs) {
    if (subResults[sd.id]) continue;
    console.log("\n--- scraping (SEA)", sd.id);
    await openByClick(sd.id);
    await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5000 }).catch(() => {});
    const opts = await scrapeOpenPicker();
    subResults[sd.id] = { count: opts.length, sample: opts.slice(0, 8), tail: opts.slice(-3), full: opts };
    await closePicker();
  }

  fs.writeFileSync(path.join(OUT, "step3-sub-dropdowns.json"), JSON.stringify(subResults, null, 2));
  console.log("\nDone. Sub-dropdowns saved to step3-sub-dropdowns.json");
  for (const [k, v] of Object.entries(subResults)) {
    console.log(`  ${k}: ${v.count} options`);
  }

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
