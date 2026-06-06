/**
 * Live 2Captcha fallback smoke test — does NOT submit to MDAC.
 *
 * Requires TWOCAPTCHA_API_KEY (this spends ~$0.001/run on a real solve).
 *
 * Captures a real CAPTCHA pair from the live MDAC form, runs BOTH the local
 * Jimp solver and the 2Captcha CoordinatesTask path, and prints each one's
 * dragX so you can compare. Saves a viz PNG with the piece composited at the
 * 2Captcha-predicted position so the drag target can be eyeballed.
 *
 * Run: npm run build && TWOCAPTCHA_API_KEY=xxxx node scripts/smoke-2captcha.js
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { fillForm, captureCaptcha } = require("../dist/services/mdac");
const { solveSliderCaptcha } = require("../dist/services/captcha-solver");
const { solveWith2Captcha, is2CaptchaEnabled } = require("../dist/services/captcha-2captcha");
const { Jimp } = require("jimp");

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
  if (!is2CaptchaEnabled()) {
    console.error("TWOCAPTCHA_API_KEY not set — nothing to test. Aborting.");
    process.exit(2);
  }

  const out = "/tmp/claude/mdac-2captcha";
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

  const cap = await captureCaptcha(page);
  fs.writeFileSync(path.join(out, "bg.png"), Buffer.from(cap.imageBase64, "base64"));
  if (cap.blockImageBase64) {
    fs.writeFileSync(path.join(out, "block.png"), Buffer.from(cap.blockImageBase64, "base64"));
  }
  console.log(
    `Captured bg=${cap.width}x${cap.height} block=${cap.blockWidth}x${cap.blockHeight} offsetX=${cap.blockOffsetX}`
  );

  const input = {
    background: Buffer.from(cap.imageBase64, "base64"),
    block: cap.blockImageBase64 ? Buffer.from(cap.blockImageBase64, "base64") : undefined,
    blockOffsetX: cap.blockOffsetX,
  };

  const local = await solveSliderCaptcha(input);
  console.log(
    `LOCAL    method=${local.debug.method} dragX=${local.dragX} conf=${local.confidence.toFixed(3)}`
  );

  console.log("Calling 2Captcha (this can take 10-40s)...");
  const remote = await solveWith2Captcha(input, {
    push: (level, code, msg) => console.log(`  [2captcha ${level}] ${code}: ${msg}`),
  });
  if (!remote) {
    console.error("2Captcha returned null — see logs above (disabled, no block, or API error).");
    await browser.close();
    process.exit(1);
  }
  console.log(
    `2CAPTCHA method=${remote.debug.method} dragX=${remote.dragX} conf=${remote.confidence.toFixed(3)} matchX=${remote.debug.matchX}`
  );
  console.log(`\nΔ(2captcha - local) dragX = ${remote.dragX - local.dragX}px`);

  // Viz: composite the piece at the 2Captcha-predicted spot.
  if (cap.blockImageBase64) {
    try {
      const bgImg = await Jimp.read(input.background);
      const blockImg = await Jimp.read(input.block);
      bgImg.composite(blockImg, remote.dragX + (cap.blockOffsetX || 0), 0);
      await bgImg.write(path.join(out, "viz-2captcha.png"));
    } catch (e) {
      console.log(`(viz failed: ${e.message})`);
    }
  }

  console.log(`\nArtifacts in ${out}`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
</content>
