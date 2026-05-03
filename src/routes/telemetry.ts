/**
 * Telemetry ingest + read endpoints.
 *
 *   POST /api/telemetry           — frontend pushes a batch of events.
 *                                   Always returns 204 quickly so sendBeacon
 *                                   doesn't block page unload.
 *   GET  /api/sessions/recent     — last N sessions, summarised.
 *   GET  /api/sessions/:id        — full session record (events + context).
 *   GET  /api/sessions/by-job/:id — session that submitted this jobId.
 *
 * No auth on read endpoints (parity with /api/jobs/:id/debug — we live with
 * it for the MVP since the data is already not particularly sensitive: no
 * PII values, just structural events).
 */

import { Router, Request, Response } from "express";
import { telemetryStore, type TelemetryEvent, type SessionContext } from "../services/telemetry-store";

const router = Router();

interface IngestBody {
  sessionId?: string;
  jobId?: string;
  context?: SessionContext;
  events?: TelemetryEvent[];
}

router.post("/telemetry", (req: Request, res: Response) => {
  const body = (req.body || {}) as IngestBody;
  // Always 204 first so sendBeacon never blocks. Errors are swallowed
  // to keep the unload path unbreakable; we log them server-side.
  res.status(204).end();

  try {
    if (!body.sessionId) {
      console.warn("[telemetry] dropped batch: missing sessionId");
      return;
    }
    const events = Array.isArray(body.events) ? body.events : [];
    if (events.length === 0 && !body.context && !body.jobId) {
      // Nothing to do.
      return;
    }
    const result = telemetryStore.append(body.sessionId, events, body.context, body.jobId);
    if (result.truncated) {
      console.warn(
        `[telemetry] session ${body.sessionId.slice(0, 8)} truncated at ${result.eventCount} events`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[telemetry] ingest error:`, msg);
  }
});

router.get("/sessions/recent", (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 500);
  res.status(200).json({
    success: true,
    count: telemetryStore.sessionCount,
    sessions: telemetryStore.recent(limit),
  });
});

router.get("/sessions/by-job/:id", (req: Request, res: Response) => {
  const rec = telemetryStore.findByJobId(req.params.id);
  if (!rec) {
    res.status(404).json({ success: false, error: "No session linked to that jobId" });
    return;
  }
  res.status(200).json({ success: true, session: rec });
});

router.get("/sessions/:id", (req: Request, res: Response) => {
  const rec = telemetryStore.get(req.params.id);
  if (!rec) {
    res.status(404).json({ success: false, error: "Session not found or expired" });
    return;
  }
  res.status(200).json({ success: true, session: rec });
});

export default router;
