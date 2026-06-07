// Frontend mapping for the Indonesia (All-Indonesia) arrival card.
//
// Mirrors mdac-codes.ts/mapFormToMdac but targets the backend adapter's
// ArrivalPassTraveler shape. The backend can't be imported from the web app,
// so the traveler type is duplicated here (kept in sync with
// src/adapters/indonesia/types.ts:ArrivalPassTraveler).
//
// IMPORTANT: dates pass through as ISO YYYY-MM-DD UNCHANGED — the adapter does
// its own DD/MM/YYYY conversion. Do NOT pre-convert like mapFormToMdac does.

import { type FormData } from "@/lib/types";
import { COUNTRY_TO_ISO3 } from "@/lib/mdac-codes";

export interface IndonesiaTraveler {
  fullName: string;
  dateOfBirth: string; // ISO YYYY-MM-DD
  sex: "M" | "F";
  nationalityIso3: string;
  countryOfBirthIso3: string;
  passportNumber: string;
  passportExpiry: string; // ISO YYYY-MM-DD
  email: string;
  mobileDialCode: string; // "+1"
  mobileNumber: string;
  arrivalDate: string; // ISO YYYY-MM-DD
  departureDate: string; // ISO YYYY-MM-DD
  indonesia?: {
    purposeTravel?: string;
    placeArrivalIata?: string;
    flightNumber?: string;
    accommodationType?: "RESIDENTIAL" | "HOTEL" | "OTHERS";
    hotelSearch?: string;
    residentialAddress?: string;
    residentialProvinceName?: string;
    residentialCityName?: string;
    visaOrStayPermitNumber?: string;
  };
}

// Purpose-of-travel options — names exactly as the government list renders them
// (the bundled purpose codes are empty, so the adapter picks by name).
export const ID_PURPOSE_OPTIONS = [
  "HOLIDAY/SIGHTSEEING/LEISURE",
  "BUSINESS/MEETING/CONFERENCE/CONVENTION/EXHIBITION",
  "VISITING FRIENDS/RELATIVES",
  "EDUCATION/TRAINING",
  "EMPLOYMENT",
  "MEDICAL CARE",
  "RELIGION",
  "SPORT EVENT",
  "OFFICIAL/GOVERNMENT VISIT",
  "1-DAY TRANSIT",
  "CREW",
  "OTHERS",
] as const;

// Common arrival airports (IATA + name). Free text is allowed too — the backend
// resolves any valid IATA via its bundled airport list.
export const ID_AIRPORTS = [
  { iata: "CGK", name: "Jakarta — Soekarno-Hatta (CGK)" },
  { iata: "DPS", name: "Bali — Ngurah Rai (DPS)" },
  { iata: "SUB", name: "Surabaya — Juanda (SUB)" },
  { iata: "KNO", name: "Medan — Kualanamu (KNO)" },
  { iata: "JOG", name: "Yogyakarta — YIA (JOG)" },
  { iata: "UPG", name: "Makassar — Sultan Hasanuddin (UPG)" },
  { iata: "BPN", name: "Balikpapan — Sepinggan (BPN)" },
  { iata: "SRG", name: "Semarang — Ahmad Yani (SRG)" },
  { iata: "SOC", name: "Solo — Adi Soemarmo (SOC)" },
  { iata: "BWX", name: "Banyuwangi (BWX)" },
] as const;

const ACCOMMODATION_MAP: Record<string, "RESIDENTIAL" | "HOTEL" | "OTHERS"> = {
  Hotel: "HOTEL",
  Residential: "RESIDENTIAL",
  Others: "OTHERS",
};

/** Map the shared FormData to the Indonesia adapter's traveler shape. */
export function mapFormToIndonesia(data: FormData): IndonesiaTraveler {
  const nationalityIso3 = COUNTRY_TO_ISO3[data.nationality] || "USA";
  const countryOfBirthIso3 = COUNTRY_TO_ISO3[data.placeOfBirth] || nationalityIso3;

  return {
    fullName: data.fullName,
    dateOfBirth: data.dateOfBirth,
    sex: data.sex === "Female" ? "F" : "M",
    nationalityIso3,
    countryOfBirthIso3,
    passportNumber: data.passportNumber,
    passportExpiry: data.passportExpiry,
    email: data.email,
    mobileDialCode: data.phoneCountryCode,
    mobileNumber: data.phoneNumber,
    arrivalDate: data.arrivalDate,
    departureDate: data.departureDate,
    indonesia: {
      purposeTravel: data.purposeOfTravel || "HOLIDAY/SIGHTSEEING/LEISURE",
      placeArrivalIata: data.arrivalAirport || "CGK",
      flightNumber: data.flightNumber,
      accommodationType: ACCOMMODATION_MAP[data.accommodationType] || "HOTEL",
      hotelSearch: data.hotelName,
      residentialAddress: data.addressInIndonesia,
      residentialProvinceName: data.indonesiaProvince,
      residentialCityName: data.indonesiaCity,
      visaOrStayPermitNumber: data.visaPermitNumber,
    },
  };
}
