/**
 * Multi-CAPTCHA consistency test.
 *
 * Loads MDAC, fills the form, and grabs N CAPTCHAs back-to-back (clicking
 * the refresh icon in between). Runs the solver on each. Saves background +
 * block images so we can eyeball results.
 *
 * Does NOT submit anything to MDAC.
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { fillForm, captureCaptcha } = require("../dist/services/mdac");
const { solveSliderCaptcha } = require("../dist/services/captcha-solver");
const { Jimp } = require("jimp");

const N = parseInt(process.env.N || "5", 10);
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
  accommodationState: "14",
  accommodationCity: "",
  accommodationPostcode: "50088",
  sCity: "Kuala Lumpur",
};

async function main() {
  const out = path.join("/tmp/claude/mdac-captcha-multi");
  fs.mkdirSync(out, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);

  console.log("Loading MDAC + filling form...");
  await page.goto("https://imigresen-online.imi.gov.my/mdac/main?registerMain", {
    waitUntil: "networkidle",
  });
  await fillForm(page, SAMPLE);

  const results = [];
  for (let i = 0; i < N; i++) {
    console.log(`\n=== CAPTCHA #${i + 1} ===`);
    // First iteration: don't refresh. Subsequent: click refresh icon.
    if (i > 0) {
      const refresh = page.locator(
        '[class*="refresh"], [class*="reload"], #captcha [class*="icon"]:first-of-type, .slidercaptcha [title*="refresh"]'
      ).first();
      const count = await refresh.count().catch(() => 0);
      if (count > 0) {
        await refresh.click().catch(() => {});
      } else {
        // Fallback: re-trigger via window.captcha if exposed
        await page.evaluate(() => {
          const w = window;
          if (w.captcha && w.captcha.reset) w.captcha.reset();
        });
      }
      await page.waitForTimeout(800);
    }

    const cap = await captureCaptcha(page);
    fs.writeFileSync(
      path.join(out, `bg-${i + 1}.png`),
      Buffer.from(cap.imageBase64, "base64")
    );
    if (cap.blockImageBase64) {
      fs.writeFileSync(
        path.join(out, `block-${i + 1}.png`),
        Buffer.from(cap.blockImageBase64, "base64")
      );
    }

    const result = await solveSliderCaptcha({
      background: Buffer.from(cap.imageBase64, "base64"),
      block: cap.blockImageBase64
        ? Buffer.from(cap.blockImageBase64, "base64")
        : undefined,
      blockOffsetX: cap.blockOffsetX,
    });

    console.log(
      `  bg=${cap.width}x${cap.height} block=${cap.blockWidth}x${cap.blockHeight} ` +
        `offsetX=${cap.blockOffsetX}`
    );
    console.log(
      `  → method=${result.debug.method}  dragX=${result.dragX}  ` +
        `conf=${result.confidence.toFixed(3)}  ` +
        `matchX=${result.debug.matchX}  ` +
        `bbox=${JSON.stringify(result.debug.bbox)}  ` +
        `opaquePx=${result.debug.opaquePixels}`
    );
    results.push({ i: i + 1, ...result, cap_w: cap.width, cap_h: cap.height });

    // Visualize: composite block onto bg at predicted position.
    if (cap.blockImageBase64) {
      try {
        const bgImg = await Jimp.read(Buffer.from(cap.imageBase64, "base64"));
        const blockImg = await Jimp.read(Buffer.from(cap.blockImageBase64, "base64"));
        const targetX = result.dragX + (cap.blockOffsetX || 0);
        bgImg.composite(blockImg, targetX, 0);
        // Draw a vertical red bar at dragX
        for (let y = 0; y < bgImg.bitmap.height; y++) {
          for (let dx = 0; dx < 2; dx++) {
            const px = result.dragX + dx;
            if (px < 0 || px >= bgImg.bitmap.width) continue;
            const idx = (y * bgImg.bitmap.width + px) * 4;
            bgImg.bitmap.data[idx] = 255;
            bgImg.bitmap.data[idx + 1] = 0;
            bgImg.bitmap.data[idx + 2] = 0;
            bgImg.bitmap.data[idx + 3] = 255;
          }
        }
        await bgImg.write(path.join(out, `viz-${i + 1}.png`));
      } catch (e) {
        console.log(`  (viz failed: ${e.message})`);
      }
    }
  }

  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(results, null, 2)
  );
  console.log(`\nArtifacts in ${out}`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
