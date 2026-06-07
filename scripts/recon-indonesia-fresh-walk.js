// Open a NEW Chrome tab via CDP and walk a fresh foreigner flow with full
// network logging. Captures the REAL submit URLs for step 1 (split into
// 3 sub-calls per the SPA pattern) and step 2 — currently unknowns.
//
// Uses placeholder burner data; stops at step 3 (does NOT advance to step 4
// or submit final).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const OUT = "/tmp/claude/indonesia-recon";

(async () => {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);

  const reqs = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http")) return;
    if (/\.(png|jpg|jpeg|svg|gif|woff2?|css|ico|js|map)(\?|$)/i.test(r.url())) return;
    reqs.push({ ts: Date.now(), method: r.method(), url: r.url(), postData: r.postData() || null });
  });
  page.on("response", async (resp) => {
    const m = reqs.find((q) => q.url === resp.url() && !q.status);
    if (!m) return;
    m.status = resp.status();
    try { if ((resp.headers()["content-type"] || "").includes("json")) m.responseJson = await resp.json().catch(() => null); } catch (_) {}
  });

  console.log("navigating...");
  await page.goto("https://allindonesia.imigrasi.go.id/");
  await page.waitForTimeout(1500);
  // Click Foreign Visitor.
  await page.evaluate(() => {
    const all = [...document.querySelectorAll("h1, h2, h3, h4, p, div, span, a, button")];
    const node = all.find((n) => n.children.length === 0 && (n.textContent || "").trim() === "Foreign Visitor");
    if (!node) return;
    let cur = node;
    for (let i = 0; i < 8 && cur; i++, cur = cur.parentElement) {
      if (getComputedStyle(cur).cursor === "pointer") { cur.click(); return; }
    }
    node.click();
  });
  await page.waitForURL(/personal-information/, { timeout: 15_000 });
  console.log("on:", page.url());

  // Helpers — match recon scripts.
  const openByClick = async (sel) => page.evaluate((s) => {
    const inp = document.querySelector(s);
    if (!inp) return false;
    let n = inp; let target = inp;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      if (getComputedStyle(n).cursor === "pointer") { target = n; break; }
    }
    const r = target.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window };
    target.dispatchEvent(new MouseEvent("mousedown", opts));
    target.dispatchEvent(new MouseEvent("mouseup", opts));
    target.dispatchEvent(new MouseEvent("click", opts));
    return true;
  }, sel);

  const closePopup = async () => {
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(120); }
    await page.mouse.click(5, 5).catch(() => {});
    await page.waitForTimeout(150);
  };

  const pickByText = async (text) => {
    await page.evaluate(() => { const s = document.querySelector('[data-virtuoso-scroller="true"]'); if (s) s.scrollTop = 0; });
    for (let pass = 0; pass < 80; pass++) {
      const r = await page.evaluate((t) => {
        const s = document.querySelector('[data-virtuoso-scroller="true"]');
        if (!s) return { ok: false, done: true };
        const rows = [...s.querySelectorAll("[data-index]")];
        for (const row of rows) {
          if ((row.textContent || "").trim() === t) {
            row.click();
            const opts = { bubbles: true, cancelable: true, view: window };
            row.dispatchEvent(new MouseEvent("mousedown", opts));
            row.dispatchEvent(new MouseEvent("mouseup", opts));
            row.dispatchEvent(new MouseEvent("click", opts));
            return { ok: true };
          }
        }
        s.scrollTop = s.scrollTop + s.clientHeight * 0.7;
        return { ok: false };
      }, text);
      if (r.ok) return true;
      if (r.done) return false;
      await page.waitForTimeout(120);
    }
    return false;
  };

  const setDropdown = async (sel, text) => {
    await openByClick(sel);
    await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(500);
    // Optionally type into search to filter (so the target row is visible).
    const search = page.locator('input[placeholder="Search" i]').first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill(text.slice(0, 16));
      await page.waitForTimeout(600);
    }
    // Use Playwright native click on first row whose text matches.
    const row = page.locator('[data-virtuoso-scroller="true"] [data-index]').filter({ hasText: text }).first();
    try {
      await row.click({ force: true, timeout: 3000 });
    } catch (e) {
      // Fallback: click first visible row.
      await page.locator('[data-virtuoso-scroller="true"] [data-index]').first().click({ force: true }).catch(() => {});
    }
    await page.waitForTimeout(700);
    const open = await page.evaluate(() => !!document.querySelector('[data-virtuoso-scroller="true"]'));
    if (open) await closePopup();
  };

  const clickChipByValue = async (label) => page.evaluate((v) => {
    const inp = [...document.querySelectorAll("input")].find((i) => i.value === v && i.readOnly);
    if (!inp) return false;
    let n = inp.parentElement;
    let target = inp;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      if (getComputedStyle(n).cursor === "pointer") { target = n; break; }
    }
    const r = target.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window };
    target.dispatchEvent(new MouseEvent("mousedown", opts));
    target.dispatchEvent(new MouseEvent("mouseup", opts));
    target.dispatchEvent(new MouseEvent("click", opts));
    return true;
  }, label);

  // ---- Fill step 1 ----
  console.log("\n== Step 1 ==");
  // Wait for first-load animations to settle.
  await page.waitForTimeout(1500);

  // Nationality = USA. Retry if the first pick didn't take (first-render race).
  for (let attempt = 0; attempt < 3; attempt++) {
    await setDropdown('input[id^="spi_nationality_"]', "UNITED STATES OF AMERICA");
    const v = await page.$eval('input[id^="spi_nationality_"]', (el) => el.value);
    if (v && !v.startsWith("Select")) break;
    console.log("  nationality pick attempt", attempt + 1, "got:", v, "— retrying");
    await page.waitForTimeout(500);
  }
  await page.fill('input[id^="spi_full_name_"]', "TEST RECON");
  await page.fill('input[id^="spi_dob_"]', "15/01/1990");
  await setDropdown('input[id^="spi_country_or_place_of_birth_"]', "UNITED STATES OF AMERICA");
  await clickChipByValue("MALE");
  await page.fill('input[id^="spi_passport_no_"]', "X0000001");
  await page.fill('input[id^="spi_date_of_passport_expiry_"]', "31/12/2030");

  // Dial code picker — find via relative position to mobile-number input.
  console.log("opening dial-code picker...");
  const dialOpened = await page.evaluate(() => {
    const mobile = document.querySelector('[id^="spi_mobile_no_"]');
    if (!mobile) return false;
    let row = mobile.parentElement;
    let pickerInput = null;
    for (let i = 0; i < 6 && row && !pickerInput; i++, row = row.parentElement) {
      pickerInput = [...row.querySelectorAll("input")].find((el) => el.readOnly && /^Select/i.test(el.value || ""));
    }
    if (!pickerInput) return false;
    let n = pickerInput;
    let target = pickerInput;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      if (getComputedStyle(n).cursor === "pointer") { target = n; break; }
    }
    target.click();
    return true;
  });
  console.log("  dial-code opened:", dialOpened);
  if (dialOpened) {
    await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5000 }).catch(() => {});
    const search = page.locator('input[placeholder="Search" i]').first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill("UNITED STATES");
      await page.waitForTimeout(800);
    }
    await page.locator('[data-virtuoso-scroller="true"] [data-index="0"]').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(700);
    const stillOpen = await page.evaluate(() => !!document.querySelector('[data-virtuoso-scroller="true"]'));
    if (stillOpen) await closePopup();
  }

  await page.fill('input[id^="spi_mobile_no_"]', "5551234567");
  await page.fill('input[id^="spi_email_"]', "test+recon@example.invalid");

  // Snapshot before clicking Next.
  const beforeNext = await page.evaluate(() => {
    return [...document.querySelectorAll("input")].map((i) => ({
      id: i.id || "(none)",
      readonly: i.readOnly,
      value: (i.value || "").slice(0, 60),
      placeholder: i.placeholder,
    }));
  });
  console.log("\nstep 1 form state before Next:");
  for (const f of beforeNext) console.log(`  ${f.id} ${f.readonly ? "RO" : "RW"} = ${f.value || "(empty)"} ${f.placeholder ? "ph=" + f.placeholder : ""}`);

  const reqsBefore1 = reqs.length;
  console.log("\nclicking Next on step 1...");
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Next");
    if (btn) btn.click();
  });
  await page.waitForURL(/travel-details/, { timeout: 15_000 }).catch(() => null);
  await page.waitForTimeout(2000);
  console.log("after step 1: URL =", page.url());

  const step1Reqs = reqs.slice(reqsBefore1);
  console.log("step 1 → 2 XHRs:", step1Reqs.filter((r) => r.url.includes("/api/")).map((r) => r.method + " " + r.url + " " + (r.status || "?")));

  if (page.url().includes("travel-details")) {
    // ---- Fill step 2 ----
    console.log("\n== Step 2 ==");
    await setDropdown("#std_arrival_date_foreigner_individual", "01 JUN 2026");
    await page.fill("#std_departure_date_foreigner_individual", "08/06/2026");
    // No visa
    await page.evaluate(() => {
      const container = document.getElementById("std_do_have_visa_kitas_kitap_foreigner_individual");
      if (!container) return;
      const noInput = [...container.querySelectorAll("input")].find((i) => i.value === "No");
      if (!noInput) return;
      let n = noInput.parentElement;
      let target = noInput;
      for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
        if (getComputedStyle(n).cursor === "pointer") { target = n; break; }
      }
      target.click();
    });

    const reqsBefore2 = reqs.length;
    console.log("clicking Next on step 2...");
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Next");
      if (btn) btn.click();
    });
    await page.waitForURL(/mode-of-transport/, { timeout: 15_000 }).catch(() => null);
    await page.waitForTimeout(2000);
    console.log("after step 2: URL =", page.url());

    const step2Reqs = reqs.slice(reqsBefore2);
    console.log("step 2 → 3 XHRs:", step2Reqs.filter((r) => r.url.includes("/api/")).map((r) => r.method + " " + r.url + " " + (r.status || "?")));
  }

  // Persist all captured XHRs.
  fs.writeFileSync(path.join(OUT, "fresh-walk.network.json"), JSON.stringify(reqs, null, 2));
  await page.screenshot({ path: path.join(OUT, "fresh-walk-final.png"), fullPage: true });
  console.log("\nfinal URL:", page.url());
  console.log("artifacts:", OUT);
  // Don't close the browser — leave page open for further inspection.
  await page.close();
})().catch((e) => { console.error(e); process.exit(1); });
