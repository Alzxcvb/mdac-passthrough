// Indonesia adapter — public surface.
//
// Two paths to submit:
//   - submitIndonesiaViaPlaywright(traveler, opts) — drives a Chromium against
//     the live form. Proven, reuses the same patterns as MDAC. Used in MVP.
//   - signedPost (on AllIndonesiaClient) — direct REST submission, blocked
//     until x-signature binding is reverse-engineered (see RECON.md). Once
//     reverse-engineered, this becomes the no-Playwright fast path.
//
// Anonymous master-dropdown calls + the captcha bypass already work without
// any auth — useful for live UI dropdowns even before submit is wired.
export { AllIndonesiaClient } from "./client";
export { generateCaptcha, decodeJwtPayload } from "./captcha";
export { generateSubmissionId } from "./submission-id";
export {
  submitIndonesia as submitIndonesiaViaPlaywright,
  fillIndonesiaToDeclaration,
  submitIndonesiaDeclaration,
} from "./playwright-flow";
export { submitIndonesiaDirect } from "./submit";
export type * from "./types";
export * as indonesiaData from "./data";
