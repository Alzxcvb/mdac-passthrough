// Playwright-driven Indonesia submission flow. Uses the live browser to
// avoid having to reverse-engineer the x-signature binding. Mirrors the
// existing MDAC playwright pattern (services/mdac.ts) for consistency.
//
// Two ways to run:
//   1. Standalone: launches its own Chromium and walks the form.
//   2. Bridged: connectOverCDP(...) to a user-launched Chrome (recon mode).
//
// The flow fills the form via real DOM events — same selector/click pattern
// as our recon scripts (synthesized mousedown+mouseup+click on the
// virtuoso row's clickable wrapper).
import { chromium, type Browser, type Page, type BrowserContext } from "playwright";
import type { ArrivalPassTraveler } from "./types";
import {
  countryByIso3, airportByIata, provinceByName, purposeByCode, residenceByCode,
} from "./data";
import { generateSubmissionId } from "./submission-id";
import { generateCaptcha } from "./captcha";

const ORIGIN = "https://allindonesia.imigrasi.go.id";

export interface FlowOptions {
  /** If set, attach to an existing Chrome on this CDP URL instead of launching a fresh browser. */
  cdpUrl?: string;
  headless?: boolean;
  timeoutMs?: number;
}

export interface FlowResult {
  submissionId: string;
  qrUrl?: string;
  status: "submitted" | "blocked-pre-submit" | "error";
  error?: string;
  // Diagnostics for debugging — what we attempted, what came back.
  artifacts?: {
    finalUrl: string;
    declarationOk: boolean;
  };
}

