// Indonesia All-Indonesia (allindonesia.imigrasi.go.id) adapter — types.
// Built from recon at /tmp/claude/indonesia-recon/RECON.md (2026-05-05).

export type DeviceLang = "EN" | "ID";
export type AccountType = "WNA" | "WNI"; // foreign | Indonesian

export interface ApiEnvelope<T> {
  responseCode: string; // "00" success, "55" signature invalid, "I76" unauthorized
  responseTitle: string | null;
  responseDesc: string;
  transactionDetail: T | null;
}

export interface ApiList<T> {
  data: T[];
}

export interface CountryRow {
  id: string; // UUID
  name: string;
  phoneCode: string; // "+62"
  code: string; // ISO-3 e.g. "IDN"
}

export interface ProvinceRow {
  id: string; // UUID
  name: string;
}

export interface CityRow {
  id: string; // UUID
  name: string;
  province: string; // province UUID
  postalCode: string;
  immigrationOffice: string;
}

export interface PurposeRow { id: string; name: string; code: string; }
export interface ResidenceRow { id: string; name: string; code: "R" | "H" | "O"; }
export interface GenderRow { id: string; name: string; code: "M" | "F"; }
export interface TransportRow { id: string; name: "AIR" | "SEA" | "LAND"; code: "A" | "S" | "L"; }
export interface AirTransportRow { id: string; name: string; code: "CM" | "GV" | "CH"; }
export interface AirFlightRow { id: string; name: string; iata: string; }
export interface SeaVesselRow { id: string; name: string; }
export interface PlaceTransportRow { id: string; name: string; }

export interface HotelRow {
  id: string;
  name: string;
  city: string; // UUID
  province: string; // UUID
  postalCode: string;
  immigrationOffice: string;
}

// Captcha
export interface CaptchaResponse {
  token: string; // JWT containing { captchaCode, uuid, iat, exp }
  code: string; // base64 — server-side opaque blob, sent back unchanged
}

export interface CaptchaPayload {
  captchaCode: string;
  uuid: string;
  iat: number;
  exp: number;
}

// Pre-sign
export interface PreSignResponse {
  signature: string; // base64
  timestamp: string; // epoch ms as string
}

// Guest token JWT payload (from /api/authentication/guest-wna)
export interface GuestTokenPayload {
  idUser: string;
  arrivalType: AccountType;
  channelType: "WEB" | "MOBILE";
  iat: number;
  exp: number;
}

// ----- Form payload shapes (per step) -----

export interface CommonStepFields {
  deviceLang: DeviceLang;
  accountType: AccountType;
  groupId: string; // "" for individual flow
  submissionId: string; // client-generated, threaded through every step
}

// Step 1: split into 3 sub-calls per JS bundle (register-form/foreigner/{profile-data,documents,account}).
// Body shapes are best-guess until a fresh walk confirms. Treat as TODO.

export interface ProfileDataPayload extends CommonStepFields {
  fullName: string;
  dateOfBirth: string; // DD/MM/YYYY
  countryOrPlaceOfBirth: string; // country UUID
  gender: "M" | "F";
}

export interface DocumentsPayload extends CommonStepFields {
  nationality: string; // country UUID
  passportNo: string;
  dateOfPassportExpiry: string; // DD/MM/YYYY
}

export interface AccountPayload extends CommonStepFields {
  email: string;
  mobileNumber: string; // digits only
  mobileCode: string; // dial code (e.g. "+1") — likely sent as country UUID; confirm
}

// Step 2: travel details
export interface TravelDetailPayload extends CommonStepFields {
  arrivalDate: string; // DD/MM/YYYY
  departureDate: string; // DD/MM/YYYY
  hasVisaOrStayPermit: "Y" | "N";
  visaOrStayPermitNumber: string; // present when hasVisaOrStayPermit === "Y"
}

