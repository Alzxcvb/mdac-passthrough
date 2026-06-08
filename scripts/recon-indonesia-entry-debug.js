// Diagnostic: why does fillIndonesiaToDeclaration fail at the entry nav?
// Launches headless, loads the site, and reports:
//   - did the page load (url/title/body size, any bot-challenge markers)
//   - is there a "Foreign Visitor" element, what tag/cursor is it
//   - does clickByText (button/[role=button] only) match it?
//   - does the cursor-pointer-walk click navigate to /personal-information/?
// Does NOT submit anything.
const { chromium } = require("playwright");
const fs = require("fs");

const ORIGIN = "https://allindonesia.imigrasi.go.id";
const OUT = "/tmp/claude/id-entry";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);

  console.log("goto", ORIGIN);
  await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" }).catch((e) => console.log("goto err:", e.message));
  await page.waitForTimeout(4000);
  console.log("url:", page.url());
  console.log("title:", await page.title());

  const diag = await page.evaluate(() => {
    const bodyText = document.body?.innerText || "";
    const challenge = /just a moment|checking your browser|cloudflare|verify you are human|captcha/i.test(bodyText);
    // find "Foreign Visitor" leaf
    const all = [...document.querySelectorAll("h1,h2,h3,h4,p,div,span,a,button")];
    const node = all.find((n) => n.children.length === 0 && (n.textContent || "").trim() === "Foreign Visitor");
    let info = null;
    if (node) {
      let cur = node, pointerTag = null;
      for (let i = 0; i < 8 && cur; i++, cur = cur.parentElement) {
        if (getComputedStyle(cur).cursor === "pointer") { pointerTag = cur.tagName + "." + (cur.className || ""); break; }
      }
      info = {
        leafTag: node.tagName,
        leafClass: String(node.className || ""),
        isButtonOrRole: !!node.closest("button, [role='button']"),
        pointerAncestor: pointerTag,
      };
    }
    // what buttons/[role=button] texts exist (clickByText search space)
    const btnTexts = [...document.querySelectorAll("button, [role='button']")]
      .map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 30);
    return { bodyLen: bodyText.length, challenge, hasForeignVisitorLeaf: !!node, info, btnTexts };
  });
  console.log("diag:", JSON.stringify(diag, null, 2));
  fs.writeFileSync(`${OUT}/landing.png`, await page.screenshot({ fullPage: true }));

  // Attempt the cursor-pointer-walk click (the recon approach).
  console.log("\nattempting cursor-pointer-walk click on 'Foreign Visitor'...");
  const clicked = await page.evaluate(() => {
    const all = [...document.querySelectorAll("h1,h2,h3,h4,p,div,span,a,button")];
    const node = all.find((n) => n.children.length === 0 && (n.textContent || "").trim() === "Foreign Visitor");
    if (!node) return "no-node";
    let cur = node;
    for (let i = 0; i < 8 && cur; i++, cur = cur.parentElement) {
      if (getComputedStyle(cur).cursor === "pointer") { cur.click(); return "clicked-pointer-ancestor"; }
    }
    node.click();
    return "clicked-leaf";
  });
  console.log("click result:", clicked);
  const navigated = await page
    .waitForURL(/personal-information/, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  console.log("navigated to personal-information:", navigated, "| url:", page.url());
  fs.writeFileSync(`${OUT}/after-click.png`, await page.screenshot({ fullPage: true }));
  console.log(`\nartifacts in ${OUT}`);

  await browser.close();
})().catch((e) => { console.error("crashed:", e); process.exit(1); });
