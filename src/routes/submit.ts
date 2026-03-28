import { Router, Request, Response } from "express";
import { submitMDAC } from "../services/mdac";
import { MdacFormData } from "../types";

const router = Router();

// POST /api/submit
// Validates required fields and submits the form to the official MDAC site.
router.post("/", async (req: Request, res: Response) => {
  // Set a generous timeout header so proxies don't cut us off mid-browser-session.
  res.setHeader("X-Timeout", "120");

  const data = req.body as MdacFormData;

  // Validate minimum required fields
  const required: (keyof MdacFormData)[] = [
    "fullName",
    "passportNumber",
    "email",
    "arrivalDate",
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
    console.log(`[submit] Submitting MDAC for: ${data.fullName} (${data.email})`);
    const result = await submitMDAC(data);
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(422).json(result);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[submit] Unexpected error:", message);
    res.status(500).json({ success: false, error: `Internal error: ${message}` });
  }
});

export default router;
