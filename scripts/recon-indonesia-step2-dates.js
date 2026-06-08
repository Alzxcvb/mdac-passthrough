// Walk to step 2 and dump the arrival-date picker: search box? row format?
// Reuses the now-working step-1 fill logic.
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

const openV = (page, sel) =>
  page.evaluate((s) => {
    const inp = document.querySelector(s); if (!inp) return false;
    let n = inp, target = inp;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) if (getComputedStyle(n).cursor === "pointer") { target = n; break; }
    const r = target.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window };
    target.dispatchEvent(new MouseEvent("mousedown", o)); target.dispatchEvent(new MouseEvent("mouseup", o)); target.dispatchEvent(new MouseEvent("click", o));
    return true;
  }, sel);

async function pickV(page, sel, text) {
  await openV(page, sel); await page.waitForTimeout(500);
  const search = page.locator('input[placeholder="Search" i]').first();
  if (await search.isVisible().catch(() => false)) { await search.fill(text); await page.waitForTimeout(700); }
  for (let p = 0; p < 60; p++) {
    const ok = await page.evaluate((t) => {
      const s = document.querySelector('[data-virtuoso-scroller="true"]'); if (!s) return false;
      for (const r of [...s.querySelectorAll("[data-index]")]) if ((r.textContent || "").trim() === t) { ((r.firstElementChild) || r).click(); return true; }
      s.scrollTop += s.clientHeight * 0.7; return false;
    }, text);
    if (ok) return true; await page.waitForTimeout(120);
  }
  return false;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" })).newPage();
  page.setDefaultTimeout(30_000);

  await page.goto(`${ORIGIN}/`, { waitUntil: "networkidle" });
  await clickPT(page, "Languages"); await page.waitForTimeout(700); await clickPT(page, "English");
  await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1200);
  for (let i = 0; i < 20; i++) { if (await clickPT(page, "Foreign Visitor")) break; await page.waitForTimeout(400); }
  await page.waitForURL(/personal-information/); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1200);

  // step 1
  await pickV(page, '[id^="spi_nationality_"]', "UNITED STATES OF AMERICA");
  await page.fill('[id^="spi_full_name_"]', "TEST RECON");
  await page.fill('[id^="spi_dob_"]', "15/01/1990");
  await pickV(page, '[id^="spi_country_or_place_of_birth_"]', "UNITED STATES OF AMERICA");
  await page.evaluate(() => { const i = [...document.querySelectorAll("input")].find((x) => x.value === "MALE"); let n = i; for (let k = 0; k < 6 && n; k++, n = n.parentElement) if (getComputedStyle(n).cursor === "pointer") { n.click(); return; } i && i.click(); });
  await page.fill('[id^="spi_passport_no_"]', "X0000001");
  await page.fill('[id^="spi_date_of_passport_expiry_"]', "31/12/2030");
  await page.fill('[id^="spi_mobile_no_"]', "5551234567");
  await page.fill('[id^="spi_email_"]', "arrivalpass.smoke@gmail.com");
  await clickPT(page, "Next");
  await page.waitForURL(/travel-details/, { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1500);
  console.log("on:", page.url());

  // open arrival date picker + dump
  await openV(page, "#std_arrival_date_foreigner_individual");
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => {
    const s = document.querySelector('[data-virtuoso-scroller="true"]');
    const search = document.querySelector('input[placeholder="Search" i]');
    return {
      scroller: !!s,
      hasSearch: !!search,
      searchPlaceholder: search ? search.getAttribute("placeholder") : null,
      rows: s ? [...s.querySelectorAll("[data-index]")].slice(0, 14).map((r) => (r.textContent || "").trim()) : [],
    };
  });
  console.log("arrival-date picker:", JSON.stringify(info, null, 2));
  await browser.close();
})().catch((e) => { console.error("crashed:", e.message); process.exit(1); });
