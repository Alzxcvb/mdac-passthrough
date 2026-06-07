// End-to-end smoke for the direct Indonesia submission flow with a fake
// burner traveler. Stops BEFORE the final declaration-captcha submit unless
// INDONESIA_LIVE_SUBMIT=1 is set.
//
// What this verifies:
//   - All 5 step submits (3 register-form + travel + mode-transport) accept
//     our payload (responseCode "00").
//   - Master-dropdown lookups resolve UUIDs/IATA codes correctly.
//   - The signature flow works for every step.
//
// What this does NOT do:
//   - Actually finalize the arrival card. The default skips step 4.
import { submitIndonesiaDirect } from "../src/adapters/indonesia";
import type { ArrivalPassTraveler } from "../src/adapters/indonesia";

const burner: ArrivalPassTraveler = {
  fullName: "TEST RECON",
  dateOfBirth: "1990-01-15",
  sex: "M",
  nationalityIso3: "USA",
  countryOfBirthIso3: "USA",
  passportNumber: "X0000001",
  passportExpiry: "2030-12-31",
  email: "test+recon@example.invalid",
  mobileDialCode: "+1",
  mobileNumber: "5551234567",
  arrivalDate: "2026-06-01",
  departureDate: "2026-06-08",
  indonesia: {
    purposeTravel: "5", // HOLIDAY
    placeArrivalIata: "CGK",
    flightIata: "GA",
    flightNumber: "880",
    accommodationType: "HOTEL",
    hotelSearch: "hyatt",
  },
};

(async () => {
  const result = await submitIndonesiaDirect(burner, { liveSubmit: false });
  console.log("submissionId:", result.submissionId);
  console.log("status:", result.status);
  if (result.error) console.log("error:", result.error);
  console.log("steps:");
  for (const [name, s] of Object.entries(result.steps)) {
    const tag = s.ok ? "PASS" : "FAIL";
    console.log(`  ${tag}  ${name}  rc=${s.rc ?? "?"} ${s.desc ?? ""}`);
  }
  if (result.status !== "submitted" && result.status !== "blocked-pre-submit") process.exitCode = 1;
})().catch((e) => {
  console.error("crashed:", e);
  process.exit(1);
});
