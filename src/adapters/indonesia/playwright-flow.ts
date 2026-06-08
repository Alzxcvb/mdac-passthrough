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
  countryByIso3, airportByIata, airlineByIata, provinceByName, purposeByCode, residenceByCode,
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
 * Recon aid: when INDONESIA_RECON_DEBUG=1, screenshot the page and log the URL.
 * No-op in normal operation. Used to diagnose selector/flow drift on the live
 * form without a visible browser.
 */
async function reconShot(page: Page, label: string): Promise<void> {
  if (process.env.INDONESIA_RECON_DEBUG !== "1") return;
  try {
    await page.screenshot({ path: `/tmp/claude/id-recon/${label}.png`, fullPage: true });
    console.log(`[id-recon] ${label}: ${page.url()}`);
  } catch (e) {
    console.log(`[id-recon] ${label}: screenshot failed — ${(e as Error).message}`);
  }
}

/**
 * Click "Next" and wait for the expected step URL. On timeout (a required field
 * blocked the step) capture the stuck page + any on-screen validation errors
 * when recon-debug is on, then rethrow so the failure is visible.
 */
async function nextAndWait(page: Page, urlRe: RegExp, label: string): Promise<void> {
  await clickByText(page, "Next");
  try {
    await page.waitForURL(urlRe, { timeout: 15_000 });
  } catch (e) {
    if (process.env.INDONESIA_RECON_DEBUG === "1") {
      // Capture the stuck state: screenshot + every control's value (so a
      // genuinely-empty required field is visible) + any inline error text.
      await page.screenshot({ path: `/tmp/claude/id-recon/STUCK-${label}.png`, fullPage: true }).catch(() => {});
      const dump = await page
        .evaluate(() => {
          const fields = [...document.querySelectorAll("input,textarea")].map((e) => ({
            id: (e as HTMLInputElement).id,
            ph: e.getAttribute("placeholder"),
            v: (e as HTMLInputElement).value,
          }));
          const errs = [...document.querySelectorAll("p,span,div")]
            .map((n) => (n.childElementCount === 0 ? (n.textContent || "").trim() : ""))
            .filter((t) => /required|cannot be empty|must be|invalid/i.test(t) && t.length < 80);
          return { fields, errs: [...new Set(errs)] };
        })
        .catch(() => ({ fields: [], errs: [] }));
      console.log(`[id-recon] STUCK at ${label} url=${page.url()}`);
      console.log(`[id-recon] STUCK errs=${JSON.stringify(dump.errs)}`);
      console.log(`[id-recon] STUCK fields=${JSON.stringify(dump.fields)}`);
    }
    throw e;
  }
}

/** Poll until the field at `selector` has a non-empty value (for cascade-derived
 *  fields like the immigration office that populate async after a pick). */
