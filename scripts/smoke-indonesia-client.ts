// Smoke test for the Indonesia adapter's anonymous API surface. Confirms
// every master-dropdown method actually works against the live API and the
// CAPTCHA bypass returns a decoded answer. No submission is attempted.
//
// Run: npx tsx scripts/smoke-indonesia-client.ts
import { AllIndonesiaClient, generateCaptcha, decodeJwtPayload, generateSubmissionId } from "../src/adapters/indonesia";
import * as data from "../src/adapters/indonesia/data";

const ok = (name: string, cond: boolean, detail = "") => {
  const tag = cond ? "PASS" : "FAIL";
  console.log(`  ${tag}  ${name}${detail ? "  — " + detail : ""}`);
  if (!cond) process.exitCode = 1;
};

(async () => {
  console.log("=== bundled data ===");
  ok("countries bundled", data.countries.length === 231, `${data.countries.length} rows`);
  ok("provinces bundled", data.provinces.length === 34, `${data.provinces.length} rows`);
  ok("cities bundled", data.cities.length === 513, `${data.cities.length} rows`);
  ok("airports bundled", data.airports.length === 37, `${data.airports.length} rows`);
  ok("seaports bundled", data.seaports.length === 147, `${data.seaports.length} rows`);
  ok("airlines bundled", data.airFlights.length === 211, `${data.airFlights.length} rows`);
  ok("residence types bundled", data.residenceTypes.length === 3);
  ok("genders bundled", data.genders.length === 2);
  ok("transports bundled", data.transports.length === 2);
  ok("airTransports bundled", data.airTransports.length === 3);

  console.log("\n=== bundled lookups ===");
  const usa = data.countryByIso3("USA");
  ok("countryByIso3('USA')", !!usa, usa?.name);
  ok("USA has phoneCode", usa?.phoneCode === "+1", usa?.phoneCode);
  const cgk = data.airportByIata("CGK");
  ok("airportByIata('CGK')", !!cgk, cgk?.name);
  const ga = data.airlineByIata("GA");
  ok("airlineByIata('GA')", !!ga, ga?.name);
  const bali = data.provinceByName("BALI");
  ok("provinceByName('BALI')", !!bali);

  console.log("\n=== live API (anonymous) ===");
  const client = new AllIndonesiaClient();
  try {
    const provinces = await client.provinces();
    ok("client.provinces()", provinces.length >= 34, `${provinces.length} rows`);
    if (bali) {
      const cities = await client.citiesByProvince(bali.id);
      ok("client.citiesByProvince(BALI)", cities.length > 0, `${cities.length} cities`);
      ok("city has immigrationOffice", !!cities[0]?.immigrationOffice, cities[0]?.immigrationOffice);
    }
    const cmAirlines = await client.airFlightsByCode("CM");
    ok("client.airFlightsByCode('CM')", cmAirlines.length >= 200, `${cmAirlines.length} commercial airlines`);
    const hyatts = await client.searchHotel("hyatt");
    ok("client.searchHotel('hyatt')", hyatts.length > 0, `${hyatts.length} matches`);
    if (hyatts[0]) {
      ok("hotel has city UUID", !!hyatts[0].city);
      ok("hotel has immigrationOffice", !!hyatts[0].immigrationOffice);
    }
  } catch (err) {
    ok("client API calls", false, String(err));
  }

  console.log("\n=== auth ===");
  try {
    const token = await client.ensureGuestToken();
    ok("ensureGuestToken returns JWT", token.split(".").length === 3);
    const payload = decodeJwtPayload<{ idUser: string; arrivalType: string; exp: number }>(token);
    ok("guest payload has idUser", typeof payload.idUser === "string" && payload.idUser.length > 8);
    ok("guest arrivalType=WNA", payload.arrivalType === "WNA");
    const ttlHours = (payload.exp * 1000 - Date.now()) / 3_600_000;
    ok("guest TTL ~24h", ttlHours > 23 && ttlHours <= 24.1, `${ttlHours.toFixed(2)}h`);
    // Re-call should return cached token (fast).
    const start = Date.now();
    const cached = await client.ensureGuestToken();
    ok("guest token cached (no extra fetch)", cached === token && Date.now() - start < 50);
  } catch (err) {
    ok("guest auth", false, String(err));
  }

  console.log("\n=== captcha bypass ===");
  try {
    const cap = await generateCaptcha();
    ok("captcha JWT", cap.token.split(".").length === 3);
    ok("captchaCode is 4-digit", /^\d{4}$/.test(cap.captchaCode), cap.captchaCode);
    ok("captchaCode JWT exp ~6 minutes", cap.expEpochMs > Date.now() && cap.expEpochMs < Date.now() + 7 * 60_000);
    ok("uuid present", typeof cap.uuid === "string");
  } catch (err) {
    ok("captcha bypass", false, String(err));
  }

  console.log("\n=== submission id ===");
  const id = generateSubmissionId();
  ok("submissionId starts with ID", id.startsWith("ID"), id);
  ok("submissionId has expected length", id.length > 24, `len=${id.length}`);

  console.log("\nDone.");
})();
