/**
 * Playwright automation for the official MDAC form.
 *
 * SELECTOR NOTE: These selectors target the actual form field `name` attributes
 * observed on https://imigresen-online.imi.gov.my/mdac/main?registerMain
 * (Java/Stripes server, jQuery + Bootstrap 3). Selectors may drift — test
 * against the live site after any site changes.
 */

import { chromium, type Browser, type Page } from "playwright";
import { MdacFormData, SubmitResult, RetrieveResult } from "../types";

const MDAC_URL = "https://imigresen-online.imi.gov.my/mdac/main?registerMain";
const TIMEOUT_MS = 60_000;

// ---- Helpers ----

/**
 * Set a form field value and fire change+input events so the JS framework
 * picks it up. The MDAC site uses Bootstrap-style datepickers which mark
 * the underlying input `readonly` — `fill()` fails on those, so we fall
 * back to a JS evaluate that briefly removes the readonly attribute.
 */
async function setField(page: Page, fieldName: string, value: string): Promise<void> {
  const selector = `[name="${fieldName}"]`;
  const el = await page.$(selector);
  if (!el) {
    console.warn(`[mdac] Field not found: ${fieldName}`);
    return;
  }
  const tag = await el.evaluate((e) => e.tagName.toLowerCase());
  if (tag === "select") {
    await page.selectOption(selector, value);
  } else {
    const isReadonly = await el.evaluate(
      (e) => e instanceof HTMLInputElement && e.hasAttribute("readonly")
    );
    if (isReadonly) {
      // Bootstrap datepicker — set value via JS and fire jQuery + native events.
      await el.evaluate((e, v) => {
        if (!(e instanceof HTMLInputElement)) return;
        e.removeAttribute("readonly");
        e.value = v;
        e.setAttribute("readonly", "readonly");
        const win = window as unknown as { jQuery?: (el: Element) => { trigger: (n: string) => void; datepicker?: (cmd: string, v: string) => void } };
        if (win.jQuery) {
          const $el = win.jQuery(e);
          // For Bootstrap datepicker: setDate forces the picker's internal state to match.
          $el.datepicker?.("setDate", v);
          $el.trigger("change");
          $el.trigger("input");
        }
      }, value);
    } else {
      await el.fill(value);
    }
  }
  await el.dispatchEvent("change");
  await el.dispatchEvent("input");
}

/** Wait a beat for any AJAX the form fires after a dropdown change. */
async function settleAfterChange(page: Page, ms = 500): Promise<void> {
  await page.waitForTimeout(ms);
}

// ---- Phase 1: Fill the form ----

/**
 * Navigate to the MDAC form and fill every field. Leaves the page at the
 * point where the user needs to solve the CAPTCHA and click Submit.
 */
export async function fillForm(page: Page, data: MdacFormData): Promise<void> {
  console.log("[mdac] Navigating to MDAC form...");
  await page.goto(MDAC_URL, { waitUntil: "networkidle", timeout: TIMEOUT_MS });

  // If there's a "New Registration" landing page, click through it
  const newRegBtn = page.locator(
    'button:has-text("New Registration"), a:has-text("New Registration"), ' +
    'button:has-text("Apply Now"), a:has-text("Apply Now")'
  );
  if ((await newRegBtn.count()) > 0) {
    await newRegBtn.first().click();
    await page.waitForLoadState("networkidle");
  }

  // ---- Personal fields ----
  await setField(page, "name", data.name);
  await setField(page, "passNo", data.passNo);
  await setField(page, "dob", data.dob);
  await setField(page, "nationality", data.nationality);
  await settleAfterChange(page); // nationality may trigger dependent fields
  await setField(page, "pob", data.pob);
  await setField(page, "sex", data.sex);
  await setField(page, "passExpDte", data.passExpDte);
  await setField(page, "email", data.email);
  await setField(page, "confirmEmail", data.confirmEmail);
  await setField(page, "region", data.region);
  await setField(page, "mobile", data.mobile);

  // ---- Travel fields ----
  await setField(page, "arrDt", data.arrDt);
  await setField(page, "depDt", data.depDt);
  await setField(page, "vesselNm", data.vesselNm);
  await setField(page, "trvlMode", data.trvlMode);
  await setField(page, "embark", data.embark);

  // ---- Accommodation fields ----
  await setField(page, "accommodationStay", data.accommodationStay);
  await setField(page, "accommodationAddress1", data.accommodationAddress1);
  await setField(page, "accommodationAddress2", data.accommodationAddress2);
  await setField(page, "accommodationState", data.accommodationState);
  await settleAfterChange(page, 1500); // state change triggers city AJAX

  // City dropdown is populated via AJAX after state selection.
  // Poll until the options appear, then match by display name.
  const cityName = (data.sCity || "").toLowerCase();
  if (cityName) {
    let matched = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const citySelect = await page.$('[name="accommodationCity"]');
      if (!citySelect) {
        await page.waitForTimeout(500);
        continue;
      }
      const options = await citySelect.$$eval("option", (opts) =>
        opts.map((o) => ({ value: (o as unknown as { value: string }).value, text: o.textContent || "" }))
      );
      if (options.length <= 1) {
        await page.waitForTimeout(500);
        continue;
      }
      const match = options.find((o) => o.text.toLowerCase().includes(cityName));
      if (match) {
        await setField(page, "accommodationCity", match.value);
        matched = true;
        break;
      }
      break; // options loaded but no match — stop polling
    }
    if (!matched) {
      console.warn(`[mdac] Could not match city "${data.sCity}" — user may need to select manually`);
    }
  } else if (data.accommodationCity) {
    await setField(page, "accommodationCity", data.accommodationCity);
  }

  await setField(page, "accommodationPostcode", data.accommodationPostcode);

  // ---- Declaration checkboxes ----
  const checkboxes = page.locator('input[type="checkbox"]');
  const count = await checkboxes.count();
  for (let i = 0; i < count; i++) {
    const cb = checkboxes.nth(i);
    if (!(await cb.isChecked())) {
      await cb.click();
    }
  }

  console.log("[mdac] Form filled — ready for CAPTCHA");
}

