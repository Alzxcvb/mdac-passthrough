/**
 * Frontend telemetry: capture every meaningful interaction in a session
 * and ship it to /api/telemetry on the Railway backend, keyed by a
 * client-generated sessionId.
 *
 * Design constraints:
 *  - PII-blind. Only field NAMES + lengths + presence booleans, never
 *    field values (no name, passport, dob, email, phone, address).
 *  - Fire-and-forget. Never blocks user interactions or page unload.
 *  - Survives unload via sendBeacon (preferred) → fetch keepalive fallback.
 *  - Batches every ~1.5s + flushes on visibility hidden / beforeunload.
 *  - Auto-instruments window.onerror, unhandledrejection, fetch wrapper.
 *  - Works even if storage is blocked (incognito) — sessionId regenerated
 *    per page-load if so, with a flag noting the lack of persistence.
 *
 * Public API:
 *   initTelemetry()             — call once at app boot (TelemetryProvider)
 *   getSessionId()              — current session id, generates if absent
 *   track(name, surface?, data?)— explicit event
 *   trackError(...)             — explicit error event (forces flush)
 *   linkJobId(jobId)            — call when an auto-submit job is created
 *
 * The session id is also exposed through window.__mdacSession for easy
 * pulling out of the browser devtools console during a live debugging call.
 */

const ENDPOINT = `${process.env.NEXT_PUBLIC_PASSTHROUGH_URL || ""}/api/telemetry`;
const STORAGE_KEY = "mdac_telemetry_session";
const FLUSH_INTERVAL_MS = 1500;
const MAX_BATCH = 40;
const MAX_BUFFER = 200;
const MAX_DATA_KEYS = 20;
const MAX_STRING_LEN = 500;

type AnyData = Record<string, unknown>;

interface TelemetryEvent {
  ts: number;
  name: string;
  surface?: string;
  data?: AnyData;
  isError?: boolean;
}

interface SessionContext {
  userAgent?: string;
  language?: string;
  languages?: string[];
  timezone?: string;
  timezoneOffsetMin?: number;
  platform?: string;
  vendor?: string;
  screenW?: number;
  screenH?: number;
  viewportW?: number;
  viewportH?: number;
  devicePixelRatio?: number;
  colorDepth?: number;
  online?: boolean;
  cookieEnabled?: boolean;
  doNotTrack?: string | null;
  connectionType?: string;
  connectionDownlink?: number;
  connectionEffectiveType?: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  referrer?: string;
  initialUrl?: string;
}

interface State {
  sessionId: string;
  /** True if we couldn't persist the session id across page-loads. */
  ephemeral: boolean;
  /** Set as soon as auto-submit returns a jobId. */
  jobId?: string;
  buffer: TelemetryEvent[];
  pendingContext?: SessionContext;
  ready: boolean;
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** Truthy once we've sent the start context. */
  startSent: boolean;
}

const state: State = {
  sessionId: "",
  ephemeral: false,
  buffer: [],
  ready: false,
  flushTimer: null,
  startSent: false,
};

declare global {
  interface Window {
    __mdacSession?: { id: string; ephemeral: boolean; jobId?: string };
  }
  interface Navigator {
    connection?: {
      type?: string;
      downlink?: number;
      effectiveType?: string;
    };
    deviceMemory?: number;
  }
}

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // fall through
    }
  }
  // RFC4122-ish v4 fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function loadSessionId(): { id: string; ephemeral: boolean } {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) return { id: stored, ephemeral: false };
    const fresh = uuid();
    sessionStorage.setItem(STORAGE_KEY, fresh);
    return { id: fresh, ephemeral: false };
  } catch {
    return { id: uuid(), ephemeral: true };
  }
}

