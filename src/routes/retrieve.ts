import { Router, Request, Response } from "express";
import { retrieveQR } from "../services/mdac";

const router = Router();

interface RetrieveBody {
  phoneCountryCode: string;
  phoneNumber: string;
  pin: string;
}

// POST /api/retrieve-qr
// Accepts phone country code, phone number, and PIN; returns QR or PDF as base64.
router.post("/", async (req: Request, res: Response) => {
  res.setHeader("X-Timeout", "120");

  const { phoneCountryCode, phoneNumber, pin } = req.body as RetrieveBody;

  if (!phoneCountryCode || !phoneNumber || !pin) {
    const missing = [
      !phoneCountryCode && "phoneCountryCode",
      !phoneNumber && "phoneNumber",
      !pin && "pin",
    ].filter(Boolean);
    res.status(400).json({
      success: false,
      error: `Missing required fields: ${missing.join(", ")}`,
    });
    return;
  }

  try {
    console.log(`[retrieve] Retrieving QR for phone: ${phoneCountryCode}${phoneNumber}`);
    const result = await retrieveQR(phoneCountryCode, phoneNumber, pin);
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(422).json(result);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[retrieve] Unexpected error:", message);
    res.status(500).json({ success: false, error: `Internal error: ${message}` });
  }
});

export default router;
