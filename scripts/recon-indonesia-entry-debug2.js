// Mirror the adapter's exact entry sequence with logging at each step to find
// where "Foreign Visitor" goes missing.
const { chromium } = require("playwright");
const ORIGIN = "https://allindonesia.imigrasi.go.id";

const has = (page, label) =>
  page.evaluate((l) => {
    const leaves = [...document.querySelectorAll("h1,h2,h3,h4,p,div,span,a,li,button")];
    return leaves.some((n) => n.children.length === 0 && (n.textContent || "").trim() === l);
  }, label);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })).newPage();
  page.setDefaultTimeout(30_000);

  await page.goto(`${ORIGIN}/`, { waitUntil: "networkidle" });
  console.log("after goto: has Languages?", await has(page, "Languages"), "| has Pengunjung Asing?", await has(page, "Pengunjung Asing"), "| has Foreign Visitor?", await has(page, "Foreign Visitor"));

  // click Languages (leaf+pointer)
  const langClick = await page.evaluate(() => {
    const n = [...document.querySelectorAll("h1,h2,h3,h4,p,div,span,a,li,button")].find((x) => x.children.length === 0 && (x.textContent || "").trim() === "Languages");
    if (!n) return "no-languages-leaf";
    let c = n; for (let i = 0; i < 10 && c; i++, c = c.parentElement) if (getComputedStyle(c).cursor === "pointer") { c.click(); return "ok"; }
    n.click(); return "ok-leaf";
  });
  console.log("Languages click:", langClick);
  await page.waitForTimeout(1000);
  console.log("after lang-open: has English?", await has(page, "English"), "| has Indonesia?", await has(page, "Indonesia"));

  const enClick = await page.evaluate(() => {
    const n = [...document.querySelectorAll("li,button,a,div,span")].find((x) => (x.textContent || "").trim() === "English");
    if (!n) return "no-english";
    let c = n; for (let i = 0; i < 8 && c; i++, c = c.parentElement) if (getComputedStyle(c).cursor === "pointer") { c.click(); return "ok"; }
    n.click(); return "ok-leaf";
  });
  console.log("English click:", enClick);

  // poll for Foreign Visitor up to 8s
  let appeared = false;
  for (let i = 0; i < 20; i++) {
    if (await has(page, "Foreign Visitor")) { appeared = true; console.log(`Foreign Visitor appeared after ${i * 400}ms`); break; }
    await page.waitForTimeout(400);
  }
  if (!appeared) console.log("Foreign Visitor NEVER appeared within 8s. has Pengunjung Asing?", await has(page, "Pengunjung Asing"));

  await browser.close();
})().catch((e) => { console.error("crashed:", e.message); process.exit(1); });
