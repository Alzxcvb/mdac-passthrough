/**
 * Async auto-submit pipeline:
 *   POST  /api/auto-submit            { ...formData }                → { jobId }
 *   GET   /api/jobs/:id                                              → status JSON
 *   POST  /api/jobs/:id/retrieve      { pin }                        → kicks off retrieve
 *
 * The headless browser run, CAPTCHA solver, and QR retrieval all happen in
 * the background via the JobManager. Frontend polls /api/jobs/:id.
 */

import { Router, Request, Response } from "express";
import { jobManager } from "../services/job-manager";
import { telemetryStore } from "../services/telemetry-store";
import type { MdacFormData } from "../types";

const router = Router();

router.post("/auto-submit", async (req: Request, res: Response) => {
  const body = req.body as MdacFormData & { sessionId?: string };
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
  const data: MdacFormData = { ...body };
  delete (data as { sessionId?: string }).sessionId;

  const required: (keyof MdacFormData)[] = [
    "name",
    "passNo",
    "email",
    "arrDt",
    "region",
    "mobile",
  ];
  const missing = required.filter((f) => !data[f]);
  if (missing.length > 0) {
    res.status(400).json({
      success: false,
      error: `Missing required fields: ${missing.join(", ")}`,
    });
    return;
  }

  try {
    const jobId = await jobManager.startAutoSubmit(data, sessionId);
    console.log(
      `[auto-submit] queued ${jobId} for ${data.name}` +
        (sessionId ? ` (session ${sessionId.slice(0, 8)})` : "")
    );
    if (sessionId) {
      // Link the job back to the session in the telemetry store so
      // GET /api/sessions/by-job/:id works and a server-side note appears
      // in the session timeline even if the client never POSTs after submit.
      try {
        telemetryStore.append(
          sessionId,
          [
            {
              ts: Date.now(),
              name: "server.job_created",
              surface: "submit",
              data: { jobId },
            },
          ],
          undefined,
          jobId
        );
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        console.warn("[auto-submit] telemetry link failed:", m);
      }
    }
    res.status(202).json({ success: true, jobId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("too many concurrent")) {
      res.status(503).json({ success: false, error: msg });
      return;
    }
    res.status(500).json({ success: false, error: msg });
  }
});

router.get("/jobs/:id", (req: Request, res: Response) => {
  const status = jobManager.getStatus(req.params.id);
  if (!status) {
    res.status(404).json({ success: false, error: "Job not found or expired" });
    return;
  }
  res.status(200).json({ success: true, ...status });
});

/**
 * Full debug bundle: per-job event timeline, per-attempt captcha images,
 * solver decisions, drag distances, and final-page screenshot+HTML on errors.
 * Intended for postmortem after a real run — large payloads (~hundreds of KB).
 * Job TTL is 24h.
 */
router.get("/jobs/:id/debug", (req: Request, res: Response) => {
  const debug = jobManager.getDebug(req.params.id);
  if (!debug) {
    res.status(404).json({ success: false, error: "Job not found or expired" });
    return;
  }
  res.status(200).json({ success: true, ...debug });
});

router.post("/jobs/:id/retrieve", async (req: Request, res: Response) => {
  const { pin } = req.body as { pin?: string };
  if (!pin || !pin.trim()) {
    res.status(400).json({ success: false, error: "Missing PIN" });
    return;
  }
  try {
    await jobManager.startRetrieve(req.params.id, pin.trim());
    res.status(202).json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ success: false, error: msg });
  }
});

export default router;
