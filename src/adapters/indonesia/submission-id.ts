// SubmissionId generator. Format observed live (foreigner flow):
//   ID050472d4cf0eb71777908537349
//   └─┬─└──┬───────└─────┬───────
//     │    │             └ epoch ms (timestamp)
//     │    └ pseudo-random hex (~12 chars)
//     └ "ID" + DDMM (date) ... actually 0504 = May 4 (DD MM)
//
// We mirror that shape: ID + DDMM + 12 hex + epoch_ms. The server doesn't
// appear to validate the encoded date — the `iat` on the guest token is
// authoritative — but matching the format keeps debugging easier.
import { randomBytes } from "node:crypto";

export function generateSubmissionId(now: Date = new Date()): string {
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rand = randomBytes(6).toString("hex"); // 12 hex chars
  const epoch = String(now.getTime());
  return `ID${dd}${mm}${rand}${epoch}`;
}
