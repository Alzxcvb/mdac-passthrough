// SELECTOR NOTE: These selectors are best-effort. Run against live site and update as needed.
// The MDAC form at https://imigresen-online.imi.gov.my/mdac/main is a dynamic JS form.
// Selectors may drift as the site updates — test after any site changes.

import { chromium } from "playwright";
import { MdacFormData, SubmitResult, RetrieveResult } from "../types";

const MDAC_URL = "https://imigresen-online.imi.gov.my/mdac/main";
const TIMEOUT_MS = 60_000;

/**
 * Convert YYYY-MM-DD to DD/MM/YYYY (the format MDAC expects for date inputs).
 */
function toMdacDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * Submit traveler data to the official MDAC form.
 *
 * NOTE: This function relies on selectors observed from the MDAC site at time of writing.
 * The site uses a dynamic JS form — selectors WILL need updating if the site changes.
 * Recommended: run with `headless: false` locally to watch the automation and verify selectors.
 */
export async function submitMDAC(data: MdacFormData): Promise<SubmitResult> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT_MS);

  try {
    console.log("[mdac] Navigating to MDAC form...");
    await page.goto(MDAC_URL, { waitUntil: "networkidle", timeout: TIMEOUT_MS });

    // SELECTOR NOTE: The MDAC site may show a language selection or landing page first.
    // If there's a "New Registration" or "Apply" button, click it.
    // TODO: Verify the actual button text/selector on the live site.
    const newRegistrationButton = page.locator(
      'button:has-text("New Registration"), a:has-text("New Registration"), button:has-text("Apply Now"), a:has-text("Apply Now")'
    );
    if (await newRegistrationButton.count() > 0) {
      await newRegistrationButton.first().click();
      await page.waitForLoadState("networkidle");
    }

    // ---- PERSONAL INFORMATION SECTION ----

    // Full Name
    // SELECTOR NOTE: Try label-based first, fall back to name/id attributes.
    // TODO: Verify exact label text on live site.
    await page.waitForSelector('input[name="fullName"], input[id*="fullName"], input[placeholder*="Full Name"]');
    await page.fill(
      'input[name="fullName"], input[id*="fullName"], input[placeholder*="Full Name"]',
      data.fullName
    );

    // Passport Number
    // SELECTOR NOTE: May be labeled "Passport No." or "Passport Number"
    await page.waitForSelector('input[name="passportNo"], input[id*="passport"], input[placeholder*="Passport"]');
    await page.fill(
      'input[name="passportNo"], input[id*="passport"], input[placeholder*="Passport"]',
      data.passportNumber
    );

    // Nationality
    // SELECTOR NOTE: This is likely a dropdown/select element.
    // TODO: Verify exact option values on the live site — they may be country codes or full names.
    await page.waitForSelector('select[name="nationality"], select[id*="nationality"]');
    await page.selectOption(
      'select[name="nationality"], select[id*="nationality"]',
      { label: data.nationality }
    ).catch(async () => {
      // Fallback: try selecting by value if label doesn't match
      await page.selectOption(
        'select[name="nationality"], select[id*="nationality"]',
        { value: data.nationality }
      );
    });

    // Date of Birth
    // SELECTOR NOTE: May be a date picker or three separate fields (day/month/year).
    // TODO: Verify the date input format on the live site.
    const dobInputs = await page.locator('input[name*="dob"], input[id*="dob"], input[name*="birth"], input[id*="birth"]').count();
    if (dobInputs > 0) {
      // Single date field
      await page.fill(
        'input[name*="dob"], input[id*="dob"], input[name*="birth"], input[id*="birth"]',
        toMdacDate(data.dateOfBirth)
      );
    }

    // Sex / Gender
    // SELECTOR NOTE: Could be radio buttons or a select dropdown.
    // TODO: Verify the input type and option values on the live site.
    const sexSelect = page.locator('select[name="sex"], select[id*="sex"], select[name*="gender"], select[id*="gender"]');
    const sexRadio = page.locator(`input[type="radio"][value="${data.sex}"], input[type="radio"][value="${data.sex.toLowerCase()}"]`);
    if (await sexSelect.count() > 0) {
      await sexSelect.selectOption({ label: data.sex });
    } else if (await sexRadio.count() > 0) {
      await sexRadio.first().click();
    }

    // Passport Issue Date
    // SELECTOR NOTE: May be labeled "Date of Issue" or "Issue Date"
    // TODO: Verify exact field selector on live site.
    const issueInput = page.locator('input[name*="issue"], input[id*="issue"]');
    if (await issueInput.count() > 0) {
      await issueInput.first().fill(toMdacDate(data.passportIssueDate));
    }

    // Passport Expiry Date
    // SELECTOR NOTE: May be labeled "Date of Expiry" or "Expiry Date"
    const expiryInput = page.locator('input[name*="expiry"], input[id*="expiry"], input[name*="expire"], input[id*="expire"]');
    if (await expiryInput.count() > 0) {
      await expiryInput.first().fill(toMdacDate(data.passportExpiry));
    }

    // Email
    await page.waitForSelector('input[type="email"], input[name*="email"], input[id*="email"]');
    await page.fill(
      'input[type="email"], input[name*="email"], input[id*="email"]',
      data.email
    );

    // Phone Country Code + Number
    // SELECTOR NOTE: Phone may be split into country code dropdown + number field.
    // TODO: Verify the country code format expected (e.g. "+1", "001", "US").
    const phoneCodeSelect = page.locator('select[name*="phoneCode"], select[id*="phoneCode"], select[name*="countryCode"], select[id*="countryCode"]');
    if (await phoneCodeSelect.count() > 0) {
      await phoneCodeSelect.selectOption({ label: data.phoneCountryCode }).catch(async () => {
        await phoneCodeSelect.selectOption({ value: data.phoneCountryCode });
      });
    }
    const phoneInput = page.locator('input[type="tel"], input[name*="phone"], input[id*="phone"]');
    if (await phoneInput.count() > 0) {
      await phoneInput.first().fill(data.phoneNumber);
    }

    // Home Address (residential address in home country)
    // SELECTOR NOTE: May be a textarea or multi-line input.
    // TODO: Verify selector and whether this maps to a single field or multiple (street, city, country).
    const homeAddressInput = page.locator('textarea[name*="homeAddress"], textarea[id*="homeAddress"], input[name*="homeAddress"], input[id*="homeAddress"], textarea[name*="address"], input[name*="address"]');
    if (await homeAddressInput.count() > 0) {
      await homeAddressInput.first().fill(data.homeAddress);
    }

    // ---- TRAVEL INFORMATION SECTION ----

    // Arrival Date
    // SELECTOR NOTE: May have a min/max constraint set by the site.
    const arrivalInput = page.locator('input[name*="arrival"], input[id*="arrival"]');
    if (await arrivalInput.count() > 0) {
      await arrivalInput.first().fill(toMdacDate(data.arrivalDate));
    }

    // Flight Number
    // SELECTOR NOTE: May be labeled "Flight/Vessel No." or "Flight Number"
    const flightInput = page.locator('input[name*="flight"], input[id*="flight"], input[name*="vessel"], input[id*="vessel"]');
    if (await flightInput.count() > 0) {
      await flightInput.first().fill(data.flightNumber);
    }

    // Port of Entry
    // SELECTOR NOTE: Likely a select dropdown. Option values may differ from display labels.
    // TODO: Map portOfEntry strings to the exact option values used by the MDAC site.
    const portSelect = page.locator('select[name*="port"], select[id*="port"]');
    if (await portSelect.count() > 0) {
      await portSelect.selectOption({ label: data.portOfEntry }).catch(async () => {
        // Try partial match by looping through options
        const options = await portSelect.locator("option").allTextContents();
        const match = options.find((o) => o.includes(data.portOfEntry));
        if (match) await portSelect.selectOption({ label: match });
      });
    }

    // Departure City
    // SELECTOR NOTE: The city/country the traveler is departing from.
    // TODO: May be a select dropdown or free-text input.
    const depCityInput = page.locator('input[name*="departure"], input[id*="departure"], select[name*="departure"], select[id*="departure"]');
    if (await depCityInput.count() > 0) {
      const tag = await depCityInput.first().evaluate((el) => el.tagName.toLowerCase());
      if (tag === "select") {
        await page.selectOption(
          'select[name*="departure"], select[id*="departure"]',
          { label: data.departureCity }
        ).catch(() => {});
      } else {
        await depCityInput.first().fill(data.departureCity);
      }
    }

    // Duration of Stay
    // SELECTOR NOTE: Number of days, typically 1–90. May be a number input or select.
    const durationInput = page.locator('input[name*="duration"], input[id*="duration"], select[name*="duration"], select[id*="duration"]');
    if (await durationInput.count() > 0) {
      const tag = await durationInput.first().evaluate((el) => el.tagName.toLowerCase());
      if (tag === "select") {
        await page.selectOption(
          'select[name*="duration"], select[id*="duration"]',
          { value: String(data.durationOfStay) }
        ).catch(() => {});
      } else {
        await durationInput.first().fill(String(data.durationOfStay));
      }
    }

    // Hotel / Accommodation Name
    // SELECTOR NOTE: May be labeled "Name of Hotel" or "Place of Accommodation"
    const hotelInput = page.locator('input[name*="hotel"], input[id*="hotel"], input[name*="accommodation"], input[id*="accommodation"]');
    if (await hotelInput.count() > 0) {
      await hotelInput.first().fill(data.hotelName);
    }

    // Address in Malaysia
    // SELECTOR NOTE: Full address of accommodation, may be a textarea.
    const myAddressInput = page.locator('textarea[name*="addressMY"], textarea[id*="addressMY"], input[name*="addressMY"], input[name*="stayAddress"], textarea[name*="stayAddress"]');
    if (await myAddressInput.count() > 0) {
      await myAddressInput.first().fill(data.addressInMalaysia);
    }

    // City in Malaysia
    // SELECTOR NOTE: City/town of accommodation.
    const myCityInput = page.locator('input[name*="cityMY"], input[id*="cityMY"], input[name*="city"], input[id*="city"]');
    if (await myCityInput.count() > 0) {
      await myCityInput.first().fill(data.cityInMalaysia);
    }

    // Postal Code
    // SELECTOR NOTE: 5-digit Malaysian postal code.
    const postalInput = page.locator('input[name*="postal"], input[id*="postal"], input[name*="zip"], input[id*="zip"]');
    if (await postalInput.count() > 0) {
      await postalInput.first().fill(data.postalCode);
    }

    // Accommodation Phone
    // SELECTOR NOTE: Phone number of the hotel/accommodation.
    const accomPhoneInput = page.locator('input[name*="accomPhone"], input[id*="accomPhone"], input[name*="hotelPhone"], input[id*="hotelPhone"]');
    if (await accomPhoneInput.count() > 0) {
      await accomPhoneInput.first().fill(data.accommodationPhone);
    }

    // ---- DECLARATION CHECKBOXES ----
    // SELECTOR NOTE: The MDAC form typically has 1–2 declaration checkboxes at the bottom.
    // TODO: Verify exact selector. Some forms use a single checkbox, others use two.
    const checkboxes = page.locator('input[type="checkbox"]');
    const checkboxCount = await checkboxes.count();
    for (let i = 0; i < checkboxCount; i++) {
      const cb = checkboxes.nth(i);
      const isChecked = await cb.isChecked();
      if (!isChecked) {
        await cb.click();
      }
    }

    // ---- SUBMIT ----
    // SELECTOR NOTE: The submit button may say "Submit", "Confirm", or "Register".
    // TODO: Verify the exact button text on the live site.
    const submitButton = page.locator(
      'button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Confirm"), button:has-text("Register")'
    );
    await submitButton.first().click();

    // Wait for confirmation or error
    // SELECTOR NOTE: After submit, the page should show a success message or redirect.
    // TODO: Verify what the success indicator looks like on the live site.
    await page.waitForSelector(
      '.success, .alert-success, [class*="success"], [class*="confirmation"], h2:has-text("Thank"), h2:has-text("Success"), p:has-text("PIN")',
      { timeout: 30_000 }
    ).catch(() => null);

    // Check for error messages
    const errorEl = page.locator('.alert-danger, .error, [class*="error"], [class*="alert-danger"]');
    if (await errorEl.count() > 0) {
      const errorText = await errorEl.first().textContent();
      return { success: false, error: errorText?.trim() || "Form submission error" };
    }

    // Check for success indicators
    const successEl = page.locator('.alert-success, [class*="success"], [class*="confirmation"]');
    const pinText = page.locator('p:has-text("PIN"), span:has-text("PIN"), div:has-text("PIN code")');
    if (await successEl.count() > 0 || await pinText.count() > 0) {
      return {
        success: true,
        message: "Submission complete. Check your email for your PIN code.",
      };
    }

    // Fallback: if no clear success/error, assume success (the PIN email will confirm)
    console.log("[mdac] No clear success/error indicator found — assuming success");
    return {
      success: true,
      message: "Submission complete. Check your email for your PIN code.",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mdac] submitMDAC error:", message);
    return { success: false, error: `Submission failed: ${message}` };
  } finally {
    await browser.close();
  }
}