export async function submitIndonesia(
  traveler: ArrivalPassTraveler,
  opts: FlowOptions = {},
): Promise<FlowResult> {
  const submissionId = generateSubmissionId();

  let browser: Browser | null = null;
  let ctx: BrowserContext;
  let ownsBrowser = false;
  if (opts.cdpUrl) {
    browser = await chromium.connectOverCDP(opts.cdpUrl);
    ctx = browser.contexts()[0] ?? (await browser.newContext());
  } else {
    browser = await chromium.launch({ headless: opts.headless ?? true });
    ctx = await browser.newContext();
    ownsBrowser = true;
  }

  const page = await ctx.newPage();
  page.setDefaultTimeout(opts.timeoutMs ?? 30_000);

  try {
    await fillIndonesiaToDeclaration(page, traveler);
    return await submitIndonesiaDeclaration(page, submissionId);
  } catch (err) {
    return {
      submissionId,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (ownsBrowser) await browser?.close();
  }
}

/**
 * Phase 1 of the session-relay: drive the form from landing through the
 * declaration step (steps 1-3 + declaration fills + JWT captcha decode),
 * stopping BEFORE the final Submit. Operates on a caller-owned `page` so a
 * session manager can keep the browser alive while the user reviews and
 * authorizes. The caller owns the browser open/close lifecycle.
 */
export async function fillIndonesiaToDeclaration(
  page: Page,
  traveler: ArrivalPassTraveler,
): Promise<void> {
  // 1. Land on Foreign Visitor flow.
  await page.goto(`${ORIGIN}/`);
  await clickByText(page, "Foreign Visitor");
  await page.waitForURL(/personal-information/, { timeout: 15_000 });

  // 2. Step 1: Personal Information + Account Information.
  await fillStep1(page, traveler);
  await clickByText(page, "Next");
  await page.waitForURL(/travel-details/, { timeout: 15_000 });

  // 3. Step 2: Travel Details.
  await fillStep2(page, traveler);
  await clickByText(page, "Next");
  await page.waitForURL(/mode-of-transport/, { timeout: 15_000 });

  // 4. Step 3: Mode of Transport + Address.
  await fillStep3(page, traveler);
  await clickByText(page, "Next");
  await page.waitForURL(/declaration/, { timeout: 15_000 });

  // 5. Step 4: Declaration. CAPTCHA bypass via JWT-decoded code.
  const captcha = await generateCaptcha();
  await fillStep4(page, traveler, captcha.captchaCode);
}

/**
 * Phase 2 of the session-relay: click the final Submit and read back the QR.
 *
 * GATED: until `INDONESIA_LIVE_SUBMIT === "1"` AND the step-4 selectors
 * (captcha input, 21-day country multiselect, IMEI, QR extraction) are
 * confirmed by a live recon pass, this returns "blocked-pre-submit" without
 * touching the government system. Same posture as MDAC's stubbed _click_submit.
 */
export async function submitIndonesiaDeclaration(
  page: Page,
  submissionId: string,
): Promise<FlowResult> {
  // GUARD: do not actually submit unless explicitly allowed via env flag.
  if (process.env.INDONESIA_LIVE_SUBMIT !== "1") {
    return {
      submissionId,
      status: "blocked-pre-submit",
      artifacts: { finalUrl: page.url(), declarationOk: true },
    };
  }
  await clickByText(page, "Submit");
  await page.waitForURL(/summary/, { timeout: 30_000 });
  const qrUrl = await page.evaluate(() => {
    const img = document.querySelector('img[src*="qr"], img[src*="QR"]') as HTMLImageElement | null;
    return img?.src ?? null;
  });
  return {
    submissionId,
    qrUrl: qrUrl ?? undefined,
    status: "submitted",
    artifacts: { finalUrl: page.url(), declarationOk: true },
  };
}

// ---- Step fillers (skeleton — wire up once selectors are confirmed) ----

async function fillStep1(page: Page, t: ArrivalPassTraveler) {
  // Nationality
  const nat = countryByIso3(t.nationalityIso3);
  if (nat) await pickFromVirtuoso(page, '[id^="spi_nationality_"]', nat.name);

  // Full Name
  await page.fill('[id^="spi_full_name_"]', t.fullName);

  // DOB — text DD/MM/YYYY
  await page.fill('[id^="spi_dob_"]', isoToDdmmyyyy(t.dateOfBirth));

  // Country/Place of birth
  const pob = countryByIso3(t.countryOfBirthIso3);
  if (pob) await pickFromVirtuoso(page, '[id^="spi_country_or_place_of_birth_"]', pob.name);

  // Sex chip
  await clickChipByValue(page, t.sex === "M" ? "MALE" : "FEMALE");

  await page.fill('[id^="spi_passport_no_"]', t.passportNumber);
  await page.fill('[id^="spi_date_of_passport_expiry_"]', isoToDdmmyyyy(t.passportExpiry));

  // Mobile dial code — unlabeled readonly picker sitting left of the mobile
  // number input. Find it by relative position to the mobile-number field.
  const dialCodeOk = await page.evaluate((dialCode) => {
    const mobile = document.querySelector('[id^="spi_mobile_no_"]') as HTMLInputElement | null;
    if (!mobile) return false;
    // Walk up to the row that contains both the dial-code picker + mobile input.
    let row: HTMLElement | null = mobile.parentElement;
    let pickerInput: HTMLInputElement | null = null;
    for (let i = 0; i < 6 && row && !pickerInput; i++, row = row.parentElement) {
      pickerInput = [...row.querySelectorAll("input")]
        .find((el) => el.readOnly && /^Select/i.test(el.value || "")) as HTMLInputElement | null;
    }
    if (!pickerInput) return false;
    let n: HTMLElement | null = pickerInput;
    let target: HTMLElement = pickerInput;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      if (getComputedStyle(n).cursor === "pointer") { target = n; break; }
    }
    target.click();
    void dialCode;
    return true;
  }, t.mobileDialCode);
  if (dialCodeOk) {
    await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5_000 }).catch(() => {});
    // Each row in the dial-code picker is "+XX COUNTRY". Type-search by phone code.
    const search = page.locator('input[placeholder="Search" i]').first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill(t.mobileDialCode);
      await page.waitForTimeout(800);
    }
    // Click first row.
    await page.locator('[data-virtuoso-scroller="true"] [data-index="0"]').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
  }

  await page.fill('[id^="spi_mobile_no_"]', t.mobileNumber);
  await page.fill('[id^="spi_email_"]', t.email);
}

async function fillStep2(page: Page, t: ArrivalPassTraveler) {
  // Arrival date — virtuoso bottom-sheet, items "DD MMM YYYY" uppercase.
  const arr = isoToDdMmmYyyy(t.arrivalDate);
  await pickFromVirtuoso(page, "#std_arrival_date_foreigner_individual", arr);

  // Departure — typeable.
  await page.fill("#std_departure_date_foreigner_individual", isoToDdmmyyyy(t.departureDate));

  // Visa/stay-permit Yes/No.
  const visaNo = !t.indonesia?.visaOrStayPermitNumber;
  await clickVisaChip(page, visaNo ? "No" : "Yes");
  if (!visaNo) {
    await page.fill("#std_visa_kitas_kitap_no_foreigner_individual", t.indonesia!.visaOrStayPermitNumber!);
  }
}