async function waitForValue(page: Page, selector: string, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await page.locator(selector).first().inputValue().catch(() => "");
    if (v && v.trim()) return true;
    if (Date.now() > deadline) return false;
    await page.waitForTimeout(200);
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
  // 1. Land, switch to English, then enter the Foreign Visitor flow. The
  //    landing is a React SPA that defaults to Indonesian and renders the
  //    entry cards after hydration — wait for networkidle before clicking.
  await page.goto(`${ORIGIN}/`, { waitUntil: "networkidle" });
  await switchToEnglish(page);
  await clickByText(page, "Foreign Visitor");
  await page.waitForURL(/personal-information/, { timeout: 15_000 });
  // The step-1 form mounts behind a loading spinner while it fetches config /
  // the country list. Filling the first field (nationality) before that clears
  // silently fails — wait for the data load to settle first.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
  await reconShot(page, "1-personal-blank");

  // 2. Step 1: Personal Information + Account Information.
  await fillStep1(page, traveler);
  await reconShot(page, "2-personal-filled");
  await nextAndWait(page, /travel-details/, "step1");

  // 3. Step 2: Travel Details.
  await fillStep2(page, traveler);
  await reconShot(page, "3-travel-filled");
  await nextAndWait(page, /mode-of-transport/, "step2");

  // 4. Step 3: Mode of Transport + Address.
  await fillStep3(page, traveler);
  await reconShot(page, "4-transport-filled");
  await nextAndWait(page, /declaration/, "step3");

  // 5. Step 4: Declaration. CAPTCHA bypass via JWT-decoded code.
  await reconShot(page, "5-declaration-blank");
  const captcha = await generateCaptcha();
  await fillStep4(page, traveler, captcha.captchaCode);
  await reconShot(page, "6-declaration-filled");
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
  // Arrival date — virtuoso list, rows are "DD MONTH YYYY" (full month name,
  // uppercase, e.g. "01 JULY 2026"). No search box, so pickFromVirtuoso scrolls.
  const arr = isoToDdMonthYyyy(t.arrivalDate);
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
  if (process.env.INDONESIA_RECON_DEBUG === "1") {
    const f = await page.evaluate(() =>
      [...document.querySelectorAll("input,textarea")].map((e) => {
        let lbl = ""; let p: HTMLElement | null = (e as HTMLElement).closest("div");
        for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
          const l = p.querySelector("label,p,span,h4");
          if (l && (l.textContent || "").trim()) { lbl = (l.textContent || "").trim().slice(0, 40); break; }
        }
        return { id: (e as HTMLInputElement).id, ph: e.getAttribute("placeholder"), ro: (e as HTMLInputElement).readOnly, label: lbl };
      }),
    );
    console.log("[id-recon] step3 fields:", JSON.stringify(f));
  }
  // The form splits the flight into three fields: Flight Name (airline picker),
  // Code (airline IATA prefix, e.g. "GA"), and Flight Number (digits, e.g.
  // "880"). Parse "GA880" into prefix + digits; prefer an explicit flightIata.
  const rawFlight = (t.indonesia?.flightNumber || "").toUpperCase().replace(/\s+/g, "");
  const m = rawFlight.match(/^([A-Z0-9]{2,3}?)(\d+)$/);
  const flightPrefix = (t.indonesia?.flightIata || (m ? m[1] : "")).toUpperCase();
  const flightDigits = m ? m[2] : rawFlight.replace(/^[A-Z0-9]{2,3}/, "");

  if (flightPrefix) {
    const airline = airlineByIata(flightPrefix);
    if (airline) {
      await pickFromVirtuoso(page, "#smta_flight_name_foreigner", airline.name);
      // The Code prefix is auto-populated by the airline selection — but async.
      // Wait for it to commit before moving on (clicking Next before the cascade
      // lands trips a phantom "required" error even though the field shows text).
      await waitForValue(page, "#smta_flight_no_prefix_foreigner", 5_000);
    }
    // Fallback only if the cascade never populated the code.
    const codeLoc = page.locator("#smta_flight_no_prefix_foreigner");
    if (!(await codeLoc.inputValue().catch(() => ""))) {
      await codeLoc.click().catch(() => {});
      await codeLoc.pressSequentially(flightPrefix, { delay: 40 }).catch(() => {});
    }
  }
  if (flightDigits) {
    const noLoc = page.locator("#smta_flight_no_foreigner");
    await noLoc.click().catch(() => {});
    await noLoc.pressSequentially(flightDigits, { delay: 40 }).catch(() => {});
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
    // Selecting the hotel cascades the Nearest Immigration Office field async.
    // Wait for it to commit, else Next fires with it still empty (phantom
    // "required" error).
    await waitForValue(page, "#smta_hotel_nearest_immigration_office_foreigner", 8_000);
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

/**
 * Click an element by its exact visible text. Polls until the element appears
 * (the form is a React SPA that re-renders after navigation / locale switch),
 * then clicks. Handles two shapes:
 *   1. a real <button> / [role=button] with that label, or
 *   2. a text leaf (<h4>/<div>/<span>) inside a cursor:pointer wrapper — the
 *      "Foreign Visitor" entry card and similar controls are NOT buttons.
 * Throws if the label never appears within `timeoutMs` (loud failure beats a
 * confusing waitForURL timeout much later).
 */
async function clickByText(page: Page, text: string, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const clicked = await page
      .evaluate((label) => {
        const btn = [...document.querySelectorAll("button, [role='button']")].find(
          (b) => (b.textContent || "").trim() === label && !(b as HTMLButtonElement).disabled,
        ) as HTMLElement | undefined;
        if (btn) {
          btn.scrollIntoView({ behavior: "instant", block: "center" });
          btn.click();
          return true;
        }
        const leaves = [...document.querySelectorAll("h1,h2,h3,h4,p,div,span,a,li")];
        const node = leaves.find(
          (n) => n.children.length === 0 && (n.textContent || "").trim() === label,
        ) as HTMLElement | undefined;
        if (!node) return false;
        let cur: HTMLElement | null = node;
        for (let i = 0; i < 10 && cur; i++, cur = cur.parentElement) {
          if (getComputedStyle(cur).cursor === "pointer") {
            cur.scrollIntoView({ behavior: "instant", block: "center" });
            cur.click();
            return true;
          }
        }
        node.scrollIntoView({ behavior: "instant", block: "center" });
        node.click();
        return true;
      }, text)
      // The page may be mid-navigation (context destroyed) — treat as not-yet
      // and retry rather than crashing.
      .catch(() => false);
    if (clicked) return;
    if (Date.now() > deadline) {
      throw new Error(`clickByText: no element matched "${text}" within ${timeoutMs}ms`);
    }
    await page.waitForTimeout(400);
  }
}

