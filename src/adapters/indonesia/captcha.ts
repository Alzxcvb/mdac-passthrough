// Indonesia All-Indonesia CAPTCHA helper. The /api/captcha/generate JWT
// payload contains the answer in plaintext — no image solver required. The
// JWT is HS256-signed (server-side secret), so we cannot tamper, but we can
// READ the payload trivially.
import type { CaptchaResponse, CaptchaPayload } from "./types";

const API_BASE = "https://allindonesia.imigrasi.go.id";

export async function generateCaptcha(): Promise<{
  token: string;
  code: string;
  captchaCode: string;
  uuid: string;
  expEpochMs: number;
}> {
  const res = await fetch(`${API_BASE}/api/captcha/generate`, { method: "GET" });
  if (!res.ok) throw new Error(`captcha/generate ${res.status}`);
  const json = (await res.json()) as { transactionDetail: CaptchaResponse };
  const { token, code } = json.transactionDetail;
  const payload = decodeJwtPayload<CaptchaPayload>(token);
  return {
    token,
    code,
    captchaCode: payload.captchaCode,
    uuid: payload.uuid,
    expEpochMs: payload.exp * 1000,
  };
}

export function decodeJwtPayload<T = unknown>(jwt: string): T {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("not a JWT");
  const padded = parts[1] + "=".repeat((4 - (parts[1].length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const json = Buffer.from(base64, "base64").toString("utf8");
  return JSON.parse(json) as T;
}
