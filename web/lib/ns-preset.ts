import { FormData, EMPTY_FORM } from "./types";
import { loadProfile, mergeProfileIntoForm } from "./storage";

/**
 * Network School preset — everyone stays at Forest City Marina Hotel and
 * re-enters Malaysia by land after Singapore day trips, so every trip field
 * except the dates is known in advance.
 *
 * cityInMalaysia stays a display name ("Gelang Patah") on purpose:
 * SubmitStep resolves the live MDAC city code by name match, which survives
 * gov-side code reshuffles that a hardcoded "0113" would not.
 */
export const NS_TRIP_PRESET: Pick<
  FormData,
  | "country"
  | "hotelName"
  | "addressInMalaysia"
  | "stateInMalaysia"
  | "cityInMalaysia"
  | "postalCode"
  | "modeOfTransport"
  | "departureCountry"
  | "flightNumber"
> = {
  country: "Malaysia",
  hotelName: "Forest City Marina Hotel",
  addressInMalaysia: "Jalan Forest City 1, Pulau Satu",
  stateInMalaysia: "Johor",
  cityInMalaysia: "Gelang Patah",
  postalCode: "81550",
  modeOfTransport: "Land",
  departureCountry: "Singapore",
  flightNumber: "BUS",
};

/**
 * YYYY-MM-DD built from LOCAL date parts. Never use toISOString() here:
 * NS users are in UTC+8, so before 8am toISOString() yields yesterday and
 * MDAC rejects arrival dates in the past.
 */
export function localISODate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Fresh NS form: saved profile (if any) + trip preset + today's dates. */
export function buildNsForm(): FormData {
  const base = mergeProfileIntoForm({ ...EMPTY_FORM }, loadProfile() ?? {});
  return {
    ...base,
    ...NS_TRIP_PRESET,
    arrivalDate: localISODate(0),
    departureDate: localISODate(30),
    saveProfile: true,
  };
}

/**
 * Everything the backend requires plus everything mapFormToMdac needs to
 * produce a valid payload. Returns human-readable labels of missing fields.
 */
export function validateNsForm(data: FormData): string[] {
  const missing: string[] = [];
  const need = (value: string, label: string) => {
    if (!value || !value.trim()) missing.push(label);
  };
  need(data.fullName, "Full name");
  need(data.passportNumber, "Passport number");
  need(data.nationality, "Nationality");
  need(data.dateOfBirth, "Date of birth");
  need(data.sex, "Sex");
  need(data.passportExpiry, "Passport expiry date");
  need(data.email, "Email");
  need(data.phoneCountryCode, "Phone country code");
  need(data.phoneNumber, "Phone number");
  need(data.arrivalDate, "Arrival date");
  need(data.departureDate, "Departure date");
  need(data.departureCountry, "Country you're arriving from");
  need(data.stateInMalaysia, "State in Malaysia");
  return missing;
}