function captureContext(): SessionContext {
  if (typeof window === "undefined") return {};
  const ctx: SessionContext = {};
  try {
    ctx.userAgent = navigator.userAgent;
    ctx.language = navigator.language;
    ctx.languages = Array.from(navigator.languages || []);
    ctx.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    ctx.timezoneOffsetMin = new Date().getTimezoneOffset();
    ctx.platform = navigator.platform;
    ctx.vendor = navigator.vendor;
    ctx.screenW = window.screen.width;
    ctx.screenH = window.screen.height;
    ctx.viewportW = window.innerWidth;
    ctx.viewportH = window.innerHeight;
    ctx.devicePixelRatio = window.devicePixelRatio;
    ctx.colorDepth = window.screen.colorDepth;
    ctx.online = navigator.onLine;
    ctx.cookieEnabled = navigator.cookieEnabled;
    ctx.doNotTrack = navigator.doNotTrack;
    ctx.hardwareConcurrency = navigator.hardwareConcurrency;
    ctx.deviceMemory = navigator.deviceMemory;
    if (navigator.connection) {
      ctx.connectionType = navigator.connection.type;
      ctx.connectionDownlink = navigator.connection.downlink;
      ctx.connectionEffectiveType = navigator.connection.effectiveType;
    }
    ctx.referrer = document.referrer || undefined;
    ctx.initialUrl = location.href;
  } catch {
    // Capturing context must never throw user-facing.
  }
  return ctx;
}

/** Trim a value so we never blow up the payload or accidentally exfiltrate huge content. */
function safeTrim(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > MAX_STRING_LEN ? value.slice(0, MAX_STRING_LEN) + `…(+${value.length - MAX_STRING_LEN})` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(safeTrim);
  }
  if (value && typeof value === "object") {
    const out: AnyData = {};
    let n = 0;
    for (const k of Object.keys(value as AnyData)) {
      if (n++ >= MAX_DATA_KEYS) break;
      out[k] = safeTrim((value as AnyData)[k]);
    }
    return out;
  }
  return value;
}

function pushEvent(name: string, surface?: string, data?: AnyData, isError?: boolean): void {
  if (!state.ready) return;
  if (state.buffer.length >= MAX_BUFFER) {
    // Drop oldest in the buffer — we'd rather keep the latest signal.
    state.buffer.shift();
  }
  const ev: TelemetryEvent = { ts: Date.now(), name };
  if (surface) ev.surface = surface;
  if (data) ev.data = safeTrim(data) as AnyData;
  if (isError) ev.isError = true;
  state.buffer.push(ev);
  if (isError) {
    flush(true);
  } else {
    scheduleFlush();
  }
}

function scheduleFlush(): void {
  if (state.flushTimer) return;
  state.flushTimer = setTimeout(() => {
    state.flushTimer = null;
    flush(false);
  }, FLUSH_INTERVAL_MS);
}

function flush(useBeacon: boolean): void {
  if (!state.sessionId) return;
  if (state.buffer.length === 0 && !state.pendingContext && !state.jobId) return;

  const events = state.buffer.splice(0, MAX_BATCH);
  const context = state.pendingContext;
  state.pendingContext = undefined;
  const jobId = state.jobId;

  const payload = {
    sessionId: state.sessionId,
    jobId,
    context,
    events,
  };

  let body: string;
  try {
    body = JSON.stringify(payload);
  } catch {
    return;
  }

  if (!ENDPOINT.endsWith("/api/telemetry")) {
    // No backend URL configured — drop silently. Don't spam the console.
    return;
  }

  const sendViaBeacon = useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function";
  if (sendViaBeacon) {
    try {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon(ENDPOINT, blob);
      if (ok) return;
    } catch {
      // fall through to fetch
    }
  }
  try {
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "omit",
      mode: "cors",
    }).catch(() => {
      // Network errors are silent — re-queueing would risk infinite loops
      // when the backend is genuinely down.
    });
  } catch {
    // ignore
  }

  // If we batched off less than what was buffered, schedule another flush.
  if (state.buffer.length > 0) scheduleFlush();
}

