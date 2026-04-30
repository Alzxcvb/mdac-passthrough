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
import type { MdacFormData } from "../types";

const router = Router();

router.post("/auto-submit", async (req: Request, res: Response) => {
  const data = req.body as MdacFormData;

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
    const jobId = await jobManager.startAutoSubmit(data);
    console.log(`[auto-submit] queued ${jobId} for ${data.name}`);
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