/**
 * The site defaults to Indonesian; the adapter matches English labels
 * ("Foreign Visitor", "Next", "Submit", section headers) throughout, so flip
 * the UI to English before walking the flow. Selecting English triggers a
 * locale reload that destroys the execution context — tolerate that and wait
 * for the reload to settle. Best-effort: already-English sessions are a no-op
 * (the subsequent polling clickByText absorbs any timing slack).
 */
async function switchToEnglish(page: Page) {
  await clickByText(page, "Languages", 8_000).catch(() => {});
  await page.waitForTimeout(600);
  await page
    .evaluate(() => {
      const node = [...document.querySelectorAll("li,button,a,div,span")].find(
        (n) => (n.textContent || "").trim() === "English",
      ) as HTMLElement | undefined;
      if (!node) return;
      let cur: HTMLElement | null = node;
      for (let i = 0; i < 8 && cur; i++, cur = cur.parentElement) {
        if (getComputedStyle(cur).cursor === "pointer") {
          cur.click();
          return;
        }
      }
      node.click();
    })
    .catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
}

async function openVirtuoso(page: Page, idOrSelector: string) {
  // Wait for the field to exist — each step mounts behind a brief loading state,
  // and firing the open click before the field renders silently does nothing
  // (the dropdown never appears). Then retry the open until the scroller shows.
  await page.waitForSelector(idOrSelector, { state: "visible", timeout: 12_000 }).catch(() => {});
  for (let attempt = 0; attempt < 3; attempt++) {
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
    const opened = await page
      .waitForSelector('[data-virtuoso-scroller="true"]', { timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (opened) return;
    await page.waitForTimeout(500);
  }
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
  // These pickers are virtualized (only ~16 rows rendered at a time) but have a
  // search box. Typing filters the list so the target renders immediately —
  // the scroll-only approach silently misses entries far down a long list
  // (e.g. "UNITED STATES OF AMERICA"). Best-effort: no-op if there's no search.
  await typeIntoSearch(page, exactText);
  await page.waitForTimeout(700);
  for (let pass = 0; pass < 80; pass++) {
    // Locate the row by EXACT text and return its data-index. We do NOT click
    // inside evaluate: a synthetic .click()/dispatchEvent fires React's onClick
    // for some pickers (country lists) but NOT others (the date picker) — a real
    // Playwright click works universally. So find here, click via Playwright.
    const dataIndex = await page.evaluate((text) => {
      const s = document.querySelector('[data-virtuoso-scroller="true"]') as HTMLElement | null;
      if (!s) return "__noscroller__";
      const rows = [...s.querySelectorAll("[data-index]")] as HTMLElement[];
      const match = rows.find((r) => (r.textContent || "").trim() === text);
      if (match) return match.getAttribute("data-index");
      s.scrollTop = s.scrollTop + s.clientHeight * 0.7;
      return "__scroll__";
    }, exactText);
    if (dataIndex === "__noscroller__") {
      if (process.env.INDONESIA_RECON_DEBUG === "1")
        console.log(`[id-recon] pick "${exactText}" on ${idOrSelector}: NO SCROLLER (picker didn't open)`);
      return false;
    }
    if (dataIndex && dataIndex !== "__scroll__") {
      await page
        .locator(`[data-virtuoso-scroller="true"] [data-index="${dataIndex}"]`)
        .first()
        .click({ force: true })
        .catch(() => {});
      await page.waitForTimeout(300);
      if (process.env.INDONESIA_RECON_DEBUG === "1")
        console.log(`[id-recon] pick "${exactText}" on ${idOrSelector}: clicked data-index=${dataIndex} (pass ${pass})`);
      return true;
    }
    await page.waitForTimeout(120);
  }
  if (process.env.INDONESIA_RECON_DEBUG === "1")
    console.log(`[id-recon] pick "${exactText}" on ${idOrSelector}: NOT FOUND after 80 passes`);
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
const MONTHS_FULL = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];
function isoToDdMmmYyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d.padStart(2, "0")} ${MONTHS[parseInt(m, 10) - 1]} ${y}`;
}
/** "2026-07-01" -> "01 JULY 2026" — the arrival-date picker uses full month names. */
function isoToDdMonthYyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d.padStart(2, "0")} ${MONTHS_FULL[parseInt(m, 10) - 1]} ${y}`;
}
