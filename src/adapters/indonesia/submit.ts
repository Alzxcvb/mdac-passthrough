// Direct-API Indonesia submission orchestrator. No Playwright required.
//
// The flow is:
//   1. Get a guest token (cached by the client)
//   2. Submit step 1 (3 register-form sub-calls) — TODO: confirm exact body
//      shapes by walking the live form once with network logging
//   3. Submit step 2 (/api/travel/individu) — TODO same
//   4. Submit step 3 (/api/mode-transport-address/submit) — confirmed live
//   5. Generate captcha + decode JWT for the answer
//   6. Submit step 4 (/api/declaration-captcha/submit) — confirmed body shape
//   7. Optionally: GET /api/submission/download-crossing for the QR/PDF
//
// Each step uses client.signedPost() which handles pre-sign + headers +
// signature relay. The adapter never holds the signing secret.
import { AllIndonesiaClient } from "./client";
import { generateCaptcha } from "./captcha";
import { generateSubmissionId } from "./submission-id";
import {
  countryByIso3, airportByIata, airlineByIata, provinceByName,
  purposeByCode, residenceByCode, transportByCode, airTransportByCode,
} from "./data";
import type {
  ArrivalPassTraveler,
  ModeTransportAddressPayload, DeclarationPayload,
  ProfileDataPayload, DocumentsPayload, AccountPayload, TravelDetailPayload,
} from "./types";

export interface SubmitResult {
  submissionId: string;
  status: "submitted" | "blocked-pre-submit" | "error";
  qrUrl?: string;
  /** Per-step API responses for debugging. */
  steps: Record<string, { ok: boolean; rc?: string; desc?: string }>;
  error?: string;
}

export interface SubmitOpts {
  client?: AllIndonesiaClient;
  /** Set to true to actually fire the final declaration-captcha/submit. */
  liveSubmit?: boolean;
}

const DDMMYYYY = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

