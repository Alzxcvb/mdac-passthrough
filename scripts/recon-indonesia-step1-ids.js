// Reach step 1 (English + Foreign Visitor) and dump every input's id +
// placeholder + nearest label, so we can map the "Passport/Country/Region"
// (nationality) field that fillStep1 currently misses.
const { chromium } = require("playwright");
const ORIGIN = "https://allindonesia.imigrasi.go.id";

const clickPT = (page, label) =>
  page.evaluate((l) => {
    const all = [...document.querySelectorAll("h1,h2,h3,h4,p,div,span,a,li,button")];
    const n = all.find((x) => x.children.length === 0 && (x.textContent || "").trim() === l);
    if (!n) return false;
    let c = n; for (let i = 0; i < 10 && c; i++, c = c.parentElement) if (getComputedStyle(c).cursor === "pointer") { c.click(); return true; }
    n.click(); return true;
  }, label);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })).newPage();
  page.setDefaultTimeout(30_000);

  await page.goto(`${ORIGIN}/`, { waitUntil: "networkidle" });
  await clickPT(page, "Languages"); await page.waitForTimeout(700);
  await clickPT(page, "English");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
  // poll-click Foreign Visitor
  for (let i = 0; i < 20; i++) { if (await clickPT(page, "Foreign Visitor")) break; await page.waitForTimeout(400); }
  await page.waitForURL(/personal-information/, { timeout: 15_000 });
  await page.waitForTimeout(1500);

  const fields = await page.evaluate(() => {
    const labelFor = (el) => {
      // nearest preceding label-ish text
      let p = el.closest("div");
      for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
        const lbl = p.querySelector("label,p,span,h4");
        if (lbl && (lbl.textContent || "").trim()) return (lbl.textContent || "").trim().slice(0, 50);
      }
      return "";
    };
    return [...document.querySelectorAll("input,textarea")].map((el) => ({
      id: el.id || "",
      name: el.getAttribute("name") || "",
      placeholder: el.getAttribute("placeholder") || "",
      readOnly: el.readOnly || false,
      value: el.value || "",
      label: labelFor(el),
    }));
  });
  console.log(JSON.stringify(fields, null, 2));
  await browser.close();
})().catch((e) => { console.error("crashed:", e.message); process.exit(1); });
