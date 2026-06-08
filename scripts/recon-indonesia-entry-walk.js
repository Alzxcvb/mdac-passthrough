// Walk the REAL Indonesia entry flow: switch to English, then click through
// the arrival-card entry to reach the personal-information step. Logs texts +
// screenshots at each stage. Does NOT submit.
const { chromium } = require("playwright");
const fs = require("fs");

const ORIGIN = "https://allindonesia.imigrasi.go.id";
const OUT = "/tmp/claude/id-walk";

const clickByPointerText = (page, text) =>
  page.evaluate((label) => {
    const all = [...document.querySelectorAll("h1,h2,h3,h4,p,div,span,a,button,li")];
    const node = all.find((n) => n.children.length === 0 && (n.textContent || "").trim() === label);
    if (!node) return "no-node:" + label;
    let cur = node;
    for (let i = 0; i < 10 && cur; i++, cur = cur.parentElement) {
      if (getComputedStyle(cur).cursor === "pointer") { cur.click(); return "ok-pointer:" + label; }
    }
    node.click();
    return "ok-leaf:" + label;
  }, text);

const dumpTexts = (page) =>
  page.evaluate(() => {
    const clickable = [...document.querySelectorAll("button,[role='button'],a")]
      .map((b) => (b.textContent || "").trim()).filter(Boolean);
    const cards = [...document.querySelectorAll("h1,h2,h3,h4")]
      .map((b) => (b.textContent || "").trim()).filter(Boolean);
    const pointerLeaves = [...document.querySelectorAll("div,span,p,li")]
      .filter((n) => n.children.length === 0 && (n.textContent || "").trim() && getComputedStyle(n).cursor === "pointer")
      .map((n) => (n.textContent || "").trim());
    return { clickable: [...new Set(clickable)].slice(0, 40), headings: [...new Set(cards)].slice(0, 20), pointerLeaves: [...new Set(pointerLeaves)].slice(0, 40) };
  });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);

  await page.goto(`${ORIGIN}/`, { waitUntil: "networkidle" }).catch((e) => console.log("goto:", e.message));
  await page.waitForTimeout(2500);
  console.log("=== LANDING (default lang) ===", page.url());
  console.log(JSON.stringify(await dumpTexts(page), null, 2));
  fs.writeFileSync(`${OUT}/1-landing.png`, await page.screenshot({ fullPage: true }));

  // --- switch language to English ---
  console.log("\n=== open Languages ===");
  console.log("lang click:", await clickByPointerText(page, "Languages"));
  await page.waitForTimeout(1200);
  const langOpts = await page.evaluate(() =>
    [...document.querySelectorAll("li,button,a,div,span")]
      .map((n) => (n.textContent || "").trim())
      .filter((t) => /english|indonesia|inggris/i.test(t) && t.length < 30)
  );
  console.log("lang options seen:", JSON.stringify([...new Set(langOpts)].slice(0, 15)));
  for (const opt of ["English", "Inggris", "EN"]) {
    const r = await clickByPointerText(page, opt);
    if (r.startsWith("ok")) { console.log("picked lang:", r); break; }
  }
  await page.waitForTimeout(1500);
  fs.writeFileSync(`${OUT}/2-after-lang.png`, await page.screenshot({ fullPage: true }));
  console.log("after-lang texts:", JSON.stringify(await dumpTexts(page), null, 2));

  // --- click the arrival-card entry card ---
  console.log("\n=== click arrival-card entry ===");
  for (const label of ["Arrival Card Service", "Arrival Card", "Layanan Kartu Kedatangan", "Get Started", "Start"]) {
    const r = await clickByPointerText(page, label);
    console.log("try:", r);
    if (r.startsWith("ok")) break;
  }
  await page.waitForTimeout(2500);
  console.log("url now:", page.url());
  fs.writeFileSync(`${OUT}/3-after-entry.png`, await page.screenshot({ fullPage: true }));
  console.log("entry texts:", JSON.stringify(await dumpTexts(page), null, 2));

  // --- pick Foreign Visitor / Foreigner if a choice appears ---
  console.log("\n=== pick foreigner ===");
  for (const label of ["Foreign Visitor", "Foreigner", "Foreign National", "WNA", "Non-Indonesian"]) {
    const r = await clickByPointerText(page, label);
    console.log("try:", r);
    if (r.startsWith("ok")) break;
  }
  await page.waitForTimeout(2500);
  console.log("FINAL url:", page.url());
  const reached = /personal-information/.test(page.url());
  console.log("reached personal-information:", reached);
  fs.writeFileSync(`${OUT}/4-final.png`, await page.screenshot({ fullPage: true }));
  if (!reached) console.log("final texts:", JSON.stringify(await dumpTexts(page), null, 2));

  console.log(`\nartifacts in ${OUT}`);
  await browser.close();
})().catch((e) => { console.error("crashed:", e); process.exit(1); });
