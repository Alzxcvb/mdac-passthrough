/**
 * Mapping tables between our human-readable form values and the
 * official MDAC system's internal codes.
 *
 * Official form: https://imigresen-online.imi.gov.my/mdac/main?registerMain
 * Tech: Java/Stripes server, jQuery + Bootstrap 3, standard HTML POST
 *
 * Country list sourced from the official MDAC site (275 entries, ISO 3166-1 alpha-3).
 * The official site uses the same dropdown for both Nationality and Country fields.
 */

import { type FormData } from "./types";

// ---- Complete country name → ISO 3166-1 alpha-3 ----
// Matches the official MDAC site's 275-country dropdown exactly.

export const COUNTRY_TO_ISO3: Record<string, string> = {
  Afghanistan: "AFG",
  Albania: "ALB",
  Algeria: "DZA",
  "American Samoa": "ASM",
  Andorra: "AND",
  Angola: "AGO",
  Anguilla: "AIA",
  Antarctica: "ATA",
  "Antigua and Barbuda": "ATG",
  Argentina: "ARG",
  Armenia: "ARM",
  Aruba: "ABW",
  Australia: "AUS",
  Austria: "AUT",
  Azerbaijan: "AZE",
  Bahamas: "BHS",
  Bahrain: "BHR",
  Bangladesh: "BGD",
  Barbados: "BRB",
  Belarus: "BLR",
  Belgium: "BEL",
  Belize: "BLZ",
  Benin: "BEN",
  Bermuda: "BMU",
  Bhutan: "BTN",
  Bolivia: "BOL",
  "Bosnia and Herzegovina": "BIH",
  Botswana: "BWA",
  "Bouvet Island": "BVT",
  Brazil: "BRA",
  "British Indian Ocean Territory": "IOT",
  "British National (Overseas)": "GBN",
  "British Overseas Citizen": "GBO",
  "British Protected Person": "GBP",
  "British Subject": "GBS",
  "British Dependent Territories Citizen": "GBD",
  Brunei: "BRN",
  Bulgaria: "BGR",
  "Burkina Faso": "BFA",
  Burundi: "BDI",
  Cambodia: "KHM",
  Cameroon: "CMR",
  Canada: "CAN",
  "Cape Verde": "CPV",
  "Cayman Islands": "CYM",
  "Central African Republic": "CAF",
  Chad: "TCD",
  Chile: "CHL",
  China: "CHN",
  "Christmas Island": "CXR",
  "Cocos (Keeling) Islands": "CCK",
  Colombia: "COL",
  Comoros: "COM",
  "Cook Islands": "COK",
  "Costa Rica": "CRI",
  "Côte d'Ivoire": "CIV",
  Croatia: "HRV",
  Cuba: "CUB",
  Cyprus: "CYP",
  "Czech Republic": "CZE",
  Denmark: "DNK",
  Djibouti: "DJI",
  Dominica: "DMA",
  "Dominican Republic": "DOM",
  "DR Congo": "COD",
  "East Timor": "TMP",
  Ecuador: "ECU",
  Egypt: "EGY",
  "El Salvador": "SLV",
  "Equatorial Guinea": "GNQ",
  Eritrea: "ERI",
  Estonia: "EST",
  Eswatini: "SWZ",
  Ethiopia: "ETH",
  "European Union (Special)": "EUE",
  "Falkland Islands": "FLK",
  "Faroe Islands": "FRO",
  Fiji: "FJI",
  Finland: "FIN",
  France: "FRA",
  "France (Metropolitan)": "FXX",
  "French Guiana": "GUF",
  "French Polynesia": "PYF",
  "French Southern Territories": "ATF",
  Gabon: "GAB",
  Gambia: "GMB",
  Georgia: "GEO",
  Germany: "DEU",
  "Germany (Historical DR)": "DGR",
  Ghana: "GHA",
  Gibraltar: "GIB",
  Greece: "GRC",
  Greenland: "GRL",
  Grenada: "GRD",
  Guadeloupe: "GLP",
  Guam: "GUM",
  Guatemala: "GTM",
  Guinea: "GIN",
  "Guinea-Bissau": "GNB",
  Guyana: "GUY",
  Haiti: "HTI",
  "Heard Island and McDonald Islands": "HMD",
  Honduras: "HND",
  "Hong Kong": "HKG",
  Hungary: "HUN",
  Iceland: "ISL",
  India: "IND",
  Indonesia: "IDN",
  Iran: "IRN",
  Iraq: "IRQ",
  Ireland: "IRL",
  Israel: "ISR",
  Italy: "ITA",
  Jamaica: "JAM",
  Japan: "JPN",
  Jordan: "JOR",
  Kazakhstan: "KAZ",
  Kenya: "KEN",
  Kiribati: "KIR",
  Kosovo: "KOS",
  "Kosovo (Republic)": "RKS",
  Kuwait: "KWT",
  Kyrgyzstan: "KGZ",
  Laos: "LAO",
  Latvia: "LVA",
  Lebanon: "LBN",
  Lesotho: "LSO",
  Liberia: "LBR",
  Libya: "LBY",
  Liechtenstein: "LIE",
  Lithuania: "LTU",
  Luxembourg: "LUX",
  Macau: "MAC",
  Madagascar: "MDG",
  Malawi: "MWI",
  Malaysia: "MYS",
  Maldives: "MDV",
  Mali: "MLI",
  Malta: "MLT",
  "Marshall Islands": "MHL",
  Martinique: "MTQ",
  Mauritania: "MRT",
  Mauritius: "MUS",
  Mayotte: "MYT",
  Mexico: "MEX",
  Micronesia: "FSM",
  Moldova: "MDA",
  Monaco: "MCO",
  Mongolia: "MNG",
  Montenegro: "MNE",
  Montserrat: "MSR",
  Morocco: "MAR",
  Mozambique: "MOZ",
  Myanmar: "MMR",
  Namibia: "NAM",
  "Nansen Passport": "NNS",
  Nauru: "NRU",
  Nepal: "NPL",
  Netherlands: "NLD",
  "Netherlands Antilles": "ANT",
  "Neutral Zone": "NTZ",
  "New Caledonia": "NCL",
  "New Zealand": "NZL",
  Nicaragua: "NIC",
  Niger: "NER",
  Nigeria: "NGA",
  Niue: "NIU",
  "Norfolk Island": "NFK",
  "North Korea": "PRK",
  "North Korea (DPRK)": "DPR",
  "North Macedonia": "MKD",
  "North Macedonia (Former FYR)": "FYR",
  "Northern Mariana Islands": "MNP",
  Norway: "NOR",
  Oman: "OMN",
  Pakistan: "PAK",
  Palau: "PLW",
  Palestine: "PSE",
  "Palestinian Authority": "PAL",
  Panama: "PAN",
  "Papua New Guinea": "PNG",
  Paraguay: "PRY",
  Peru: "PER",
  Philippines: "PHL",
  "Pitcairn Islands": "PCN",
  Poland: "POL",
  Portugal: "PRT",
  "Puerto Rico": "PRI",
  Qatar: "QAT",
  "Refugee (Convention)": "XXB",
  "Refugee (Non-Convention)": "XXC",
  "Republic of the Congo": "COG",
  Réunion: "REU",
  Romania: "ROU",
  "Romania (Historical)": "ROM",
  Russia: "RUS",
  Rwanda: "RWA",
  "Saint Helena": "SHN",
  "Saint Kitts and Nevis": "KNA",
  "Saint Lucia": "LCA",
  "Saint Pierre and Miquelon": "SPM",
  "Saint Vincent and the Grenadines": "VCT",
  Samoa: "WSM",
  "San Marino": "SMR",
  "São Tomé and Príncipe": "STP",
  "Saudi Arabia": "SAU",
  Senegal: "SEN",
  Serbia: "SRB",
  "Serbia (Alt)": "SER",
  "Serbia and Montenegro": "SCG",
  Seychelles: "SYC",
  "Sierra Leone": "SLE",
  Singapore: "SGP",
  Slovakia: "SVK",
  Slovenia: "SVN",
  "Solomon Islands": "SLB",
  Somalia: "SOM",
  "South Africa": "ZAF",
  "South Georgia and South Sandwich Islands": "SGS",
  "South Korea": "KOR",
  "South Sudan": "SSD",
  Spain: "ESP",
  "Sri Lanka": "LKA",
  "Stateless": "XXA",
  "Stateless (Other)": "ZZA",
  Sudan: "SDN",
  Suriname: "SUR",
  "Svalbard and Jan Mayen": "SJM",
  Sweden: "SWE",
  Switzerland: "CHE",
  Syria: "SYR",
  Taiwan: "TWN",
  Tajikistan: "TJK",
  Tanzania: "TZA",
  Thailand: "THA",
  "Timor-Leste": "TLS",
  Togo: "TGO",
  Tokelau: "TKL",
  Tonga: "TON",
  "Trinidad and Tobago": "TTO",
  Tunisia: "TUN",
  "Türkiye (Turkey)": "TUR",
  Turkmenistan: "TKM",
  "Turks and Caicos Islands": "TCA",
  Tuvalu: "TUV",
  Uganda: "UGA",
  Ukraine: "UKR",
  "United Arab Emirates": "ARE",
  "United Kingdom": "GBR",
  "United Nations Agency": "UNA",
  "United Nations (UNHCR)": "UNH",
  "United Nations Organization": "UNO",
  "United States": "USA",
  "United States Minor Outlying Islands": "UMI",
  "Unspecified Nationality": "XXX",
  "Unknown Nationality": "ZZZ",
  Uruguay: "URY",
  Uzbekistan: "UZB",
  Vanuatu: "VUT",
  "Vatican City": "VAT",
  Venezuela: "VEN",
  Vietnam: "VNM",
  "British Virgin Islands": "VGB",
  "U.S. Virgin Islands": "VIR",
  "Wallis and Futuna": "WLF",
  "Western Sahara": "ESH",
  Yemen: "YEM",
  Yugoslavia: "YUG",
  Zambia: "ZMB",
  Zimbabwe: "ZWE",
  "Zimbabwe (Alt)": "ZIM",
  "DR Congo (Historical)": "ZAR",
  "Indonesian Stateless": "ZZB",
  "Not Applicable": "ZZD",
};

