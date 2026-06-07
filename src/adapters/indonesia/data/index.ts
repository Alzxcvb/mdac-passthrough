// Bundled snapshots of the master-dropdown lists captured 2026-05-04 against
// the live allindonesia.imigrasi.go.id API. Use these as a fast offline path
// (validation, autocomplete) and fall back to the live API for cascade /
// typeahead pickers (city-by-province, search-hotel).
//
// Run scripts/recon-indonesia-bulk.js to refresh.
import provinceData from "./province.json";
import countryData from "./country.json";
import cityData from "./city.json";
import purposeTravelData from "./purpose-travel.json";
import residenceTypeData from "./residence-type.json";
import genderData from "./gender.json";
import transportData from "./transport.json";
import airTransportData from "./air-transport.json";
import airFlightData from "./air-flight.json";
import seaVesselData from "./sea-vessel.json";
import placeAirData from "./place-transport-1.json";
import placeSeaData from "./place-transport-3.json";

import type {
  ProvinceRow, CountryRow, CityRow, PurposeRow, ResidenceRow, GenderRow,
  TransportRow, AirTransportRow, AirFlightRow, SeaVesselRow, PlaceTransportRow,
  ApiEnvelope, ApiList,
} from "../types";

const unwrap = <T,>(envelope: ApiEnvelope<ApiList<T> | T[]>): T[] => {
  const td = envelope.transactionDetail;
  if (Array.isArray(td)) return td;
  if (td && Array.isArray((td as ApiList<T>).data)) return (td as ApiList<T>).data;
  return [];
};

export const provinces: ProvinceRow[] = unwrap<ProvinceRow>(provinceData as ApiEnvelope<ApiList<ProvinceRow>>);
export const countries: CountryRow[] = unwrap<CountryRow>(countryData as ApiEnvelope<ApiList<CountryRow>>);
export const cities: CityRow[] = unwrap<CityRow>(cityData as ApiEnvelope<ApiList<CityRow>>);
export const purposes: PurposeRow[] = unwrap<PurposeRow>(purposeTravelData as ApiEnvelope<ApiList<PurposeRow>>);
export const residenceTypes: ResidenceRow[] = unwrap<ResidenceRow>(residenceTypeData as ApiEnvelope<ApiList<ResidenceRow>>);
export const genders: GenderRow[] = unwrap<GenderRow>(genderData as ApiEnvelope<ApiList<GenderRow>>);
export const transports: TransportRow[] = unwrap<TransportRow>(transportData as ApiEnvelope<ApiList<TransportRow>>);
export const airTransports: AirTransportRow[] = unwrap<AirTransportRow>(airTransportData as ApiEnvelope<ApiList<AirTransportRow>>);
export const airFlights: AirFlightRow[] = (airFlightData as ApiEnvelope<AirFlightRow[]>).transactionDetail ?? [];
export const seaVessels: SeaVesselRow[] = unwrap<SeaVesselRow>(seaVesselData as ApiEnvelope<ApiList<SeaVesselRow>>);
export const airports: PlaceTransportRow[] = unwrap<PlaceTransportRow>(placeAirData as ApiEnvelope<ApiList<PlaceTransportRow>>);
export const seaports: PlaceTransportRow[] = unwrap<PlaceTransportRow>(placeSeaData as ApiEnvelope<ApiList<PlaceTransportRow>>);

// ---- Lookups ----

/** Country by ISO-3 code (e.g. "USA", "IDN"). */
export const countryByIso3 = (iso3: string): CountryRow | undefined =>
  countries.find((c) => c.code === iso3.toUpperCase());

/** Country by exact name (UPPERCASE — matches government list). */
export const countryByName = (name: string): CountryRow | undefined =>
  countries.find((c) => c.name === name.toUpperCase());

/** Airport by IATA prefix (e.g. "CGK"). Names are formatted "CGK - SOEKARNO-HATTA AIRPORT". */
export const airportByIata = (iata: string): PlaceTransportRow | undefined => {
  const prefix = `${iata.toUpperCase()} -`;
  return airports.find((a) => a.name.startsWith(prefix));
};

/** Airline by IATA code. */
export const airlineByIata = (iata: string): AirFlightRow | undefined =>
  airFlights.find((a) => a.iata === iata.toUpperCase());

/** Province by exact name. */
export const provinceByName = (name: string): ProvinceRow | undefined =>
  provinces.find((p) => p.name.toUpperCase() === name.toUpperCase());

export const purposeByCode = (code: string): PurposeRow | undefined =>
  purposes.find((p) => p.code === code);

export const purposeByName = (name: string): PurposeRow | undefined =>
  purposes.find((p) => p.name === name.toUpperCase());

export const residenceByCode = (code: "R" | "H" | "O"): ResidenceRow | undefined =>
  residenceTypes.find((r) => r.code === code);

export const airTransportByCode = (code: "CM" | "GV" | "CH"): AirTransportRow | undefined =>
  airTransports.find((a) => a.code === code);

export const transportByCode = (code: "A" | "S"): TransportRow | undefined =>
  transports.find((t) => t.code === code);