async function fillStep3(page: Page, t: ArrivalPassTraveler) {
  // Mode of transport — default AIR.
  await pickFromVirtuoso(page, "#smta_mode_transport_foreigner", "AIR");

  // Purpose
  const purpose = t.indonesia?.purposeTravel ?? "5"; // default: HOLIDAY
  const purposeRow = purposeByCode(purpose) ?? { name: "HOLIDAY/SIGHTSEEING/LEISURE" };
  await pickFromVirtuoso(page, "#smta_purpose_travel_foreigner", purposeRow.name);

  // Place of arrival
  const iata = t.indonesia?.placeArrivalIata ?? "CGK";
  const airport = airportByIata(iata);
  if (airport) await pickFromVirtuoso(page, "#smta_place_of_arrival_air_foreigner", airport.name);

  // Air transport type — default COMMERCIAL FLIGHT.
  await pickFromVirtuoso(page, "#smta_air_transport_type_foreigner", "COMMERCIAL FLIGHT");

  // Flight Name — pick airline by IATA (after cascade fires).
  await page.waitForTimeout(800);
  if (t.indonesia?.flightIata) {
    // Open and search-then-pick.
    // TODO: implement search + pick — virtuoso typeahead.
  }

  // Flight Number
  if (t.indonesia?.flightNumber) {
    await page.fill("#smta_flight_no_foreigner", t.indonesia.flightNumber);
  }

  // Accommodation
  const accomm = t.indonesia?.accommodationType ?? "HOTEL";
  await pickFromVirtuoso(page, "#smta_residence_type_foreigner", accomm);

  if (accomm === "HOTEL" && t.indonesia?.hotelSearch) {
    await openVirtuoso(page, "#smta_hotel_name_foreigner");
    await typeIntoSearch(page, t.indonesia.hotelSearch);
    await page.waitForTimeout(1500);
    // Click first result.
    await page.locator('[data-virtuoso-scroller="true"] [data-index="0"]').first().click({ force: true });
  } else if (accomm === "RESIDENTIAL") {
    if (t.indonesia?.residentialAddress) {
      // TODO: confirm field id for residential address — likely a textarea.
    }
    if (t.indonesia?.residentialProvinceName) {
      const prov = provinceByName(t.indonesia.residentialProvinceName);
      if (prov) await pickFromVirtuoso(page, "#smta_residential_province_foreigner", prov.name);
    }
  }
}

async function fillStep4(page: Page, t: ArrivalPassTraveler, captchaCode: string) {
  // Health: assume no symptoms.
  await clickChipByValueInSection(page, "Health Declaration", "No");
  // 21-day country list — pick country of departure (use traveler.nationality as default).
  // TODO: country multi-select picker.

  // Quarantine: no
  await clickChipByValueInSection(page, "Quarantine Declaration", "No");

  // Customs: 1 baggage, nothing to declare, no IMEI.
  await page.fill("#asd_total_baggage_individual", "1");
  await clickChipByValueInSection(page, "Customs Declaration", "No"); // goods to declare
  // IMEI Yes/No — pick No.
  // TODO: locate the IMEI section by header text.

  // Final acknowledgement checkbox.
  await page.evaluate(() => {
    const txt = "I, the Applicant hereby certify";
    const node = [...document.querySelectorAll("p, div, label")].find((n) => (n.textContent || "").includes(txt));
    if (node) {
      const wrap = node.closest("[class*='checkbox'], [class*='Check'], div");
      const target = wrap?.querySelector("input[type='checkbox'], div[role='checkbox']") ?? wrap;
      (target as HTMLElement | null)?.click();
    }
  });

  // Captcha input — find the visible captcha field and fill it.
  // TODO: confirm the captcha input selector. Likely a text input in the
  //       footer area when the page renders. We have the answer (`captchaCode`)
  //       — adapter doesn't need image OCR.
  void captchaCode;
}

// ---- Click + virtuoso helpers (lifted from recon scripts) ----

async function clickByText(page: Page, text: string) {
  await page.evaluate((label) => {
    const btn = [...document.querySelectorAll("button, [role='button']")].find(
      (b) => (b.textContent || "").trim() === label && !(b as HTMLButtonElement).disabled,
    ) as HTMLElement | undefined;
    if (btn) {
      btn.scrollIntoView({ behavior: "instant", block: "center" });
      btn.click();
    }
  }, text);
}

