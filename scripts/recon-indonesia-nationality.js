// Probe the nationality ("Passport/Country/Region") virtuoso: open it, report
// whether the scroller appears, how many rows, and the first/matching row texts.
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
  for (let i = 0; i < 20; i++) { if (await clickPT(page, "Foreign Visitor")) break; await page.waitForTimeout(400); }
  await page.waitForURL(/personal-information/, { timeout: 15_000 });
  await page.waitForTimeout(1500);

  // Open the nationality picker (click cursor:pointer ancestor of the input).
  const opened = await page.evaluate(() => {
    const inp = document.querySelector('[id^="spi_nationality_"]');
    if (!inp) return "no-input";
    let n = inp, target = inp;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) if (getComputedStyle(n).cursor === "pointer") { target = n; break; }
    const r = target.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window };
    target.dispatchEvent(new MouseEvent("mousedown", o));
    target.dispatchEvent(new MouseEvent("mouseup", o));
    target.dispatchEvent(new MouseEvent("click", o));
    return "clicked";
  });
  console.log("open nationality:", opened);
  await page.waitForTimeout(1500);

  const scroller = await page.locator('[data-virtuoso-scroller="true"]').count();
  console.log("virtuoso scrollers present:", scroller);

  // search box?
  const hasSearch = await page.locator('input[placeholder="Search" i]').count();
  console.log("search inputs:", hasSearch);

  const rows = await page.evaluate(() => {
    const s = document.querySelector('[data-virtuoso-scroller="true"]');
    if (!s) return { rows: 0, sample: [], hasUSA: false };
    const rs = [...s.querySelectorAll("[data-index]")].map((r) => (r.textContent || "").trim());
    return { rows: rs.length, sample: rs.slice(0, 10), hasUSA: rs.some((t) => t === "UNITED STATES OF AMERICA") };
  });
  console.log("rows:", JSON.stringify(rows, null, 2));

  // If there's a search, try typing into it and re-sample.
  if (hasSearch > 0) {
    await page.locator('input[placeholder="Search" i]').first().fill("UNITED STATES");
    await page.waitForTimeout(1000);
    const after = await page.evaluate(() => {
      const s = document.querySelector('[data-virtuoso-scroller="true"]');
      if (!s) return { rows: 0, sample: [] };
      const rs = [...s.querySelectorAll("[data-index]")].map((r) => (r.textContent || "").trim());
      return { rows: rs.length, sample: rs.slice(0, 8) };
    });
    console.log("after search 'UNITED STATES':", JSON.stringify(after, null, 2));
  }

  await browser.close();
})().catch((e) => { console.error("crashed:", e.message); process.exit(1); });