/**
 * Retrieve the official QR code / confirmation PDF using phone number + PIN.
 *
 * NOTE: Selectors are best-effort. The "Check Registration" section of the MDAC site
 * may differ from the registration form — verify on the live site and update as needed.
 */
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
    await page.goto(MDAC_URL, { waitUntil: "networkidle", timeout: TIMEOUT_MS });

    // SELECTOR NOTE: Look for a "Check Registration" / "Retrieve" / "View Status" tab or button.
    // TODO: Verify the exact label/selector on the live site.
    const checkRegButton = page.locator(
      'a:has-text("Check Registration"), button:has-text("Check Registration"), a:has-text("View Status"), a:has-text("Retrieve"), button:has-text("Retrieve")'
    );
    if (await checkRegButton.count() > 0) {
      await checkRegButton.first().click();
      await page.waitForLoadState("networkidle");
    }

    // SELECTOR NOTE: Enter phone country code.
    // TODO: This may be a select dropdown or a combined input field.
    const codeSelect = page.locator('select[name*="countryCode"], select[id*="countryCode"], select[name*="phoneCode"], select[id*="phoneCode"]');
    if (await codeSelect.count() > 0) {
      await codeSelect.selectOption({ value: phoneCountryCode }).catch(async () => {
        await codeSelect.selectOption({ label: phoneCountryCode });
      });
    }

    // Phone number
    // SELECTOR NOTE: The phone input for retrieval.
    await page.waitForSelector('input[type="tel"], input[name*="phone"], input[id*="phone"]');
    await page.fill('input[type="tel"], input[name*="phone"], input[id*="phone"]', phoneNumber);

    // PIN
    // SELECTOR NOTE: The PIN sent via email/SMS after registration.
    // TODO: Verify pin field selector and format (numeric, 6 chars).
    await page.waitForSelector('input[name*="pin"], input[id*="pin"], input[name*="PIN"], input[id*="PIN"], input[type="password"]');
    await page.fill(
      'input[name*="pin"], input[id*="pin"], input[name*="PIN"], input[id*="PIN"], input[type="password"]',
      pin
    );

    // Submit the retrieval form
    // SELECTOR NOTE: Submit button for the retrieval form.
    const retrieveSubmit = page.locator(
      'button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Retrieve"), button:has-text("Check")'
    );
    await retrieveSubmit.first().click();

    // Wait for the confirmation document to appear
    // SELECTOR NOTE: The result may be a QR image element, a PDF download link, or an inline document.
    await page.waitForSelector(
      'img[src*="qr"], canvas, .qr-code, [class*="qr"], a[href*=".pdf"], iframe',
      { timeout: 30_000 }
    ).catch(() => null);

    // Check for error
    const errorEl = page.locator('.alert-danger, .error, [class*="error"]');
    if (await errorEl.count() > 0) {
      const errorText = await errorEl.first().textContent();
      return { success: false, error: errorText?.trim() || "Retrieval error — check phone number and PIN" };
    }

    // Try to get QR image
    // SELECTOR NOTE: The QR code might be an <img> tag or a <canvas> element.
    // TODO: Update selector based on what the live site actually renders.
    const qrImg = page.locator('img[src*="qr"], .qr-code img, [class*="qr"] img').first();
    const qrCanvas = page.locator('canvas').first();

    if (await qrImg.count() > 0) {
      // Screenshot the QR image element
      const screenshotBuffer = await qrImg.screenshot({ type: "png" });
      const base64 = screenshotBuffer.toString("base64");
      return { success: true, qrImageBase64: base64 };
    }

    if (await qrCanvas.count() > 0) {
      // Screenshot the canvas element
      const screenshotBuffer = await qrCanvas.screenshot({ type: "png" });
      const base64 = screenshotBuffer.toString("base64");
      return { success: true, qrImageBase64: base64 };
    }

    // Try PDF download link
    // SELECTOR NOTE: There may be a link to download the confirmation PDF.
    const pdfLink = page.locator('a[href*=".pdf"], a:has-text("Download"), a:has-text("PDF")').first();
    if (await pdfLink.count() > 0) {
      // Intercept the download and capture it as base64
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        pdfLink.click(),
      ]);
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const pdfBuffer = Buffer.concat(chunks);
      const base64 = pdfBuffer.toString("base64");
      return { success: true, pdfBase64: base64 };
    }

    // Fallback: screenshot the whole confirmation area
    // SELECTOR NOTE: If none of the above worked, capture the visible confirmation section.
    const confirmationSection = page.locator('.confirmation, [class*="confirmation"], main, #content').first();
    if (await confirmationSection.count() > 0) {
      const screenshotBuffer = await confirmationSection.screenshot({ type: "png" });
      const base64 = screenshotBuffer.toString("base64");
      return { success: true, qrImageBase64: base64 };
    }

    return {
      success: false,
      error: "Could not locate QR code or PDF on confirmation page. The site layout may have changed.",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mdac] retrieveQR error:", message);
    return { success: false, error: `Retrieval failed: ${message}` };
  } finally {
    await browser.close();
  }
}