/**
 * Global event delegation: focus / blur on form fields anywhere in the app
 * so we know which fields the user touched and how full they were when they
 * left, WITHOUT updating every component. Same pattern for click — every
 * <button> click captured with a short tag. Field VALUES are never captured;
 * only field NAME + length + presence boolean.
 */
function instrumentDelegation(): void {
  if (typeof window === "undefined") return;

  const fieldTag = (el: Element): string | null => {
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLSelectElement)) {
      return null;
    }
    const name = el.getAttribute("name") || el.getAttribute("data-tel-field") || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.id || "";
    if (!name) return null;
    return name.slice(0, 60);
  };

  document.addEventListener("focusin", (ev) => {
    const t = ev.target as Element | null;
    if (!t) return;
    const name = fieldTag(t);
    if (!name) return;
    pushEvent("field_focus", "delegated", { field: name });
  }, true);

  document.addEventListener("focusout", (ev) => {
    const t = ev.target as Element | null;
    if (!t) return;
    const name = fieldTag(t);
    if (!name) return;
    const value = (t as HTMLInputElement).value || "";
    const length = value.length;
    pushEvent("field_blur", "delegated", {
      field: name,
      length,
      hasValue: length > 0,
    });
  }, true);

  document.addEventListener("click", (ev) => {
    const t = ev.target as Element | null;
    if (!t) return;
    // Closest button-or-anchor receives the credit.
    const btn = (t.closest && t.closest("button, a, [role='button']")) as Element | null;
    if (!btn) return;
    const tag = btn.tagName.toLowerCase();
    const dataTel = btn.getAttribute("data-tel");
    const text = (btn.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
    const aria = btn.getAttribute("aria-label") || undefined;
    const href = tag === "a" ? (btn as HTMLAnchorElement).getAttribute("href") || undefined : undefined;
    const id = btn.id || undefined;
    const cls = btn.className && typeof btn.className === "string" ? btn.className.slice(0, 80) : undefined;
    pushEvent("click", "delegated", {
      tag,
      label: dataTel || aria || text || undefined,
      href: href ? shortUrl(href) : undefined,
      id,
      classes: cls,
      disabled: btn.hasAttribute("disabled") || btn.getAttribute("aria-disabled") === "true",
    });
  }, true);

  document.addEventListener("submit", (ev) => {
    const t = ev.target as Element | null;
    pushEvent("form_submit", "delegated", {
      formId: (t && t.id) || undefined,
      formName: (t && (t as HTMLFormElement).name) || undefined,
    });
  }, true);
}

function instrumentErrors(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (ev) => {
    pushEvent(
      "js_error",
      "global",
      {
        message: ev.message,
        source: ev.filename,
        line: ev.lineno,
        col: ev.colno,
        stack: ev.error && ev.error.stack ? String(ev.error.stack).split("\n").slice(0, 5).join("\n") : undefined,
      },
      true
    );
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? String(reason.stack || "").split("\n").slice(0, 5).join("\n") : undefined;
    pushEvent("unhandled_rejection", "global", { message, stack }, true);
  });

  window.addEventListener("online", () => pushEvent("network_status", "global", { online: true }));
  window.addEventListener("offline", () => pushEvent("network_status", "global", { online: false }, true));

  document.addEventListener("visibilitychange", () => {
    pushEvent("visibility_change", "global", { state: document.visibilityState });
    if (document.visibilityState === "hidden") flush(true);
  });

  window.addEventListener("pagehide", () => {
    pushEvent("page_hide", "global");
    flush(true);
  });

  window.addEventListener("beforeunload", () => {
    pushEvent("before_unload", "global");
    flush(true);
  });

  // Orientation change on mobile.
  window.addEventListener("orientationchange", () => {
    pushEvent("orientation_change", "global", {
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
    });
  });
}

/**
 * Wrap window.fetch so EVERY API call is automatically logged with timing
 * and outcome. Same-origin Next.js routes (e.g. /api/mdac/cities) AND the
 * cross-origin Railway calls both surface here. We deliberately skip our
 * own /api/telemetry so we don't loop.
 */