// Step 3: confirmed in live capture.
export interface ModeTransportAddressPayload extends CommonStepFields {
  modeTransport: string; // "1" AIR, "3" SEA
  purposeTravel: string; // id 1-12
  purposeTravelOthers: string; // when purposeTravel = OTHERS
  placeArrival: string; // place-transport id
  flightType: string; // air-transport id (CM/GV/CH)
  flightName: string; // air-flight id
  flightCode: string; // IATA prefix auto-filled from flightName
  flightNumber: string;
  vehicleType: string;
  vehicleNumber: string;
  vesselType: string;
  vesselName: string;
  residenceType: string; // residence-type id (1=R, 2=H, 3=O)
  immigrationOffice: string; // plain text from city/hotel pick
  postalCode: string;
  province: string; // UUID
  hotelCity: string; // UUID
  hotelName: string; // hotel id
  hotelAddress: string;
  hotelNameOthers: string;
  address: string;
  city: string; // UUID
  accomodation: string;
}

// Step 4: declaration. Final POST goes to `/api/declaration-captcha/submit`
// with body shape (confirmed via JS bundle decompile):
//   {
//     captchaCode: <answer typed or decoded from JWT>,
//     captchaToken: <JWT from /api/captcha/generate>,
//     ...declarationFormFields
//   }
// The CommonStepFields (deviceLang, accountType, groupId, submissionId)
// must also be present.
export interface DeclarationPayload extends CommonStepFields {
  // Health
  hasSymptoms: "Y" | "N";
  symptoms?: string[]; // disease ids when hasSymptoms === "Y"
  countriesVisited21Days: string[]; // country UUIDs
  // Quarantine
  bringingProhibitedItems: "Y" | "N";
  hasQuarantineCertificate?: "Y" | "N"; // nested when bringingProhibitedItems === "Y"
  // Customs
  totalBaggage: number;
  hasGoodsToDeclare: "Y" | "N";
  declaredGoods?: DeclaredGood[];
  hasImeiDevice: "Y" | "N";
  // Captcha — added for the captcha-protected variant (`declaration-captcha/submit`).
  captchaToken: string; // JWT from /api/captcha/generate
  captchaCode: string; // = JWT.payload.captchaCode (or user-typed)
  // Final agreement
  agreed: true;
}

export interface DeclaredGood {
  category: string; // commodity-category id
  type: string; // commodity-type id
  form: string; // commodity-form id
  quantity: string; // commodity-quantity id
  description?: string;
}

// ----- Adapter-facing unified traveler shape (cross-country) -----
// Used by both Malaysia (MDAC) and Indonesia (All-Indonesia) flows.
// Designed so the same UI payload maps to both adapters. Country-specific
// fields go into per-country sub-objects.

export interface ArrivalPassTraveler {
  // Identity
  fullName: string;
  dateOfBirth: string; // ISO YYYY-MM-DD
  sex: "M" | "F";
  nationalityIso3: string; // e.g. "USA"
  countryOfBirthIso3: string;
  passportNumber: string;
  passportExpiry: string; // ISO YYYY-MM-DD
  // Contact
  email: string;
  mobileDialCode: string; // "+1"
  mobileNumber: string;
  // Travel
  arrivalDate: string; // ISO YYYY-MM-DD
  departureDate: string; // ISO YYYY-MM-DD
  // Indonesia-specific overrides (optional — adapter falls back to defaults)
  indonesia?: {
    purposeTravel?: PurposeRow["code"]; // pick by code
    placeArrivalIata?: string; // e.g. "CGK" — adapter will resolve to id
    flightIata?: string; // airline IATA, e.g. "GA"
    flightNumber?: string;
    accommodationType?: "RESIDENTIAL" | "HOTEL" | "OTHERS";
    hotelSearch?: string; // free-text hotel-name search
    residentialAddress?: string;
    residentialProvinceName?: string;
    residentialCityName?: string;
    visaOrStayPermitNumber?: string;
  };
}
