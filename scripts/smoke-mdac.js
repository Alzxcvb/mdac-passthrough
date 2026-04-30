/**
 * Live MDAC smoke test — does NOT submit.
 *
 * Runs the full pre-submit pipeline against the real MDAC site and reports
 * what works and what doesn't:
 *   1. Navigate to the MDAC form
 *   2. Verify each named field exists in the DOM (selector audit)
 *   3. Run fillForm() with sample data
 *   4. Run captureCaptcha() — save the screenshot to disk for inspection
 *   5. Run solveSliderCaptcha() — log dragX + confidence
 *   6. Locate the slider handle + submit button (selectors only — don't click)
 *   7. Close
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { fillForm, captureCaptcha } = require("../dist/services/mdac");
const { solveSliderCaptcha } = require("../dist/services/captcha-solver");

const SAMPLE = {
  name: "TEST USER",
  passNo: "TEST123456",
  dob: "01/01/1990",
  nationality: "USA",
  pob: "USA",
  sex: "1",
  passExpDte: "01/01/2030",
  email: "smoke-test@example.com",
  confirmEmail: "smoke-test@example.com",
  region: "1",
  mobile: "5551234567",
  arrDt: "01/06/2026",
  depDt: "07/06/2026",
  vesselNm: "MH123",
  trvlMode: "1",
  embark: "USA",
  accommodationStay: "01",
  accommodationAddress1: "Test Hotel",
  accommodationAddress2: "Test Address",
  accommodationState: "14", // WP Kuala Lumpur
  accommodationCity: "",
  accommodationPostcode: "50088",
  sCity: "Kuala Lumpur",
};

const FIELDS_TO_AUDIT = [
  "name", "passNo", "dob", "nationality", "pob", "sex",
  "passExpDte", "email", "confirmEmail", "region", "mobile",
  "arrDt", "depDt", "vesselNm", "trvlMode", "embark",
  "accommodationStay", "accommodationAddress1", "accommodationAddress2",
  "accommodationState", "accommodationCity", "accommodationPostcode",
];

async function main() {
  const out = path.join("/tmp/claude/mdac-smoke");
  fs.mkdirSync(out, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);

  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("[mdac]")) console.log("  [page-console]", t);
  });
  page.on("pageerror", (err) => console.log("  [page-error]", err.message));

  const report = {
    site_loads: false,
    landing_page_screenshot: null,
    new_reg_button_clicked: null,
    fields_present: {},
    fillForm_threw: null,
    after_fill_screenshot: null,
    captcha_capture: null,
    solver: null,
    handle_locator_found: null,
    submit_button_found: null,
  };

  try {
    console.log("[1] Navigate to MDAC...");
    await page.goto("https://imigresen-online.imi.gov.my/mdac/main?registerMain", {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
    report.site_loads = true;

    const landingShot = path.join(out, "01-landing.png");
    await page.screenshot({ path: landingShot, fullPage: true });
    report.landing_page_screenshot = landingShot;

    // If a New Registration button is in the way, click it
    const newRegBtn = page.locator(
      'button:has-text("New Registration"), a:has-text("New Registration"), button:has-text("Apply Now"), a:has-text("Apply Now")'
    );
    if ((await newRegBtn.count()) > 0) {
      console.log("[1a] Clicking New Registration button...");
      report.new_reg_button_clicked = true;
      await newRegBtn.first().click();
      await page.waitForLoadState("networkidle").catch(() => {});
    } else {
      report.new_reg_button_clicked = false;
    }

    // ---- Field audit ----
    console.log("[2] Field selector audit:");
    for (const name of FIELDS_TO_AUDIT) {
      const exists = (await page.locator(`[name="${name}"]`).count()) > 0;
      report.fields_present[name] = exists;
      console.log(`    ${exists ? "✓" : "✗"} [name="${name}"]`);
    }

    // ---- Fill form ----
    console.log("[3] Running fillForm with sample data...");
    try {
      await fillForm(page, SAMPLE);
    } catch (err) {
      report.fillForm_threw = err.message;
      console.log("    fillForm threw:", err.message);
    }
    const afterFill = path.join(out, "02-after-fill.png");
    await page.screenshot({ path: afterFill, fullPage: true });
    report.after_fill_screenshot = afterFill;

    // ---- DOM probe: what selectors actually exist for the captcha? ----
    console.log("[3.5] Probing CAPTCHA DOM...");
    const candidateSelectors = [
      ".captcha-container",
      '[class*="captcha"]',
      '[class*="slider"]',
      '[class*="verify"]',
      ".blockPuzzle",
      "#captcha",
      'canvas[class*="captcha"]',
      '[id*="captcha"]',
      '[class*="puzzle"]',
      '[class*="cap-bg"]',
      "img[src*='captcha']",
      "img[src*='puzzle']",
      "canvas",
      ".cap-bg",
      ".cap-block",
      ".cap-fg",
    ];
    const probe = [];
    for (const sel of candidateSelectors) {
      const count = await page.locator(sel).count();
      if (count === 0) continue;
      const first = page.locator(sel).first();
      const visible = await first.isVisible().catch(() => false);
      const box = await first.boundingBox().catch(() => null);
      const cls = await first.evaluate((e) => e.className || "").catch(() => "");
      probe.push({ sel, count, visible, box, cls });
      console.log(`    ✓ ${sel} count=${count} visible=${visible} box=${JSON.stringify(box)} class="${cls}"`);
    }
    report.captcha_dom_probe = probe;

    // Also dump all canvas + img elements in the bottom half of the page
    const lateImages = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll("canvas, img"));
      return els
        .map((e) => {
          const rect = e.getBoundingClientRect();
          return {
            tag: e.tagName,
            src: (e instanceof HTMLImageElement ? e.src : "") || "",
            cls: e.className,
            id: e.id,
            x: rect.x,
            y: rect.y,
            w: rect.width,
            h: rect.height,
          };
        })
        .filter((e) => e.y > 400 && e.w > 50);
    });
    console.log("    bottom-half images/canvases:");
    for (const i of lateImages) {
      console.log(`      ${i.tag}#${i.id}.${i.cls} src=${i.src.slice(0, 60)} ${i.w}x${i.h}@(${i.x},${i.y})`);
    }
    report.late_images = lateImages;

    // ---- CAPTCHA capture ----
    console.log("[4] Capturing CAPTCHA widget...");
    try {
      const cap = await captureCaptcha(page);
      const capPath = path.join(out, "03-captcha.png");
      fs.writeFileSync(capPath, Buffer.from(cap.imageBase64, "base64"));
      report.captcha_capture = {
        saved_to: capPath,
        width: cap.width,
        height: cap.height,
        bytes: Buffer.from(cap.imageBase64, "base64").length,
      };
      console.log(
        `    captured ${cap.width}x${cap.height}, ${report.captcha_capture.bytes} bytes`
      );

      // Save block image too if provided
      if (cap.blockImageBase64) {
        const blockPath = path.join(out, "03b-block.png");
        fs.writeFileSync(blockPath, Buffer.from(cap.blockImageBase64, "base64"));
        console.log(`    block ${cap.blockWidth}x${cap.blockHeight} saved (offsetX=${cap.blockOffsetX})`);
      }

      // ---- Solver ----
      console.log("[5] Running solver (template-match if block available)...");
      const result = await solveSliderCaptcha({
        background: Buffer.from(cap.imageBase64, "base64"),
        block: cap.blockImageBase64
          ? Buffer.from(cap.blockImageBase64, "base64")
          : undefined,
        blockOffsetX: cap.blockOffsetX,
      });
      report.solver = result;
      console.log(
        `    method=${result.debug.method}  dragX=${result.dragX}  confidence=${result.confidence.toFixed(2)}`
      );
      console.log(`    debug=${JSON.stringify(result.debug)}`);
    } catch (err) {
      console.log("    captureCaptcha/solver threw:", err.message);
      report.captcha_capture = { error: err.message };
    }

    // ---- Slider handle / submit button locator ----
    console.log("[6] Looking for slider handle + submit button (no click)...");
    const handleSelectors = [
      '[class*="slider"] [class*="handle"]',
      '[class*="slider"] [class*="btn"]',
      '[class*="captcha"] [class*="drag"]',
      '[class*="verify"] [class*="handler"]',
      '[class*="slider-btn"]',
      ".handler",
      '[class*="slide"] button',
      '[class*="slide"] [class*="icon"]',
    ];
    for (const sel of handleSelectors) {
      const count = await page.locator(sel).count();
      const visible = count > 0 ? await page.locator(sel).first().isVisible().catch(() => false) : false;
      if (count > 0) {
        console.log(`    ✓ ${sel} → count=${count} visible=${visible}`);
        if (!report.handle_locator_found) report.handle_locator_found = { selector: sel, count, visible };
      }
    }

    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Submit")',
      'button:has-text("Confirm")',
      'button:has-text("Register")',
    ];
    for (const sel of submitSelectors) {
      const count = await page.locator(sel).count();
      if (count > 0) {
        console.log(`    ✓ submit selector ${sel} → count=${count}`);
        if (!report.submit_button_found) report.submit_button_found = { selector: sel, count };
        break;
      }
    }
  } catch (err) {
    console.log("FATAL:", err.message);
    report.fatal = err.message;
  } finally {
    await browser.close();
  }

  console.log("\n========== REPORT ==========");
  console.log(JSON.stringify(report, null, 2));

  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\nArtifacts in ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