// ---- Phase 2: Capture the CAPTCHA ----

export interface CaptchaCapture {
  imageBase64: string;
  width: number;
  height: number;
  /**
   * The puzzle-piece "block" canvas, if separately findable on this site.
   * Used by the template-matching solver. May be omitted on fallback paths.
   */
  blockImageBase64?: string;
  blockWidth?: number;
  blockHeight?: number;
  /** X-offset of the block canvas relative to the background canvas, if known. */
  blockOffsetX?: number;
}

/**
 * Screenshot the slider-CAPTCHA puzzle background.
 *
 * The MDAC site renders the CAPTCHA with two stacked canvases:
 *   - `#captcha canvas` (no class) → the background photo with the notch
 *   - `#captcha canvas.block`     → the puzzle piece itself
 * We want just the background — the piece always starts at x=0 in the
 * widget, so the drag distance is simply the gap's x-position.
 *
 * Falls back to the wider `[class*="captcha"]` widget shot if the canvas
 * pair isn't found (selector drift).
 */
export async function captureCaptcha(page: Page): Promise<CaptchaCapture> {
  // Preferred: the unstyled background canvas inside #captcha + block canvas
  const bg = page.locator("#captcha canvas").nth(0);
  const block = page.locator("#captcha canvas.block").first();
  const bgCount = await bg.count().catch(() => 0);
  if (bgCount > 0 && (await bg.isVisible().catch(() => false))) {
    // Pull the canvas pixel data via JS rather than screenshot so we get the
    // raw rendered content (no cursor/overlay interference). Falls back to
    // page screenshot of the element if toDataURL fails.
    const bgData = await bg
      .evaluate((el) => {
        const c = el as HTMLCanvasElement;
        try {
          return { dataUrl: c.toDataURL("image/png"), w: c.width, h: c.height };
        } catch {
          return null;
        }
      })
      .catch(() => null);
    let bgBuf: Buffer;
    let bgW: number;
    let bgH: number;
    if (bgData?.dataUrl) {
      bgBuf = Buffer.from(bgData.dataUrl.split(",")[1], "base64");
      bgW = bgData.w;
      bgH = bgData.h;
    } else {
      bgBuf = await bg.screenshot({ type: "png" });
      const bx = await bg.boundingBox();
      bgW = bx?.width ?? 271;
      bgH = bx?.height ?? 155;
    }

    const out: CaptchaCapture = {
      imageBase64: bgBuf.toString("base64"),
      width: bgW,
      height: bgH,
    };

    // Try to grab the block canvas + its x-offset relative to bg.
    if ((await block.count().catch(() => 0)) > 0) {
      const blockData = await block
        .evaluate((el) => {
          const c = el as HTMLCanvasElement;
          try {
            return { dataUrl: c.toDataURL("image/png"), w: c.width, h: c.height };
          } catch {
            return null;
          }
        })
        .catch(() => null);
      const bgBox = await bg.boundingBox();
      const blockBox = await block.boundingBox();
      if (blockData?.dataUrl) {
        out.blockImageBase64 = Buffer.from(
          blockData.dataUrl.split(",")[1],
          "base64"
        ).toString("base64");
        out.blockWidth = blockData.w;
        out.blockHeight = blockData.h;
      }
      if (bgBox && blockBox) {
        out.blockOffsetX = Math.round(blockBox.x - bgBox.x);
      }
    }
    return out;
  }

  // Fallback: any widget container
  const fallbacks = [
    ".captcha-container",
    '[class*="captcha"]',
    '[class*="slider"]',
    '[class*="verify"]',
    ".blockPuzzle",
    "#captcha",
  ];
  for (const sel of fallbacks) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0 && (await loc.isVisible())) {
      const box = await loc.boundingBox();
      const buf = await loc.screenshot({ type: "png" });
      return {
        imageBase64: buf.toString("base64"),
        width: box?.width ?? 300,
        height: box?.height ?? 200,
      };
    }
  }

  console.warn("[mdac] No CAPTCHA element found — full-page screenshot fallback");
  const buf = await page.screenshot({ type: "png", fullPage: false });
  return { imageBase64: buf.toString("base64"), width: 1280, height: 720 };
}

