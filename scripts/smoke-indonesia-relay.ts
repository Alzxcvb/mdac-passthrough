// Phase-1 smoke for the Indonesia session-relay. Drives the live form through
// the declaration step (fillIndonesiaToDeclaration) and confirms a review
// screenshot comes back. Does NOT submit (phase 2 is never called).
//
// Run: npx tsx scripts/smoke-indonesia-relay.ts
import fs from "fs";
import { indonesiaSessionManager } from "../src/services/indonesia-session-manager";
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
  arrivalDate: "2026-07-01",
  departureDate: "2026-07-08",
  indonesia: {
    purposeTravel: "HOLIDAY/SIGHTSEEING/LEISURE",
    placeArrivalIata: "CGK",
    flightNumber: "GA880",
    accommodationType: "HOTEL",
    hotelSearch: "hyatt",
  },
};

(async () => {
  const t0 = Date.now();
  try {
    const res = await indonesiaSessionManager.createSession(burner);
    const ms = Date.now() - t0;
    const ok = Boolean(res.reviewImageBase64 && res.reviewImageBase64.length > 1000);
    console.log(`sessionId: ${res.sessionId}`);
    console.log(`submissionId: ${res.submissionId}`);
    console.log(`reviewImage bytes(b64): ${res.reviewImageBase64?.length ?? 0}`);
    console.log(`elapsed: ${(ms / 1000).toFixed(1)}s`);
    if (res.reviewImageBase64) {
      fs.mkdirSync("/tmp/claude/id-relay", { recursive: true });
      fs.writeFileSync("/tmp/claude/id-relay/review.png", Buffer.from(res.reviewImageBase64, "base64"));
      console.log("saved /tmp/claude/id-relay/review.png");
    }
    await indonesiaSessionManager.destroySession(res.sessionId);
    console.log(ok ? "PASS — phase-1 fill produced a screenshot" : "FAIL — no usable screenshot");
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error(`FAIL — phase-1 threw after ${((Date.now() - t0) / 1000).toFixed(1)}s:`);
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
})();
