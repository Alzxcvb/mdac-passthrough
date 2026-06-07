// Open the Arrival Date readonly input on travel-details/individual and dump
// whatever picker mounts. Same Chrome on CDP 9222.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon";

(async () => {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("travel-details"));
  if (!page) { console.error("not on travel-details"); process.exit(2); }
  await page.bringToFront();
  for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(120); }

  // Snapshot DOM size before clicking — anything new added after the click is the picker.
  const before = await page.evaluate(() => ({
    htmlLen: document.documentElement.outerHTML.length,
    inputCount: document.querySelectorAll("input").length,
  }));

  // Click the arrival date input via DOM event dispatch (readonly + custom widget).
  const open = await page.evaluate(() => {
    const inp = document.getElementById("std_arrival_date_foreigner_individual");
    if (!inp) return { ok: false, reason: "no input" };
    // Click the input row wrapper (parent / grandparent — whichever has cursor:pointer)
    let n = inp;
    let target = inp;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.cursor === "pointer") { target = n; break; }
    }
    const r = target.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.top + r.height / 2, view: window };
    target.dispatchEvent(new MouseEvent("mousedown", opts));
    target.dispatchEvent(new MouseEvent("mouseup", opts));
    target.dispatchEvent(new MouseEvent("click", opts));
    inp.focus();
    return { ok: true, target: target.tagName, classes: typeof target.className === "string" ? target.className.slice(0, 100) : null };
  });
  console.log("open:", open);
  await page.waitForTimeout(1200);

  const after = await page.evaluate(() => {
    const overlays = [...document.querySelectorAll("body > div, body > *")]
      .filter((el) => {
        const cs = getComputedStyle(el);
        return cs.position === "fixed" && parseInt(cs.zIndex || "0", 10) > 1000;
      });
    return {
      htmlLen: document.documentElement.outerHTML.length,
      overlayCount: overlays.length,
      overlays: overlays.map((el) => ({
        tag: el.tagName,
        zIndex: getComputedStyle(el).zIndex,
        innerTextHead: (el.innerText || "").slice(0, 400),
        outerHtml: el.outerHTML.slice(0, 6000),
      })),
    };
  });
  console.log("after:", { htmlDelta: after.htmlLen - before.htmlLen, overlays: after.overlayCount });
  fs.writeFileSync(path.join(OUT, "step2-arrival-picker.json"), JSON.stringify(after, null, 2));
  await page.screenshot({ path: path.join(OUT, "step2-arrival-picker.png"), fullPage: true });

  // Save full HTML for offline parsing.
  fs.writeFileSync(path.join(OUT, "step2-arrival-picker.html"), await page.content());

  await page.keyboard.press("Escape").catch(() => {});
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
