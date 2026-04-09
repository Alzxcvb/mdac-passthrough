import { Router, Request, Response } from "express";
import { sessionManager } from "../services/session-manager";
import { type MdacFormData, type CaptchaSolveRequest } from "../types";

const router = Router();

/**
 * POST /api/session/start
 * Accept mapped MDAC form data, launch Playwright, fill the form,
 * screenshot the CAPTCHA, and return it to the frontend.
 */
router.post("/start", async (req: Request, res: Response) => {
  const data = req.body as MdacFormData;

  // Basic validation
  if (!data.name || !data.passNo || !data.email || !data.arrDt) {
    res.status(400).json({
      success: false,
      error: "Missing required fields: name, passNo, email, arrDt",
    });
    return;
  }

  try {
    console.log(`[session] Starting session for: ${data.name} (${data.email})`);
    const result = await sessionManager.createSession(data);
    res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[session] Start error:", message);

    // 503 if at capacity
    if (message.includes("too many active sessions")) {
      res.status(503).json({ success: false, error: message });
      return;
    }

    res.status(500).json({ success: false, error: `Session start failed: ${message}` });
  }
});

/**
 * POST /api/session/solve-captcha
 * Replay the user's slider position on the CAPTCHA and submit the form.
 */
router.post("/solve-captcha", async (req: Request, res: Response) => {
  const { sessionId, sliderX } = req.body as CaptchaSolveRequest;

  if (!sessionId || sliderX === undefined) {
    res.status(400).json({
      success: false,
      error: "Missing required fields: sessionId, sliderX",
    });
    return;
  }

  try {
    console.log(`[session] Solving CAPTCHA for ${sessionId} (sliderX=${sliderX})`);
    const result = await sessionManager.solveCaptcha(sessionId, sliderX);
    res.status(result.success ? 200 : 422).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[session] Solve error:", message);
    res.status(500).json({ success: false, error: `Solve failed: ${message}` });
  }
});

/**
 * GET /api/session/:id/status
 * Check the status of a session (for error recovery / polling).
 */
router.get("/:id/status", (req: Request, res: Response) => {
  const status = sessionManager.getStatus(req.params.id);
  res.status(200).json(status);
});

/**
 * DELETE /api/session/:id
 * Manually destroy a session (e.g. user navigates away).
 */
router.delete("/:id", async (req: Request, res: Response) => {
  await sessionManager.destroySession(req.params.id);
  res.status(200).json({ success: true });
});

export default router;
