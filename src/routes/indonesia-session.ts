/**
 * Indonesia session-relay API.
 *
 *   POST /api/id-session/start            { traveler }   -> { sessionId, submissionId, reviewImageBase64 }
 *   POST /api/id-session/:id/confirm                     -> { success, status, qrUrl? | message }
 *   GET  /api/id-session/:id/status                      -> { status }
 *   DELETE /api/id-session/:id                           -> { success }
 *
 * The server fills the Indonesia form through the declaration step, returns a
 * screenshot for the user to review, then submits (gated) on user confirm.
 */

import { Router, Request, Response } from "express";
import { indonesiaSessionManager } from "../services/indonesia-session-manager";
import type { ArrivalPassTraveler } from "../adapters/indonesia";

const router = Router();

router.post("/start", async (req: Request, res: Response) => {
  const traveler = req.body?.traveler as ArrivalPassTraveler | undefined;

  if (
    !traveler ||
    !traveler.fullName ||
    !traveler.passportNumber ||
    !traveler.email ||
    !traveler.arrivalDate ||
    !traveler.nationalityIso3
  ) {
    res.status(400).json({
      success: false,
      error: "Missing required traveler fields: fullName, passportNumber, email, arrivalDate, nationalityIso3",
    });
    return;
  }

  try {
    console.log(`[id-session] Starting for: ${traveler.fullName} (${traveler.email})`);
    const result = await indonesiaSessionManager.createSession(traveler);
    res.status(200).json({ success: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[id-session] Start error:", message);
    if (message.includes("too many active sessions")) {
      res.status(503).json({ success: false, error: message });
      return;
    }
    res.status(500).json({ success: false, error: `Session start failed: ${message}` });
  }
});

router.post("/:id/confirm", async (req: Request, res: Response) => {
  try {
    console.log(`[id-session] Confirm submit for ${req.params.id}`);
    const result = await indonesiaSessionManager.confirm(req.params.id);
    // 200 on submitted; 422 on blocked/error (frontend reads `status`).
    res.status(result.success ? 200 : 422).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[id-session] Confirm error:", message);
    res.status(500).json({ success: false, status: "error", error: `Confirm failed: ${message}` });
  }
});

router.get("/:id/status", (req: Request, res: Response) => {
  res.status(200).json(indonesiaSessionManager.getStatus(req.params.id));
});

router.delete("/:id", async (req: Request, res: Response) => {
  await indonesiaSessionManager.destroySession(req.params.id);
  res.status(200).json({ success: true });
});

export default router;