async function openVirtuoso(page: Page, idOrSelector: string) {
  await page.evaluate((sel) => {
    const inp = document.querySelector(sel) as HTMLElement | null;
    if (!inp) return;
    let n: HTMLElement | null = inp;
    let target: HTMLElement = inp;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      if (getComputedStyle(n).cursor === "pointer") { target = n; break; }
    }
    const r = target.getBoundingClientRect();
    const opts = {
      bubbles: true, cancelable: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window,
    };
    target.dispatchEvent(new MouseEvent("mousedown", opts));
    target.dispatchEvent(new MouseEvent("mouseup", opts));
    target.dispatchEvent(new MouseEvent("click", opts));
  }, idOrSelector);
  await page.waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 5_000 }).catch(() => {});
}

async function typeIntoSearch(page: Page, text: string) {
  const search = page.locator('input[placeholder="Search" i]').first();
  if (await search.isVisible().catch(() => false)) {
    await search.fill(text);
  }
}

async function pickFromVirtuoso(page: Page, idOrSelector: string, exactText: string) {
  await openVirtuoso(page, idOrSelector);
  await page.waitForTimeout(400);
  for (let pass = 0; pass < 80; pass++) {
    const found = await page.evaluate((text) => {
      const s = document.querySelector('[data-virtuoso-scroller="true"]') as HTMLElement | null;
      if (!s) return { ok: false, done: true };
      const rows = [...s.querySelectorAll("[data-index]")] as HTMLElement[];
      for (const r of rows) {
        if ((r.textContent || "").trim() === text) {
          const inner = (r.querySelector(".") || r) as HTMLElement;
          const rect = inner.getBoundingClientRect();
          const opts = {
            bubbles: true, cancelable: true,
            clientX: rect.left + 20, clientY: rect.top + rect.height / 2, view: window,
          };
          inner.dispatchEvent(new MouseEvent("mousedown", opts));
          inner.dispatchEvent(new MouseEvent("mouseup", opts));
          inner.dispatchEvent(new MouseEvent("click", opts));
          inner.click();
          return { ok: true };
        }
      }
      s.scrollTop = s.scrollTop + s.clientHeight * 0.7;
      return { ok: false };
    }, exactText);
    if (found.ok) return true;
    if (found.done) return false;
    await page.waitForTimeout(120);
  }
  return false;
}

async function clickChipByValue(page: Page, value: string) {
  await page.evaluate((v) => {
    const inp = [...document.querySelectorAll("input")].find((i) => (i as HTMLInputElement).value === v) as HTMLInputElement | undefined;
    if (!inp) return;
    let n: HTMLElement | null = inp;
    let target: HTMLElement = inp;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      if (getComputedStyle(n).cursor === "pointer") { target = n; break; }
    }
    target.click();
  }, value);
}

async function clickVisaChip(page: Page, value: "Yes" | "No") {
  await page.evaluate((v) => {
    const container = document.getElementById("std_do_have_visa_kitas_kitap_foreigner_individual");
    if (!container) return;
    const inp = [...container.querySelectorAll("input")].find((i) => (i as HTMLInputElement).value === v) as HTMLInputElement | undefined;
    if (!inp) return;
    let n: HTMLElement | null = inp;
    let target: HTMLElement = inp;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      if (getComputedStyle(n).cursor === "pointer") { target = n; break; }
    }
    target.click();
  }, value);
}

async function clickChipByValueInSection(page: Page, sectionHeading: string, chipValue: "Yes" | "No") {
  await page.evaluate(([heading, chipV]) => {
    const headings = [...document.querySelectorAll("h1, h2, h3, h4, p")] as HTMLElement[];
    const h = headings.find((x) => (x.textContent || "").includes(heading));
    if (!h) return;
    let scope: HTMLElement | null = h;
    for (let i = 0; i < 6 && scope; i++, scope = scope.parentElement) {
      const inp = [...scope.querySelectorAll("input")].find((x) => (x as HTMLInputElement).value === chipV) as HTMLInputElement | undefined;
      if (inp) {
        let n: HTMLElement | null = inp;
        let target: HTMLElement = inp;
        for (let j = 0; j < 6 && n; j++, n = n.parentElement) {
          if (getComputedStyle(n).cursor === "pointer") { target = n; break; }
        }
        target.click();
        return;
      }
    }
  }, [sectionHeading, chipValue] as const);
}

// ---- Date format helpers ----

function isoToDdmmyyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function isoToDdMmmYyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d.padStart(2, "0")} ${MONTHS[parseInt(m, 10) - 1]} ${y}`;
}
