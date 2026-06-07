/**
 * Field names match the official MDAC form at:
 * https://imigresen-online.imi.gov.my/mdac/main?registerMain
 *
 * The frontend's mapFormToMdac() produces this shape — the backend
 * fills the form using these exact field names via name="..." selectors.
 */
export interface MdacFormData {
  name: string;           // Full name (uppercased, max 60)
  passNo: string;         // Passport number (uppercased, alphanumeric, max 12)
  dob: string;            // DD/MM/YYYY
  nationality: string;    // ISO 3166-1 alpha-3
  pob: string;            // Place of birth — ISO 3166-1 alpha-3
  sex: string;            // "1" = Male, "2" = Female
  passExpDte: string;     // DD/MM/YYYY
  email: string;
  confirmEmail: string;
  region: string;         // Phone region code without "+" (e.g. "60")
  mobile: string;         // Phone number digits only
  arrDt: string;          // DD/MM/YYYY
  depDt: string;          // DD/MM/YYYY
  vesselNm: string;       // Flight/vessel number (max 30)
  trvlMode: string;       // "1" = Air, "2" = Land, "3" = Sea
  embark: string;         // Departure country — ISO 3166-1 alpha-3
  accommodationStay: string;     // "01" = Hotel
  accommodationAddress1: string; // Hotel name (max 100)
  accommodationAddress2: string; // Street address (max 100)
  accommodationState: string;    // Malaysian state code (e.g. "01" = Johor)
  accommodationCity: string;     // City code (resolved via AJAX on the real form)
  accommodationPostcode: string; // 5-digit postal code
  // Display/mirror fields the form uses
  sNation?: string;
  sRegion?: string;
  sState?: string;
  sCity?: string;        // Human-readable city name for matching
  sStay?: string;
  sMode?: string;
  sEmbark?: string;
  mdacVisaCountry?: string;
}

export interface SubmitResult {
  success: boolean;
  message?: string;
  error?: string;
  retryable?: boolean;
}

export interface RetrieveResult {
  success: boolean;
  qrImageBase64?: string;
  pdfBase64?: string;
  error?: string;
}

// ---- Session types ----

export interface SessionStartResponse {
  sessionId: string;
  captchaImageBase64: string;
  captchaWidth: number;
  captchaHeight: number;
}

export interface CaptchaSolveRequest {
  sessionId: string;
  sliderX: number;
}

export interface SessionStatus {
  status: "waiting_captcha" | "solving" | "submitted" | "error" | "expired";
  error?: string;
}

export interface CaptchaSolveResponse {
  success: boolean;
  message?: string;
  error?: string;
  retryable?: boolean;
  // If retryable and a new CAPTCHA was generated
  newCaptchaImageBase64?: string;
  newCaptchaWidth?: number;
  newCaptchaHeight?: number;
}

// ---- Indonesia session-relay types ----
//
// Indonesia's captcha is machine-solvable (JWT-decoded), so the human's
// contribution shifts from "solve captcha" (MDAC) to "review + authorize the
// final submit". The server fills steps 1-3 + the declaration, screenshots the
// summary, and waits for the user to authorize before clicking Submit.

export type IndonesiaSessionStatusValue =
  | "filling"        // server is driving steps 1-3 + declaration
  | "waiting_review" // filled; screenshot ready, awaiting user authorization
  | "submitting"     // user authorized; clicking final Submit
  | "submitted"      // QR available
  | "blocked"        // submit gated on the recon pass (INDONESIA_LIVE_SUBMIT)
  | "error"
  | "expired";

export interface IndonesiaSessionStartResponse {
  sessionId: string;
  submissionId: string;
  /** Full-page screenshot of the filled declaration page for user review. */
  reviewImageBase64: string;
}

export interface IndonesiaConfirmResponse {
  success: boolean;
  status: IndonesiaSessionStatusValue;
  /** Present when status === "submitted". */
  qrUrl?: string;
  /** Honest message when status === "blocked" (recon pass pending). */
  message?: string;
  error?: string;
}

export interface IndonesiaSessionStatus {
  status: IndonesiaSessionStatusValue;
  error?: string;
}
