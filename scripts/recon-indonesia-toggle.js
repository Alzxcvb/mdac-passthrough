// Step 2 conditionals + date-picker recon. Reversible — restores prior state.
// Operates on whatever All-Indonesia tab is currently in /travel-details/*.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("travel-details"));
  if (!page) { console.error("not on travel-details"); process.exit(2); }
  await page.bringToFront();
  for (let i = 0; i < 2; i++) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(120); }

  // The visa/KITAS/KITAP container holds the two clickable chips. Each chip's
  // value is in a readonly <input value="Yes|No">; the click handler is on
  // the chip's flex-row wrapper (grandparent of the input, two divs up).
  const visaChip = (label) =>
    page.locator(
      `#std_do_have_visa_kitas_kitap_foreigner_individual input[value="${label}"]`
    ).first();
  const clickChip = async (label) => {
    // Walk up from the input until we find the clickable flex-row wrapper, then
    // click its center. The wrapper has the onClick — clicking the input alone
    // doesn't bubble (React listens on the row).
    const ok = await page.evaluate((label) => {
      const container = document.getElementById("std_do_have_visa_kitas_kitap_foreigner_individual");
      if (!container) return { ok: false, reason: "no container" };
      const inp = [...container.querySelectorAll("input")].find((i) => i.value === label);
      if (!inp) return { ok: false, reason: "no input" };
      // The clickable wrapper is the nearest ancestor with display:flex AND a
      // border / cursor:pointer style. Walk up.
      let n = inp.parentElement;
      let target = null;
      for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.cursor === "pointer" || (cs.borderTopWidth && cs.borderTopWidth !== "0px")) {
          target = n; break;
        }
      }
      target = target || inp.parentElement;
      const r = target.getBoundingClientRect();
      // Synthesize a real click sequence at center.
      const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window };
      target.dispatchEvent(new MouseEvent("mousedown", opts));
      target.dispatchEvent(new MouseEvent("mouseup", opts));
      target.dispatchEvent(new MouseEvent("click", opts));
      return { ok: true, tag: target.tagName, classes: target.className && String(target.className).slice(0, 100) };
    }, label);
    return ok;
  };

  // Snapshot full DOM state of the form region (input list + visible labels).
  const snapForm = async (tag) => {
    const data = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll("input, select, textarea")].map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        name: el.name || null,
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
    fs.writeFileSync(path.join(OUT, `step2-${tag}.json`), JSON.stringify(data, null, 2));
    return data;
  };

  const before = await snapForm("before-toggle");
  console.log("before toggle inputs:", before.inputs.length);

  // Detect which radio is currently active (by looking at the radio dot).
  const initial = await page.evaluate(() => {
    // Yes/No are styled as dots; the selected one has a filled circle. Read
    // its aria-checked or inferred state by looking for an inner solid div.
    const findRadio = (label) => {
      const all = [...document.querySelectorAll("*")];
      const lab = all.find((n) => n.children.length === 0 && n.textContent.trim() === label);
      if (!lab) return null;
      // Walk up to the row container and check for a filled inner dot.
      let row = lab.closest("[class*='_list_dropdown'], div");
      // fallback: just look at sibling for the radio circle
      const circle = (row || lab.parentElement).querySelector("div[style*='border'][style*='border-radius']");
      if (!circle) return { found: true, selected: false };
      const inner = circle.querySelector("div");
      const filled = !!(inner && inner.getBoundingClientRect().width > 4);
      return { found: true, selected: filled, label };
    };
    return { yes: findRadio("Yes"), no: findRadio("No") };
  });
  console.log("initial radios:", initial);

  // Click Yes
  const yesClick = await clickChip("Yes");
  console.log("clicked Yes wrapper:", yesClick);
  await page.waitForTimeout(800);
  const yesSnap = await snapForm("after-yes");
  await page.screenshot({ path: path.join(OUT, "step2-after-yes.png"), fullPage: true });
  console.log("after Yes — input count:", yesSnap.inputs.length);

  // Click No
  await clickChip("No");
  await page.waitForTimeout(800);
  const noSnap = await snapForm("after-no");
  await page.screenshot({ path: path.join(OUT, "step2-after-no.png"), fullPage: true });
  console.log("after No — input count:", noSnap.inputs.length);

  // Restore: if neither was selected initially, click selected one again to deselect — most radio groups don't support deselect, leave at "No" (cheap default).
  // (Skip restore. User filled burner data; "No" is a benign default and they'll re-select before Next.)

  // Click the Arrival Date readonly input to open whatever picker (calendar bottom sheet most likely).
  const arrivalBox = await page.locator('#std_arrival_date_foreigner_individual').boundingBox();
  if (arrivalBox) {
    await page.mouse.click(arrivalBox.x + arrivalBox.width / 2, arrivalBox.y + arrivalBox.height / 2);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, "step2-arrival-picker.png"), fullPage: true });
    const picker = await page.evaluate(() => {
      // Find the topmost fixed-position overlay added.
      const overlays = [...document.querySelectorAll("body > div, body > *")]
        .filter((el) => {
          const cs = getComputedStyle(el);
          return cs.position === "fixed" && parseInt(cs.zIndex || "0", 10) > 1000;
        });
      const inner = overlays.length ? overlays[overlays.length - 1].outerHTML.slice(0, 8000) : null;
      const headings = [...document.querySelectorAll("[class*='month'], [class*='Month'], [class*='calendar'], [class*='Calendar'], [class*='picker']")].map((e) => (e.innerText || "").trim().slice(0, 100)).filter(Boolean).slice(0, 10);
      const buttons = [...document.querySelectorAll("button")].map((b) => (b.innerText || "").trim()).filter(Boolean);
      return { overlayCount: overlays.length, innerSample: inner ? inner.slice(0, 1500) : null, headings, buttons };
    });
    fs.writeFileSync(path.join(OUT, "step2-arrival-picker.json"), JSON.stringify(picker, null, 2));
    console.log("arrival picker:", { overlayCount: picker.overlayCount, headingsSample: picker.headings.slice(0, 5) });
  }
  await page.keyboard.press("Escape").catch(() => {});

  console.log("done. artifacts in", OUT);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