// Nationality uses the same country list as the official MDAC site
export const NATIONALITY_TO_ISO3 = COUNTRY_TO_ISO3;

// Sortable country list for dropdowns
export const COUNTRIES = Object.keys(COUNTRY_TO_ISO3).sort();

// Alias for nationality dropdown (same list)
export const NATIONALITIES = COUNTRIES;

const ISO3_TO_COUNTRY = Object.fromEntries(
  Object.entries(COUNTRY_TO_ISO3).map(([country, iso3]) => [iso3, country])
) as Record<string, string>;

export function resolveCountryName(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  if (COUNTRY_TO_ISO3[normalized]) return normalized;

  const iso3 = normalized.toUpperCase();
  if (ISO3_TO_COUNTRY[iso3]) return ISO3_TO_COUNTRY[iso3];

  const looseMatch = COUNTRIES.find((country) => country.toLowerCase() === normalized.toLowerCase());
  return looseMatch ?? normalized;
}

// ---- Malaysian state → official code ----

export const STATE_TO_CODE: Record<string, string> = {
  Johor: "01",
  Kedah: "02",
  Kelantan: "03",
  "Kuala Lumpur": "04",
  Labuan: "05",
  Melaka: "06",
  "Negeri Sembilan": "07",
  Pahang: "08",
  Penang: "09",
  Perak: "10",
  Perlis: "11",
  Putrajaya: "12",
  Sabah: "13",
  Sarawak: "14",
  Selangor: "15",
  Terengganu: "16",
};