function instrumentFetch(): void {
  if (typeof window === "undefined" || !window.fetch) return;
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : (input as Request).url;
    const method = (init?.method || (typeof input !== "string" && !(input instanceof URL) ? (input as Request).method : "GET")).toUpperCase();

    // Don't telemeter our own telemetry endpoint — would loop.
    if (url.includes("/api/telemetry")) {
      return origFetch(input, init);
    }
    const start = performance.now();
    try {
      const r = await origFetch(input, init);
      const dur = Math.round(performance.now() - start);
      pushEvent(
        "api_call",
        "fetch",
        {
          url: shortUrl(url),
          method,
          status: r.status,
          ok: r.ok,
          durationMs: dur,
        },
        !r.ok
      );
      return r;
    } catch (err) {
      const dur = Math.round(performance.now() - start);
      const message = err instanceof Error ? err.message : String(err);
      pushEvent(
        "api_error",
        "fetch",
        { url: shortUrl(url), method, message, durationMs: dur },
        true
      );
      throw err;
    }
  };
}

function shortUrl(u: string): string {
  // Strip query string but keep path, normalise our own backend host
  // to "<railway>" for readability in the timeline.
  try {
    const parsed = new URL(u, location.origin);
    const passthrough = process.env.NEXT_PUBLIC_PASSTHROUGH_URL || "";
    let host = parsed.host;
    if (passthrough && passthrough.includes(host)) host = "<railway>";
    return `${host}${parsed.pathname}`;
  } catch {
    return u.length > 100 ? u.slice(0, 100) + "…" : u;
  }
}

// ---------- Public API ----------

export function initTelemetry(): void {
  if (typeof window === "undefined" || state.ready) return;
  const { id, ephemeral } = loadSessionId();
  state.sessionId = id;
  state.ephemeral = ephemeral;
  state.pendingContext = captureContext();
  state.ready = true;
  window.__mdacSession = { id, ephemeral };

  instrumentErrors();
  instrumentFetch();
  instrumentDelegation();

  pushEvent("session_start", "global", {
    ephemeral,
    path: location.pathname,
    qs: location.search,
  });
  state.startSent = true;
}

export function getSessionId(): string {
  if (!state.sessionId && typeof window !== "undefined") {
    initTelemetry();
  }
  return state.sessionId;
}

export function isSessionEphemeral(): boolean {
  return state.ephemeral;
}

export function track(name: string, surface?: string, data?: AnyData): void {
  pushEvent(name, surface, data, false);
}

export function trackError(name: string, surface?: string, data?: AnyData): void {
  pushEvent(name, surface, data, true);
}

/**
 * Track a page-level navigation. Next.js client-side routes don't fire
 * a fresh navigation event, so we call this from a route effect.
 */
export function trackPageView(path: string, surface?: string, extra?: AnyData): void {
  pushEvent("page_view", surface, { path, ...extra });
}

/**
 * Track a form-field interaction without leaking the value. Pass the field
 * name + length + presence; never the actual contents.
 */
export function trackField(
  fieldName: string,
  surface: string,
  kind: "focus" | "blur" | "change",
  value: unknown
): void {
  const length =
    typeof value === "string" ? value.length : value == null ? 0 : String(value).length;
  pushEvent(`field_${kind}`, surface, {
    field: fieldName,
    length,
    hasValue: length > 0,
  });
}

export function trackValidation(surface: string, errors: string[]): void {
  pushEvent("validation_error", surface, { fields: errors, count: errors.length }, errors.length > 0);
}

export function trackStep(surface: string, fromStep: number, toStep: number): void {
  pushEvent("step_change", surface, { from: fromStep, to: toStep });
}

/** Call when an auto-submit job is created so subsequent batches link back. */
export function linkJobId(jobId: string): void {
  state.jobId = jobId;
  if (typeof window !== "undefined" && window.__mdacSession) {
    window.__mdacSession.jobId = jobId;
  }
  pushEvent("job_linked", "submit", { jobId });
  flush(false);
}