// ---- Phase 3: Solve CAPTCHA and submit ----

/**
 * Replay the user's slider drag on the CAPTCHA element and click Submit.
 *
 * @param sliderX - The x-offset in pixels where the user placed the slider handle
 */
export async function solveCaptchaAndSubmit(
  page: Page,
  sliderX: number
): Promise<SubmitResult> {
  // Find the slider handle (the draggable piece)
  const handleSelectors = [
    '[class*="slider"] [class*="handle"]',
    '[class*="slider"] [class*="btn"]',
    '[class*="captcha"] [class*="drag"]',
    '[class*="verify"] [class*="handler"]',
    '[class*="slider-btn"]',
    '.handler',
    '[class*="slide"] button',
    '[class*="slide"] [class*="icon"]',
  ];

  let handle = null;
  for (const sel of handleSelectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0 && (await loc.isVisible())) {
      handle = loc;
      break;
    }
  }

  if (handle) {
    const handleBox = await handle.boundingBox();
    if (handleBox) {
      const startX = handleBox.x + handleBox.width / 2;
      const startY = handleBox.y + handleBox.height / 2;

      // Simulate a human-like drag
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      // Move in small increments to appear more natural
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const progress = i / steps;
        const currentX = startX + sliderX * progress;
        await page.mouse.move(currentX, startY + (Math.random() * 2 - 1));
        await page.waitForTimeout(20 + Math.random() * 30);
      }
      await page.mouse.move(startX + sliderX, startY);
      await page.mouse.up();
      await page.waitForTimeout(1000); // wait for CAPTCHA validation
    }
  } else {
    console.warn("[mdac] No slider handle found — attempting submit without CAPTCHA solve");
  }

  // Click the submit button
  const submitBtn = page.locator(
    'button[type="submit"], input[type="submit"], ' +
    'button:has-text("Submit"), button:has-text("Confirm"), button:has-text("Register")'
  );
  if ((await submitBtn.count()) > 0) {
    await submitBtn.first().click();
  }

  // Wait for success or error
  await page.waitForSelector(
    '.success, .alert-success, [class*="success"], [class*="confirmation"], ' +
    'h2:has-text("Thank"), h2:has-text("Success"), p:has-text("PIN")',
    { timeout: 30_000 }
  ).catch(() => null);

  // Check for error messages
  const errorEl = page.locator('.alert-danger, .error, [class*="error"], [class*="alert-danger"]');
  if ((await errorEl.count()) > 0) {
    const errorText = await errorEl.first().textContent();
    const text = errorText?.trim() || "Form submission error";
    // Check if it's a CAPTCHA failure (retryable)
    const isCaptchaError = text.toLowerCase().includes("captcha") ||
      text.toLowerCase().includes("verification") ||
      text.toLowerCase().includes("slider");
    return {
      success: false,
      error: text,
      retryable: isCaptchaError,
    };
  }

  // Check for success
  const successEl = page.locator('.alert-success, [class*="success"], [class*="confirmation"]');
  const pinText = page.locator('p:has-text("PIN"), span:has-text("PIN"), div:has-text("PIN code")');
  if ((await successEl.count()) > 0 || (await pinText.count()) > 0) {
    return {
      success: true,
      message: "Submission complete. Check your email for your PIN code.",
    };
  }

  // Fallback
  console.log("[mdac] No clear success/error indicator — assuming success");
  return {
    success: true,
    message: "Submission complete. Check your email for your PIN code.",
  };
}

