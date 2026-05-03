/**
 * In-memory session-keyed telemetry store for the frontend.
 *
 * Frontend posts batches of events keyed by a client-generated sessionId.
 * Backend stores everything and exposes it via /api/sessions/:id so we can
 * fully reconstruct what happened on a tester's device — page loads,
 * clicks, validation errors, API calls + their timing, JS exceptions,
 * visibility changes, and so on.
 *
 * Caps: per-session 1000 events, total 5000 sessions, 7-day TTL. Bigger
 * than the per-job 24h debug bundle because we want to keep the tester's
 * full journey around even if no submit ever happened.
 */

const MAX_EVENTS_PER_SESSION = 1000;
const MAX_SESSIONS = 5000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

export interface TelemetryEvent {
  /** ISO ms epoch — set by the client. */
  ts: number;
  /** Short event name, e.g. "page_view", "click", "api_call", "js_error". */
  name: string;
  /** Logical app surface, e.g. "landing", "form/step1", "submit". */
  surface?: string;
  /** Free-form structured payload — must NOT contain PII values. */
  data?: Record<string, unknown>;
  /** Truthy iff the event represents an error condition. */
  isError?: boolean;
}

export interface SessionContext {
  /** Captured once at session start. */
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

export interface SessionRecord {
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  context: SessionContext;
  /** Set when frontend ties a job to this session. */
  jobIds: string[];
  /** Counters so /api/sessions/recent can render a useful list. */
  eventCount: number;
  errorCount: number;
  events: TelemetryEvent[];
  /** True once the session emitted overflow — events were dropped. */
  truncated: boolean;
}

class TelemetryStore {
  private sessions = new Map<string, SessionRecord>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Append a batch of events to a session, lazily creating it. Returns
   * the resulting session record (truncated for response use).
   */
  append(
    sessionId: string,
    events: TelemetryEvent[],
    context?: SessionContext,
    jobId?: string
  ): { ok: true; eventCount: number; truncated: boolean } {
    if (!sessionId || typeof sessionId !== "string") {
      throw new Error("sessionId required");
    }

    let rec = this.sessions.get(sessionId);
    if (!rec) {
      // Evict oldest if we're at the global cap before inserting.
      if (this.sessions.size >= MAX_SESSIONS) {
        let oldestId: string | null = null;
        let oldestTs = Infinity;
        for (const [id, r] of this.sessions) {
          if (r.updatedAt < oldestTs) {
            oldestTs = r.updatedAt;
            oldestId = id;
          }
        }
        if (oldestId) this.sessions.delete(oldestId);
      }
      const now = Date.now();
      rec = {
        sessionId,
        createdAt: now,
        updatedAt: now,
        context: context || {},
        jobIds: [],
        eventCount: 0,
        errorCount: 0,
        events: [],
        truncated: false,
      };
      this.sessions.set(sessionId, rec);
    } else if (context && Object.keys(context).length > 0) {
      // Merge any newly-arrived context keys (e.g. orientation change after start).
      rec.context = { ...rec.context, ...context };
    }

    if (jobId && !rec.jobIds.includes(jobId)) {
      rec.jobIds.push(jobId);
    }

    for (const ev of events) {
      if (rec.events.length >= MAX_EVENTS_PER_SESSION) {
        rec.truncated = true;
        break;
      }
      rec.events.push(ev);
      rec.eventCount++;
      if (ev.isError) rec.errorCount++;
    }
    rec.updatedAt = Date.now();

    return { ok: true, eventCount: rec.eventCount, truncated: rec.truncated };
  }

  get(sessionId: string): SessionRecord | null {
    return this.sessions.get(sessionId) || null;
  }

  /** Most recent N sessions, summarised — for the recent list. */
  recent(limit = 50): Array<{
    sessionId: string;
    createdAt: number;
    updatedAt: number;
    eventCount: number;
    errorCount: number;
    jobIds: string[];
    truncated: boolean;
    userAgentSnippet?: string;
  }> {
    const all = Array.from(this.sessions.values());
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    return all.slice(0, limit).map((r) => ({
      sessionId: r.sessionId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      eventCount: r.eventCount,
      errorCount: r.errorCount,
      jobIds: r.jobIds,
      truncated: r.truncated,
      userAgentSnippet: r.context.userAgent?.slice(0, 80),
    }));
  }

  /** Find the session that owns this jobId (used by debug bundle to link). */
  findByJobId(jobId: string): SessionRecord | null {
    for (const r of this.sessions.values()) {
      if (r.jobIds.includes(jobId)) return r;
    }
    return null;
  }

  private cleanup(): void {
    const now = Date.now();
    let removed = 0;
    for (const [id, r] of this.sessions) {
      if (now - r.updatedAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
        removed++;
      }
    }
    if (removed > 0) {
      console.log(`[telemetry] cleaned up ${removed} expired sessions`);
    }
  }
}

export const telemetryStore = new TelemetryStore();
