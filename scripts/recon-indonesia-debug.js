// Inspect the current DOM around the nationality input + try several open
// strategies, then dump what's visible. No assumptions about popup shape.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon";

(async () => {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("personal-information"));
  if (!page) { console.error("not on personal-information"); process.exit(2); }
  await page.bringToFront();

  // Reset modal state.
  for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(150); }

  const before = await page.evaluate(() => ({
    bodyTextLen: document.body.innerText.length,
    inputCount: document.querySelectorAll("input").length,
    placeholders: [...document.querySelectorAll("input")].map((i) => i.placeholder).filter(Boolean),
  }));

  // Click strategies.
  const nat = page.locator('input[id^="spi_nationality_"]').first();
  const box = await nat.boundingBox();
  console.log("nat box:", box);
  // Click via coordinates — bypasses overlay logic.
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await nat.click({ force: true });
  }
  await page.waitForTimeout(800);

  const after = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll("input")].map((i) => ({
      placeholder: i.placeholder,
      id: i.id,
      visible: !!(i.offsetParent || i === document.activeElement),
    }));
    // Find any newly-mounted modal-ish container.
    const modals = [...document.querySelectorAll('[role="dialog"], [role="listbox"], [class*="modal" i], [class*="sheet" i], [class*="popup" i], [class*="drawer" i]')]
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role"),
        classes: typeof el.className === "string" ? el.className.slice(0, 200) : null,
        innerTextHead: (el.innerText || "").slice(0, 200),
      }));
    return {
      bodyTextLen: document.body.innerText.length,
      inputs,
      modals,
    };
  });
  console.log("before:", before);
  console.log("after:", JSON.stringify(after, null, 2));
  await page.screenshot({ path: path.join(OUT, "debug-after-click.png"), fullPage: true });
  fs.writeFileSync(path.join(OUT, "debug-html-after-click.html"), await page.content());
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
