// HTTP client for the All-Indonesia API. Endpoints split into:
//   - master-dropdown: anonymous, open-CORS, no auth needed
//   - cascade lookups: anonymous, body-keyed
//   - submit / inquiry: requires guest token + signed pre-sign
//
// Submit pattern (verified live 2026-05-05):
//   1. GET /api/authentication/guest-wna → 24h JWT
//   2. POST /api/pre-sign with x-token + x-path: <submitPath> + body → returns
//      {signature, timestamp} at top level
//   3. POST <submitPath> with x-token + x-signature + x-timestamp + body
// Signature binds to (token, path, body byte-exact, timestamp). Earlier 401s
// were caused by under-sized bodies (server validates schema before signature
// errors are returned). Use full-shaped payloads.
import type {
  ApiEnvelope, ApiList,
  CountryRow, ProvinceRow, CityRow, PurposeRow, ResidenceRow, GenderRow,
  TransportRow, AirTransportRow, AirFlightRow, SeaVesselRow, PlaceTransportRow,
  HotelRow, PreSignResponse, GuestTokenPayload,
} from "./types";
import { decodeJwtPayload } from "./captcha";

const API_BASE = "https://allindonesia.imigrasi.go.id";

interface ClientOpts {
  apiBase?: string;
  fetchImpl?: typeof fetch;
  /** Full UA string used by the live browser. Some endpoints may bind to it. */
  userAgent?: string;
}

export class AllIndonesiaClient {
  private apiBase: string;
  private fetchImpl: typeof fetch;
  private guestToken: string | null = null;
  private guestTokenExp = 0;
  private userAgent: string;

  constructor(opts: ClientOpts = {}) {
    this.apiBase = opts.apiBase ?? API_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.userAgent = opts.userAgent ??
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
  }

  // ---- Anonymous master-dropdown calls ----

  async masterDropdown<T>(name: string, body: Record<string, unknown> = {}): Promise<T[]> {
    const env = await this.post<ApiEnvelope<ApiList<T> | T[]>>(
      `${this.apiBase}/api/master-dropdown/${name}`,
      { deviceLang: "EN", ...body },
    );
    if (env.responseCode !== "00") {
      throw new Error(`master-dropdown/${name} rc=${env.responseCode} ${env.responseDesc}`);
    }
    const td = env.transactionDetail;
    if (Array.isArray(td)) return td;
    if (td && Array.isArray((td as ApiList<T>).data)) return (td as ApiList<T>).data;
    return [];
  }

  countries() { return this.masterDropdown<CountryRow>("country"); }
  provinces() { return this.masterDropdown<ProvinceRow>("province"); }
  citiesAll() { return this.masterDropdown<CityRow>("city"); }
  citiesByProvince(provinceId: string) {
    return this.masterDropdown<CityRow>("city-by-province", { provinceId });
  }
  purposes() { return this.masterDropdown<PurposeRow>("purpose-travel"); }
  residenceTypes() { return this.masterDropdown<ResidenceRow>("residence-type"); }
  genders() { return this.masterDropdown<GenderRow>("gender"); }
  transports() { return this.masterDropdown<TransportRow>("transport"); }
  airTransports() { return this.masterDropdown<AirTransportRow>("air-transport"); }
  /** All airlines without filtering. */
  airFlights() { return this.masterDropdown<AirFlightRow>("air-flight"); }
  /** Airlines filtered by air-transport code (CM=commercial, GV=govt, CH=charter). */
  airFlightsByCode(code: "CM" | "GV" | "CH") {
    return this.masterDropdown<AirFlightRow>("air-flight-v2", { code });
  }
  seaVessels() { return this.masterDropdown<SeaVesselRow>("sea-vessel"); }
  /** transportId=1 → airports (37); transportId=3 → seaports (147). */
  placesByTransport(transportId: "1" | "3") {
    return this.masterDropdown<PlaceTransportRow>("place-transport", { transportId });
  }
  searchHotel(hotelName: string) {
    return this.masterDropdown<HotelRow>("search-hotel", { hotelName });
  }

  // ---- Auth: guest token ----

  /** GET /api/authentication/guest-wna — 24-hour anonymous session token. */
  async ensureGuestToken(): Promise<string> {
    const now = Date.now();
    if (this.guestToken && now < this.guestTokenExp - 60_000) return this.guestToken;
    const env = await this.post<ApiEnvelope<{ token: string }>>(
      `${this.apiBase}/api/authentication/guest-wna`,
      { deviceLang: "EN" },
    );
    if (env.responseCode !== "00" || !env.transactionDetail?.token) {
      throw new Error(`guest-wna rc=${env.responseCode} ${env.responseDesc}`);
    }
    this.guestToken = env.transactionDetail.token;
    const payload = decodeJwtPayload<GuestTokenPayload>(this.guestToken);
    this.guestTokenExp = payload.exp * 1000;
    return this.guestToken;
  }

  // ---- Pre-sign + submit ----

  /**
   * POST /api/pre-sign — returns the HMAC signature for the next submit.
   * Caller passes the path and body that will be POSTed next; pre-sign binds to them.
   */
  async preSign(targetPath: string, body: Record<string, unknown>): Promise<PreSignResponse> {
    const token = await this.ensureGuestToken();
    const res = await this.fetchImpl(`${this.apiBase}/api/pre-sign`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "application/json",
        "origin": this.apiBase,
        "user-agent": this.userAgent,
        "x-token": token,
        "x-path": targetPath,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`pre-sign ${res.status}`);
    const json = (await res.json()) as PreSignResponse;
    if (!json.signature || !json.timestamp) throw new Error(`pre-sign returned malformed body`);
    return json;
  }

  /**
   * pre-sign + signed POST in one shot. Returns the parsed response envelope.
   * Verified working live for /api/mode-transport-address/submit. Server
   * accepts the request only if the body is the full schema for the target
   * step (an under-sized body returns 401 "Signature tidak valid").
   */
  async signedPost<T = unknown>(submitPath: string, body: Record<string, unknown>): Promise<ApiEnvelope<T>> {
    const token = await this.ensureGuestToken();
    const sig = await this.preSign(submitPath, body);
    const res = await this.fetchImpl(`${this.apiBase}${submitPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "application/json",
        "origin": this.apiBase,
        "user-agent": this.userAgent,
        "x-token": token,
        "x-signature": sig.signature,
        "x-timestamp": sig.timestamp,
      },
      body: JSON.stringify(body),
    });
    return (await res.json()) as ApiEnvelope<T>;
  }

  // ---- Internal ----

  private async post<T>(url: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${url} ${res.status}`);
    return (await res.json()) as T;
  }
}
