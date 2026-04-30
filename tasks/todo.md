# mdac-passthrough — MVP buildout (2026-04-30)

Repurposed the existing `mdac-passthrough` repo from a backend-only session-relay into a full product (web + service) that auto-files MDAC end-to-end. MDAC Better at https://mdac-better.vercel.app/ is intentionally unchanged.

## Done in this session

### Backend (`src/`)
- [x] `services/captcha-solver.ts` — Jimp-based slider-CAPTCHA solver (Sobel-X edge detection + column-peak matching, darkness-heuristic fallback, confidence score).
- [x] `services/job-manager.ts` — async job queue: `queued → filling → solving → submitting → submitted → retrieving → done` (or `failed`). Max 3 concurrent jobs, 30 min TTL, in-memory only. Retries the auto-solver 3× per submission.
- [x] `routes/auto-submit.ts` — `POST /api/auto-submit` returns jobId; `GET /api/jobs/:id` returns status; `POST /api/jobs/:id/retrieve` kicks off the QR retrieval after the user enters their MDAC PIN.
- [x] `index.ts` wired in the new router + cleanup loops.
- [x] `package.json` adds `jimp@^1.6` (no native deps — Railway-friendly).
- [x] Build passes cleanly: `npm run build`.

Legacy session-relay (`/api/session/*`) and synchronous `/api/submit` + `/api/retrieve-qr` are kept as fallbacks for now.

### Web (`web/`)
- [x] Next.js + TS + Tailwind app, cloned from `mdac-better` (no PWA, no passport-scan API).
- [x] Lib: `types`, `storage`, `mdac-codes`, `analytics`, `analytics-events` cloned verbatim.
- [x] Components: `PersonalStep`, `TravelStep`, `ReviewStep`, `StepIndicator` cloned. PersonalStep stripped of the Anthropic passport-scan UI.
- [x] **New** `components/SubmitStep.tsx` — passthrough flow:
      `intro (gray-zone disclosure + 2 checkboxes) → submitting → submitted (PIN input) → retrieving → done`.
- [x] **New** `app/page.tsx` — landing with gray-zone banner + email capture (intent signal).
- [x] **New** `app/confirmation/page.tsx` — QR display (or PDF download).
- [x] `app/api/mdac/cities/route.ts` — kept (proxies the MDAC city AJAX endpoint).
- [x] Build passes cleanly: `npx next build`.

### Docs
- [x] Rewrote `README.md` for the new architecture.
- [x] This file.

## Required env to deploy

### Railway (backend, root of repo)
- `PORT` — auto.
- `ALLOWED_ORIGIN` — Vercel URL of the `web/` deploy.

### Vercel (frontend, root = `web/`)
- `NEXT_PUBLIC_PASSTHROUGH_URL` — Railway public URL.

## Live test session 2026-04-30 — what I verified end-to-end

Drove the live MDAC site with a real headless Playwright run, no submissions. Smoke scripts in `scripts/smoke-mdac.js` and `scripts/smoke-captcha.js`. Artifacts in `/tmp/claude/mdac-smoke/` and `/tmp/claude/mdac-captcha-multi/`.

### ✅ Works against live site
- Backend boots, all routes (auto-submit, jobs, retrieve, session, health) respond correctly.
- Frontend boots, `/`, `/form`, `/confirmation`, `/api/mdac/cities` all 200.
- `/api/mdac/cities?state=01` returns real Johor cities — proxy + state-code mapping current.
- All 22 expected `[name="..."]` form selectors exist on live MDAC.
- `fillForm` completes successfully — initially threw on `dob` (Bootstrap datepicker is `readonly`), **fixed** by detecting readonly and setting via JS evaluate that briefly removes the attr + fires jQuery datepicker `setDate`.
- `captureCaptcha` initially grabbed the wrong area (300×268 widget incl. slider track + chrome). **Fixed** by targeting `#captcha canvas` directly via `toDataURL` — now grabs the 271×155 background canvas + 63×155 block canvas separately (with offset). Architecture is two stacked canvases; we capture both.
- Slider handle locator `[class*="slide"] [class*="icon"]` and submit button `input[type="submit"]` both found.

### ⚠️ Solver is at ~50% per attempt — known limit

Tested on 24 live CAPTCHAs across 3 background images (snowy mountain, beach, dog/walrus photos). Iterated through three algorithms:
1. Sobel-X column peaks — confused by wood-grain content.
2. Silhouette-edge template matching — confused by photo's internal vertical edges.
3. Luminance-contrast × edge-on-boundary (current) — best so far, hits ~50% of single attempts.

The visible "notch" in the MDAC CAPTCHA is a translucent **bright** puzzle-shaped overlay (not a dark hole), and photos with bright clouds, snow, or shore against dark content trick the lumContrast term.

**Mitigation in place:** job-manager retries the auto-solver up to 3× per submission. MDAC refreshes the puzzle on a wrong drag → each attempt is a fresh dice roll. Expected hit-rate per submission ≈ 1 − (0.5)³ ≈ **87%**.

### ❌ NOT verifiable without an actual MDAC submission
- Whether MDAC accepts the drag when it's right (we never clicked submit — pollutes their DB with junk records).
- Whether MDAC's "wrong drag" UX matches what `dragAndSubmit` looks for (`.alert-danger`, `.error`).
- Whether `retrieveQR` selectors still match the current "Check Registration" page (couldn't reach it without a real PIN).
- Real-world CAPTCHA refresh behaviour after a wrong attempt.

These three are gated on a real submission and have to be validated when you (Alex) file your next real MDAC, OR by accepting one polluted submission as the cost of validating.

### To improve solver before launch (optional)
- Plug in **2Captcha / CapSolver** — ~$0.001/solve, ~95% accuracy. ~30 lines of code, drop in.
- Train a small CNN on labeled MDAC captchas — overkill for the volume.
- Keep iterating heuristics — diminishing returns past 70%.

## Out-of-scope-for-MVP (unchanged from above)
- Stripe / paywall.
- Persistent job storage.
- Anthropic passport-scan.
- Chrome / Safari extension paths.

## Next moves (post-deploy)

1. Push backend changes — Railway redeploys automatically.
2. Push frontend — connect new Vercel project rooted at `web/`, set `NEXT_PUBLIC_PASSTHROUGH_URL`.
3. Wire `ALLOWED_ORIGIN` on Railway to the Vercel URL.
4. **Smoke test against live MDAC** with a real upcoming trip's data. Run `playwright` with `headless: false` locally first (see Selector drift section in README).
5. Watch the Vercel funnel + Railway logs. Tune the solver / selectors based on first ~10 attempts.
6. Decide pricing once we have ≥ 20 successful filings + retention signal.

## Out of scope for MVP

- Stripe / paywall.
- Persistent job storage (Redis / Postgres). Container restarts kill in-flight jobs — acceptable for now.
- Anthropic passport-scan (was in mdac-better). Add back if filling form by hand on mobile turns out to be the dropoff point.
- Chrome extension / Safari extension / iOS Shortcut paths. These are alternative architectures — passthrough is the bet for this MVP.
- Anti-Captcha / 2Captcha API fallback. Will add if our Jimp solver underperforms <50% over the first 30 jobs.