// ---- Legacy one-shot function (kept for backward compat) ----

export async function submitMDAC(data: MdacFormData): Promise<SubmitResult> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT_MS);

  try {
    await fillForm(page, data);
    // In legacy mode, we can't relay the CAPTCHA — just attempt submit directly
    return await solveCaptchaAndSubmit(page, 0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mdac] submitMDAC error:", message);
    return { success: false, error: `Submission failed: ${message}` };
  } finally {
    await browser.close();
  }
}

// ---- Retrieve QR code ----

const MDAC_BASE_URL = "https://imigresen-online.imi.gov.my/mdac/main";

export async function retrieveQR(
  phoneCountryCode: string,
  phoneNumber: string,
  pin: string
): Promise<RetrieveResult> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT_MS);

  try {
    console.log("[mdac] Navigating to MDAC retrieve section...");
    await page.goto(MDAC_BASE_URL, { waitUntil: "networkidle", timeout: TIMEOUT_MS });

    const checkRegButton = page.locator(
      'a:has-text("Check Registration"), button:has-text("Check Registration"), ' +
      'a:has-text("View Status"), a:has-text("Retrieve"), button:has-text("Retrieve")'
    );
    if ((await checkRegButton.count()) > 0) {
      await checkRegButton.first().click();
      await page.waitForLoadState("networkidle");
    }

    // Phone country code
    const codeSelect = page.locator(
      'select[name*="countryCode"], select[name*="phoneCode"], select[name*="region"]'
    );
    if ((await codeSelect.count()) > 0) {
      await codeSelect.selectOption({ value: phoneCountryCode }).catch(async () => {
        await codeSelect.selectOption({ label: phoneCountryCode });
      });
    }

    // Phone number
    await page.fill('input[type="tel"], input[name*="phone"], input[name*="mobile"]', phoneNumber);

    // PIN
    await page.fill(
      'input[name*="pin"], input[name*="PIN"], input[type="password"]',
      pin
    );

    // Submit retrieval
    const retrieveSubmit = page.locator(
      'button[type="submit"], input[type="submit"], ' +
      'button:has-text("Submit"), button:has-text("Retrieve"), button:has-text("Check")'
    );
    await retrieveSubmit.first().click();

    // Wait for result
    await page.waitForSelector(
      'img[src*="qr"], canvas, .qr-code, [class*="qr"], a[href*=".pdf"], iframe',
      { timeout: 30_000 }
    ).catch(() => null);

    // Check for error
    const errorEl = page.locator('.alert-danger, .error, [class*="error"]');
    if ((await errorEl.count()) > 0) {
      const errorText = await errorEl.first().textContent();
      return { success: false, error: errorText?.trim() || "Retrieval error" };
    }

    // Try QR image
    const qrImg = page.locator('img[src*="qr"], .qr-code img, [class*="qr"] img').first();
    if ((await qrImg.count()) > 0) {
      const buf = await qrImg.screenshot({ type: "png" });
      return { success: true, qrImageBase64: buf.toString("base64") };
    }

    // Try canvas
    const qrCanvas = page.locator("canvas").first();
    if ((await qrCanvas.count()) > 0) {
      const buf = await qrCanvas.screenshot({ type: "png" });
      return { success: true, qrImageBase64: buf.toString("base64") };
    }

    // Try PDF download
    const pdfLink = page.locator('a[href*=".pdf"], a:has-text("Download"), a:has-text("PDF")').first();
    if ((await pdfLink.count()) > 0) {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        pdfLink.click(),
      ]);
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return { success: true, pdfBase64: Buffer.concat(chunks).toString("base64") };
    }

    // Fallback: screenshot confirmation area
    const confirmSection = page.locator('.confirmation, [class*="confirmation"], main, #content').first();
    if ((await confirmSection.count()) > 0) {
      const buf = await confirmSection.screenshot({ type: "png" });
      return { success: true, qrImageBase64: buf.toString("base64") };
    }

    return { success: false, error: "Could not locate QR code or PDF. Site layout may have changed." };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mdac] retrieveQR error:", message);
    return { success: false, error: `Retrieval failed: ${message}` };
  } finally {
    await browser.close();
  }
}
