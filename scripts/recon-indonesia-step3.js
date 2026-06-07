// Walk every dropdown on step 3 (mode-of-transport/foreigner). For each:
// open the bottom-sheet picker, scroll-collect every option, then pick each
// option in turn to detect conditional fields. Restore selection to "" when
// done so user's burner state is unchanged.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon";

const DROPDOWNS = [
  { id: "smta_mode_transport_foreigner", label: "Mode of Transport" },
  { id: "smta_purpose_travel_foreigner", label: "Purpose of Travel" },
  { id: "smta_residence_type_foreigner", label: "Type of Accommodation" },
];

const baseInputIds = (data) => data.inputs.map((i) => i.id || `(no-id)#${i.value || i.placeholder || ""}`).sort();

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("mode-of-transport"));
  if (!page) { console.error("not on mode-of-transport"); process.exit(2); }
  await page.bringToFront();
  for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(120); }

  const snapForm = async () => {
    return await page.evaluate(() => {
      const inputs = [...document.querySelectorAll("input, select, textarea")].map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        placeholder: el.placeholder || null,
        type: el.type || null,
        readonly: el.hasAttribute("readonly"),
        value: el.value ? String(el.value).slice(0, 80) : null,
      }));
      const labels = [...document.querySelectorAll("label, p, h1, h2, h3, h4")]
        .map((l) => (l.innerText || "").trim())
        .filter((t) => t.length > 0 && t.length < 200);
      return { inputs, labels };
    });
  };

  const openByClickingInput = async (id) => {
    return await page.evaluate((id) => {
      const inp = document.getElementById(id);
      if (!inp) return { ok: false };
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
    const collectVisible = async () => {
      const items = await page.evaluate(() => {
        const scroller = document.querySelector('[data-virtuoso-scroller="true"]');
        if (!scroller) return null;
        const rows = [...scroller.querySelectorAll('[data-index]')];
        return {
          rows: rows.map((r) => ({ index: parseInt(r.getAttribute("data-index"), 10), text: (r.innerText || "").trim() })).filter((r) => Number.isFinite(r.index)),
          scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight,
        };
      });
      if (!items) return null;
      for (const r of items.rows) collected.set(r.index, r.text);
      return items;
    };
    let snap = await collectVisible();
    if (!snap) return [];
    let lastTop = -1;
    for (let step = 0; step < 80; step++) {
      const advanced = await page.evaluate(() => {
        const s = document.querySelector('[data-virtuoso-scroller="true"]');
        if (!s) return null;
        const before = s.scrollTop;
        s.scrollTop = before + s.clientHeight * 0.7;
        return { before, after: s.scrollTop };
      });
      await page.waitForTimeout(100);
      snap = await collectVisible();
      if (!snap) break;
      const atBottom = snap.scrollTop + snap.clientHeight >= snap.scrollHeight - 4;
      if (atBottom || snap.scrollTop === lastTop) { await page.waitForTimeout(120); await collectVisible(); break; }
      lastTop = snap.scrollTop;
    }
    return [...collected.entries()].sort((a, b) => a[0] - b[0]).map(([_, t]) => t);
  };

  const closePicker = async () => {
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(120); }
    // tap outside the bottom sheet area
    await page.mouse.click(5, 5).catch(() => {});
    await page.waitForTimeout(200);
  };

  const pickOption = async (text) => {
    return await page.evaluate((text) => {
      const scroller = document.querySelector('[data-virtuoso-scroller="true"]');
      if (!scroller) return { ok: false, reason: "no scroller" };
      // Scroll back to top first.
      scroller.scrollTop = 0;
      return { ok: true };
    }, text).then(async () => {
      // Re-render at top, then incrementally scroll while looking for a row whose text matches.
      for (let pass = 0; pass < 60; pass++) {
        const found = await page.evaluate((text) => {
          const scroller = document.querySelector('[data-virtuoso-scroller="true"]');
          if (!scroller) return { ok: false };
          const rows = [...scroller.querySelectorAll('[data-index]')];
          for (const r of rows) {
            const t = (r.innerText || "").trim();
            if (t === text) {
              const inner = r.querySelector('._list_dropdown_1plhr_8, div[style*="cursor"]') || r;
              const rect = inner.getBoundingClientRect();
              const opts = { bubbles: true, cancelable: true, clientX: rect.left + 20, clientY: rect.top + rect.height / 2, view: window };
              inner.dispatchEvent(new MouseEvent("mousedown", opts));
              inner.dispatchEvent(new MouseEvent("mouseup", opts));
              inner.dispatchEvent(new MouseEvent("click", opts));
              return { ok: true };
            }
          }
          // not visible — advance scroller
          scroller.scrollTop = scroller.scrollTop + scroller.clientHeight * 0.7;
          return { ok: false, scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight };
        }, text);
        if (found.ok) return true;
        await page.waitForTimeout(120);
      }
      return false;
    });
  };

  const result = {};
  const baseline = await snapForm();
  result.baseline = { inputCount: baseline.inputs.length, ids: baseInputIds(baseline) };
  fs.writeFileSync(path.join(OUT, "step3-baseline.json"), JSON.stringify(baseline, null, 2));

  for (const dd of DROPDOWNS) {
    console.log("\n=== dropdown:", dd.label);
    const slot = { options: [], conditionals: {} };

    // Open + scrape options.
    await openByClickingInput(dd.id);
    await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5000 }).catch(() => {});
    const options = await scrapeOpenPicker();
    slot.options = options;
    console.log("options:", options.length, options.slice(0, 6).join(" | "), options.length > 6 ? "..." : "");
    await closePicker();

    // Pick each option, snapshot, detect new fields.
    for (const opt of options) {
      await openByClickingInput(dd.id);
      await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5000 }).catch(() => {});
      const picked = await pickOption(opt);
      await page.waitForTimeout(700);
      // The pick may have closed the popup automatically; if not, close it.
      const stillOpen = await page.evaluate(() => !!document.querySelector('[data-virtuoso-scroller="true"]'));
      if (stillOpen) await closePicker();
      const after = await snapForm();
      const baseIds = new Set(result.baseline.ids);
      const newIds = baseInputIds(after).filter((x) => !baseIds.has(x));
      const newLabels = after.labels.filter((l) => !baseline.labels.includes(l));
      slot.conditionals[opt] = {
        picked, // false if not selectable / not found
        inputCountDelta: after.inputs.length - result.baseline.inputCount,
        newInputIds: newIds,
        newLabels,
      };
      console.log(`  ${opt}: +${after.inputs.length - result.baseline.inputCount} inputs ${newIds.length ? "[" + newIds.join(", ") + "]" : ""}`);
    }
    result[dd.id] = slot;
    // Reset this dropdown — most don't support clear, so we leave the last selection. User saw it before; will re-pick before Next.
  }

  fs.writeFileSync(path.join(OUT, "step3-walk.json"), JSON.stringify(result, null, 2));
  await page.screenshot({ path: path.join(OUT, "step3-final.png"), fullPage: true });
  console.log("\nDone. Output:", path.join(OUT, "step3-walk.json"));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