// ---- Simple code maps ----

export const TRANSPORT_TO_CODE: Record<string, string> = {
  Air: "1",
  Land: "2",
  Sea: "3",
};

export const SEX_TO_CODE: Record<string, string> = {
  Male: "1",
  Female: "2",
};

// ---- Date format conversion ----

/** Convert YYYY-MM-DD → DD/MM/YYYY (official MDAC format) */
export function toMdacDate(isoDate: string): string {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

// ---- Phone code conversion ----

/** Strip "+" prefix: "+60" → "60" */
export function phoneCodeToRegion(code: string): string {
  return code.replace(/^\+/, "");
}

// ---- Main mapping function ----

export interface MdacPayload {
  name: string;
  passNo: string;
  dob: string;
  nationality: string;
  pob: string;
  sex: string;
  passExpDte: string;
  email: string;
  confirmEmail: string;
  region: string;
  mobile: string;
  arrDt: string;
  depDt: string;
  vesselNm: string;
  trvlMode: string;
  embark: string;
  accommodationStay: string;
  accommodationAddress1: string;
  accommodationAddress2: string;
  accommodationState: string;
  accommodationCity: string;
  accommodationPostcode: string;
  // Hidden mirror fields
  sNation: string;
  sRegion: string;
  sState: string;
  sCity: string;
  sStay: string;
  sMode: string;
  sEmbark: string;
  mdacVisaCountry: string;
}

/**
 * Transform our FormData into the official MDAC field names + codes.
 * cityCode must be resolved separately via AJAX.
 */
export function mapFormToMdac(data: FormData, cityCode: string): MdacPayload {
  const natCode = NATIONALITY_TO_ISO3[data.nationality] || "";
  const stateCode = STATE_TO_CODE[data.stateInMalaysia] || "";
  const transportCode = TRANSPORT_TO_CODE[data.modeOfTransport] || "";
  const embarkCode = COUNTRY_TO_ISO3[data.departureCountry] || "";
  const regionNum = phoneCodeToRegion(data.phoneCountryCode);

  return {
    name: data.fullName.toUpperCase().slice(0, 60),
    passNo: data.passportNumber.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12),
    dob: toMdacDate(data.dateOfBirth),
    nationality: natCode,
    pob: COUNTRY_TO_ISO3[data.placeOfBirth] || natCode, // fallback to nationality country
    sex: SEX_TO_CODE[data.sex] || "",
    passExpDte: toMdacDate(data.passportExpiry),
    email: data.email,
    confirmEmail: data.email,
    region: regionNum,
    mobile: data.phoneNumber.replace(/\D/g, "").slice(0, 12),
    arrDt: toMdacDate(data.arrivalDate),
    depDt: toMdacDate(data.departureDate),
    vesselNm: data.flightNumber.slice(0, 30),
    trvlMode: transportCode,
    embark: embarkCode,
    accommodationStay: "01", // default: Hotel
    accommodationAddress1: data.hotelName.slice(0, 100),
    accommodationAddress2: data.addressInMalaysia.slice(0, 100),
    accommodationState: stateCode,
    accommodationCity: cityCode,
    accommodationPostcode: data.postalCode.replace(/\D/g, "").slice(0, 5),
    // Mirror/display fields
    sNation: data.nationality,
    sRegion: regionNum,
    sState: data.stateInMalaysia,
    sCity: data.cityInMalaysia,
    sStay: "Hotel",
    sMode: data.modeOfTransport,
    sEmbark: data.departureCountry,
    mdacVisaCountry: "",
  };
}
