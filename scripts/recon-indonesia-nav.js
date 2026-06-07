// Drive the already-open All-Indonesia tab: pick English language, click
// "Foreign Visitor", wait for the personal-information step to render, then
// hand control back to recon-indonesia.js.
const { chromium } = require("playwright");

const CDP = "http://127.0.0.1:9222";

(async () => {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("allindonesia.imigrasi.go.id"));
  if (!page) { console.error("No allindonesia tab"); process.exit(2); }
  await page.bringToFront();

  // 1. Languages dropdown -> English (only act if not already English).
  const langBtn = page.getByRole("button", { name: /Languages/i }).first();
  if (await langBtn.isVisible().catch(() => false)) {
    await langBtn.click();
    await page.waitForTimeout(400);
    // Try a few common selectors for the English option.
    const englishCandidates = [
      page.getByRole("menuitem", { name: /^English/i }),
      page.getByRole("option", { name: /^English/i }),
      page.locator("button, [role='button'], li, a").filter({ hasText: /^English\s*$/i }).first(),
    ];
    let clicked = false;
    for (const c of englishCandidates) {
      if (await c.first().isVisible().catch(() => false)) {
        await c.first().click();
        clicked = true;
        break;
      }
    }
    if (!clicked) console.warn("Could not find English option — closing dropdown");
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
  }

  // 2. Click Foreign Visitor.
  const fvCandidates = [
    page.getByRole("link", { name: /Foreign Visitor/i }),
    page.getByRole("button", { name: /Foreign Visitor/i }),
    page.locator("a, [role='button'], button, div").filter({ hasText: /^Foreign Visitor$/i }).first(),
    page.getByText(/^Foreign Visitor$/i).first(),
  ];
  let clicked = false;
  for (const c of fvCandidates) {
    if (await c.first().isVisible().catch(() => false)) {
      await Promise.all([
        page.waitForURL(/arrival-card-submission|foreign|personal/i, { timeout: 8000 }).catch(() => {}),
        c.first().click(),
      ]);
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    // Fallback: click the heading element's nearest clickable ancestor.
    await page.evaluate(() => {
      const all = [...document.querySelectorAll("*")];
      const target = all.find((n) => n.children.length === 0 && /^Foreign Visitor$/i.test(n.textContent.trim()));
      if (target) {
        let n = target;
        for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (n.tagName === "A" || n.tagName === "BUTTON" || cs.cursor === "pointer" || n.getAttribute("role") === "button") {
            n.click();
            return n.tagName + " " + (n.className || "");
          }
        }
      }
      return null;
    });
  }

  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  console.log("URL after navigation:", page.url());
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