export async function submitIndonesiaDirect(
  traveler: ArrivalPassTraveler,
  opts: SubmitOpts = {},
): Promise<SubmitResult> {
  const client = opts.client ?? new AllIndonesiaClient();
  const submissionId = generateSubmissionId();
  const steps: SubmitResult["steps"] = {};

  const liveSubmit = opts.liveSubmit ?? process.env.INDONESIA_LIVE_SUBMIT === "1";

  try {
    // Resolve UUIDs/ids from the bundled data.
    const nationality = countryByIso3(traveler.nationalityIso3);
    if (!nationality) throw new Error(`unknown nationality ISO-3: ${traveler.nationalityIso3}`);
    const placeOfBirth = countryByIso3(traveler.countryOfBirthIso3);
    if (!placeOfBirth) throw new Error(`unknown place of birth ISO-3: ${traveler.countryOfBirthIso3}`);

    // Defaults (overridable via traveler.indonesia).
    const air = transportByCode("A")!;
    const purpose = purposeByCode(traveler.indonesia?.purposeTravel ?? "5") // default 5 = HOLIDAY
      ?? { id: "5", name: "HOLIDAY/SIGHTSEEING/LEISURE", code: "5" };
    const placeArrival = airportByIata(traveler.indonesia?.placeArrivalIata ?? "CGK");
    if (!placeArrival) throw new Error(`unknown airport IATA: ${traveler.indonesia?.placeArrivalIata}`);
    const airTransportType = airTransportByCode("CM")!;
    const airline = traveler.indonesia?.flightIata
      ? airlineByIata(traveler.indonesia.flightIata)
      : undefined;
    const accommodation = residenceByCode(
      ((traveler.indonesia?.accommodationType ?? "HOTEL").charAt(0) as "R" | "H" | "O"),
    )!;

    // ---- Step 1 (3 sub-calls) ---- TODO: confirm body shapes against live walks
    const profileBody: ProfileDataPayload = {
      deviceLang: "EN", accountType: "WNA", groupId: "", submissionId,
      fullName: traveler.fullName,
      dateOfBirth: DDMMYYYY(traveler.dateOfBirth),
      countryOrPlaceOfBirth: placeOfBirth.id,
      gender: traveler.sex,
    };
    steps.profile = await callStep(client, "/api/register-form/foreigner/profile-data", profileBody);

    const documentsBody: DocumentsPayload = {
      deviceLang: "EN", accountType: "WNA", groupId: "", submissionId,
      nationality: nationality.id,
      passportNo: traveler.passportNumber,
      dateOfPassportExpiry: DDMMYYYY(traveler.passportExpiry),
    };
    steps.documents = await callStep(client, "/api/register-form/foreigner/documents", documentsBody);

    const accountBody: AccountPayload = {
      deviceLang: "EN", accountType: "WNA", groupId: "", submissionId,
      email: traveler.email,
      mobileNumber: traveler.mobileNumber,
      mobileCode: traveler.mobileDialCode,
    };
    steps.account = await callStep(client, "/api/register-form/foreigner/account", accountBody);

    // ---- Step 2: travel details ----
    const travelBody: TravelDetailPayload = {
      deviceLang: "EN", accountType: "WNA", groupId: "", submissionId,
      arrivalDate: DDMMYYYY(traveler.arrivalDate),
      departureDate: DDMMYYYY(traveler.departureDate),
      hasVisaOrStayPermit: traveler.indonesia?.visaOrStayPermitNumber ? "Y" : "N",
      visaOrStayPermitNumber: traveler.indonesia?.visaOrStayPermitNumber ?? "",
    };
    steps.travel = await callStep(client, "/api/travel/individu", travelBody);

    // ---- Step 3: mode of transport + address ----
    // For HOTEL accommodation, look up the hotel via search-hotel for its
    // city/province/postalCode/immigrationOffice.
    let hotelMeta: { id: string; city: string; province: string; postalCode: string; immigrationOffice: string } | null = null;
    if (accommodation.code === "H" && traveler.indonesia?.hotelSearch) {
      const hotels = await client.searchHotel(traveler.indonesia.hotelSearch);
      if (hotels.length > 0) {
        hotelMeta = {
          id: hotels[0].id, city: hotels[0].city, province: hotels[0].province,
          postalCode: hotels[0].postalCode, immigrationOffice: hotels[0].immigrationOffice,
        };
      }
    }

    const modeBody: ModeTransportAddressPayload = {
      deviceLang: "EN", accountType: "WNA", groupId: "", submissionId,
      modeTransport: air.id,
      purposeTravel: purpose.id,
      purposeTravelOthers: "",
      placeArrival: placeArrival.id,
      flightType: airTransportType.id,
      flightName: airline?.id ?? "",
      flightCode: airline?.iata ?? "",
      flightNumber: traveler.indonesia?.flightNumber ?? "",
      vehicleType: "", vehicleNumber: "",
      vesselType: "", vesselName: "",
      residenceType: accommodation.id,
      immigrationOffice: hotelMeta?.immigrationOffice ?? "",
      postalCode: hotelMeta?.postalCode ?? "",
      province: hotelMeta?.province ?? "",
      hotelCity: hotelMeta?.city ?? "",
      hotelName: hotelMeta?.id ?? "",
      hotelAddress: "",
      hotelNameOthers: "",
      address: "",
      city: "",
      accomodation: "",
    };
    steps.modeTransport = await callStep(client, "/api/mode-transport-address/submit", modeBody);

    // ---- Step 4: declaration with captcha ----
    if (!liveSubmit) {
      return { submissionId, status: "blocked-pre-submit", steps };
    }

    const captcha = await generateCaptcha();
    const declarationBody = {
      deviceLang: "EN", accountType: "WNA", groupId: "", submissionId,
      // Form fields — defaults: no symptoms, no animals, 1 baggage, no goods, no IMEI.
      hasSymptoms: "N",
      symptoms: [],
      countriesVisited21Days: [nationality.id],
      bringingProhibitedItems: "N",
      totalBaggage: 1,
      hasGoodsToDeclare: "N",
      hasImeiDevice: "N",
      // Captcha
      captchaToken: captcha.token,
      captchaCode: captcha.captchaCode,
    };
    steps.declaration = await callStep(client, "/api/declaration-captcha/submit", declarationBody);

    // QR / arrival-card download.
    let qrUrl: string | undefined;
    try {
      const dl = await client.signedPost("/api/submission/download-crossing", {
        deviceLang: "EN", accountType: "WNA", submissionId,
      });
      // TODO: dl response shape unknown — this might be a binary or a URL.
      // For now record success.
      if (dl.responseCode === "00") qrUrl = "(see /api/submission/download-crossing response)";
    } catch (_) { /* best effort */ }

    return { submissionId, status: "submitted", qrUrl, steps };
  } catch (err) {
    return {
      submissionId,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      steps,
    };
  }
}

async function callStep(
  client: AllIndonesiaClient,
  path: string,
  body: object,
): Promise<{ ok: boolean; rc?: string; desc?: string }> {
  try {
    const env = await client.signedPost(path, body as Record<string, unknown>);
    return { ok: env.responseCode === "00", rc: env.responseCode, desc: env.responseDesc };
  } catch (e) {
    return { ok: false, desc: e instanceof Error ? e.message : String(e) };
  }
}
