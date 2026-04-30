# mdac-passthrough

> **Gray-zone third-party MDAC filer.** We file the Malaysian Digital Arrival Card on travelers' behalf by automating the official site at `https://imigresen-online.imi.gov.my/mdac/main`. Mobile-first, hands-off — user enters trip data once and gets the official QR by email.

This repo contains both the public-facing web app and the headless Playwright service that drives the official MDAC site.

```
mdac-passthrough/
├── src/                  # Express + Playwright backend (Railway)
│   ├── routes/           # /api/auto-submit, /api/jobs/:id, /api/session/*, /api/submit, /api/retrieve-qr
│   └── services/
│       ├── mdac.ts            # form selectors + fill logic
│       ├── captcha-solver.ts  # Jimp-based slider-CAPTCHA solver
│       ├── job-manager.ts     # async job queue (auto-submit + retrieve)
│       └── session-manager.ts # session-relay fallback (legacy/manual CAPTCHA)
├── Dockerfile, railway.toml   # backend build/deploy config
└── web/                  # Next.js frontend (Vercel)
    ├── app/              # / landing, /form 3-step, /confirmation QR
    └── components/       # PersonalStep, TravelStep, ReviewStep, SubmitStep
```

## Architecture

Two deployments, one repo:
- **Web**: Next.js app deployed to Vercel. Vercel project root = `web/`.
- **Service**: Express + Playwright + Jimp deployed to Railway from the repo root via `Dockerfile` + `railway.toml`.

User flow:
```
[Mobile browser] → [Vercel: /form] → POST /api/auto-submit → [Railway: Playwright]
                                            ↓ headless run + Jimp solver
                                     official MDAC form submitted
                                            ↓
                                     PIN emailed to user
[Mobile browser] ← (poll /api/jobs/:id)
[Mobile browser] → POST /api/jobs/:id/retrieve { pin } → [Railway: Playwright]
                                                              ↓
                                                       fetch QR/PDF
[Mobile browser] ← QR rendered on /confirmation
```

## Backend API

All endpoints below are CORS-restricted via the `ALLOWED_ORIGIN` env var.

### `GET /health`
Returns `{ status, activeSessions, activeJobs, timestamp }`.

### `POST /api/auto-submit` — primary path
Async submit. Returns immediately with a job ID; the job progresses through `queued → filling → solving → submitting → submitted` (or `failed`) in the background.

```http
POST /api/auto-submit
Content-Type: application/json

{ ...MdacFormData (see src/types.ts) }
→ 202 { "success": true, "jobId": "uuid" }
→ 503 { "success": false, "error": "Server busy — too many concurrent submissions." }
```

### `GET /api/jobs/:id` — poll status

```http
GET /api/jobs/<id>
→ 200 {
    "success": true,
    "status": "filling" | "solving" | "submitting" | "submitted" | "retrieving" | "done" | "failed",
    "message": "human-readable progress",
    "attempts": 1,
    "qrImageBase64"?: "...",
    "pdfBase64"?: "...",
    "error"?: "..."
  }
→ 404 { "success": false, "error": "Job not found or expired" }
```

### `POST /api/jobs/:id/retrieve` — kick off retrieve once status is `submitted`

```http
POST /api/jobs/<id>/retrieve
Content-Type: application/json

{ "pin": "123456" }
→ 202 { "success": true }
```

After this, keep polling `GET /api/jobs/:id` until `status === "done"`, at which point `qrImageBase64` (or `pdfBase64`) is populated.

### Legacy / fallback endpoints

- `POST /api/session/start` + `POST /api/session/solve-captcha` — **session-relay mode**. Used when auto-solve is unreliable: backend captures the CAPTCHA image, frontend shows it to the user, user drags the slider, frontend posts the X offset, backend replays it. Kept for manual override.
- `POST /api/submit` — synchronous one-shot (no working CAPTCHA). Kept for completeness; do not use.
- `POST /api/retrieve-qr` — synchronous QR retrieval (legacy; the auto pipeline uses this internally now).

## CAPTCHA solver

`src/services/captcha-solver.ts` — Jimp-based, pure-JS, no native deps.

Algorithm:
1. Grayscale.
2. Sobel-X edge detection (vertical edges).
3. Project edge magnitude per column → find top peaks separated by min spacing.
4. Pick strongest peak in left ~25% (puzzle piece) and right ~75% (notch). Drag distance = notch.x − piece.x.
5. Confidence = how dominant the two peaks are vs. median column.
6. Fallback: scan the right band for the darkest column (notch is usually a darker rectangular hole).

Confidence < 0.2 → caller marks job as failed and the user is told to file directly.

The job manager retries the auto-solver up to 3× per submission (the MDAC site usually serves a fresh CAPTCHA after a wrong drag).

## Deploy

### Backend → Railway

The service lives at the repo root. `railway.toml` points to the `Dockerfile` (Playwright base image with Chromium pre-installed). On push:

```toml
[build]
builder = "dockerfile"

[deploy]
startCommand = "node dist/index.js"
healthcheckPath = "/health"
```

Required env:
- `PORT` — Railway sets this automatically.
- `ALLOWED_ORIGIN` — set to the Vercel URL of `web/` (e.g. `https://mdac-passthrough.vercel.app`).

### Frontend → Vercel

Set Vercel project Root Directory to `web/`. Required env:
- `NEXT_PUBLIC_PASSTHROUGH_URL` — public URL of the Railway service (e.g. `https://mdac-passthrough.up.railway.app`).

## MVP / validation posture

- **No paywall.** Goal is signal: how many users complete the funnel? Pricing comes later if conversion is real.
- **Email capture on landing** ahead of the form — gives a fallback channel if filing fails.
- **Vercel Analytics** funnel events: `form_started → step_1_complete → step_2_complete → step_3_review_submit → submit_opened_mdac (passthrough) → user_confirmed_submitted → qr_generated`.
- **Gray-zone disclosure** is loud and on every page — users explicitly check two boxes before submission acknowledging this is a third-party tool.

## Disclaimer

Not affiliated with the Malaysian Immigration Department. The MDAC is **always free** at the official site. This service exists because the official UX is rough on mobile. Use at your own risk; if filing fails, file directly before your trip.

## Selector drift

The MDAC site is a Java/Stripes server (jQuery + Bootstrap 3). Selectors will drift over time. When the auto-submit success rate drops:
1. Run `src/services/mdac.ts` locally with `headless: false` and watch.
2. Update selectors in `fillForm`, `captureCaptcha`, `dragAndSubmit` (in `job-manager.ts`).
3. Redeploy. Look for `// SELECTOR NOTE:` comments throughout.
