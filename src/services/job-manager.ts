/**
 * Async job queue for auto-submit + retrieve flows.
 *
 * Each job runs Playwright headlessly in the background and the frontend
 * polls GET /api/jobs/:id for status. State is in-memory only — if the
 * Railway container restarts mid-job, the job is lost and the user has to
 * resubmit. That's acceptable for MVP; we'll add Redis if traffic warrants.
 */

import { randomUUID } from "crypto";
import { chromium, type Browser, type Page } from "playwright";
import { fillForm, captureCaptcha, retrieveQR } from "./mdac";
import { solveSliderCaptcha, type SolverResult } from "./captcha-solver";
import type { MdacFormData } from "../types";

export type JobStatus =
  | "queued"
  | "filling"
  | "solving"
  | "submitting"
  | "submitted"        // User now needs to provide PIN
  | "retrieving"
  | "done"             // QR/PDF available
  | "failed";

export interface JobState {
  id: string;
  status: JobStatus;
  message: string;
  error?: string;
  /** Solver attempts so far (auto path). */
  attempts: number;
  /** Final QR/PDF, populated when status === "done". */
  qrImageBase64?: string;
  pdfBase64?: string;
  /** Internal: when the job was last touched. */
  updatedAt: number;
  createdAt: number;
}

const MAX_CONCURRENT_JOBS = 3;
const MAX_SOLVER_ATTEMPTS = 3;
const JOB_TTL_MS = 30 * 60 * 1000; // 30 min — longer than relay because user has to receive PIN by email
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const NAV_TIMEOUT_MS = 60_000;

interface JobInternal extends JobState {
  data: MdacFormData;
  /** Captured during submit so retrieve can reuse the phone for QR lookup. */
  phone?: { region: string; mobile: string };
}

class JobManager {
  private jobs = new Map<string, JobInternal>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight = 0;

  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  get activeCount(): number {
    return this.jobs.size;
  }

  /** Public: status the frontend polls for. */
  getStatus(jobId: string): JobState | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const { data: _data, phone: _phone, ...publicState } = job;
    return publicState;
  }

  /**
   * Kick off an auto-submit job. Returns the jobId immediately; work happens
   * in the background.
   */
  async startAutoSubmit(data: MdacFormData): Promise<string> {
    if (this.inFlight >= MAX_CONCURRENT_JOBS) {
      throw new Error("Server busy — too many concurrent submissions. Please wait a minute and retry.");
    }

    const id = randomUUID();
    const now = Date.now();
    const job: JobInternal = {
      id,
      status: "queued",
      message: "Queued",
      attempts: 0,
      data,
      phone: { region: data.region, mobile: data.mobile },
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(id, job);

    // Run async; don't await
    void this.runAutoSubmit(id);

    return id;
  }

  /**
   * After auto-submit reports `submitted`, the user types their email PIN
   * and we kick off the retrieve flow. Re-uses the same job id so the
   * frontend can keep polling one endpoint.
   */
  async startRetrieve(jobId: string, pin: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error("Job not found or expired");
    if (job.status !== "submitted") {
      throw new Error(`Cannot retrieve — job status is ${job.status}, expected "submitted"`);
    }
    if (!job.phone) throw new Error("Phone info missing on job");

    if (this.inFlight >= MAX_CONCURRENT_JOBS) {
      throw new Error("Server busy — try again in a minute.");
    }

    this.update(jobId, { status: "retrieving", message: "Retrieving QR from MDAC site..." });
    void this.runRetrieve(jobId, pin);
  }

  // ---- Internal workers ----

  private async runAutoSubmit(jobId: string): Promise<void> {
    this.inFlight++;
    let browser: Browser | null = null;

    try {
      const job = this.jobs.get(jobId);
      if (!job) return;

      this.update(jobId, { status: "filling", message: "Opening MDAC site..." });

      browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });
      const page = await ctx.newPage();
      page.setDefaultTimeout(NAV_TIMEOUT_MS);

      this.update(jobId, { message: "Filling out form..." });
      await fillForm(page, job.data);

      // Try the auto-solver up to N times. After each fail, recapture the
      // CAPTCHA (the site usually serves a fresh image after a wrong drag).
      let solved = false;
      let lastError = "";
      for (let attempt = 1; attempt <= MAX_SOLVER_ATTEMPTS; attempt++) {
        this.update(jobId, {
          status: "solving",
          message: `Solving CAPTCHA (attempt ${attempt}/${MAX_SOLVER_ATTEMPTS})...`,
          attempts: attempt,
        });

        const captcha = await captureCaptcha(page);
        const captchaBuf = Buffer.from(captcha.imageBase64, "base64");
        const blockBuf = captcha.blockImageBase64
          ? Buffer.from(captcha.blockImageBase64, "base64")
          : undefined;
        const solver = await solveSliderCaptcha({
          background: captchaBuf,
          block: blockBuf,
          blockOffsetX: captcha.blockOffsetX,
        });

        console.log(
          `[job ${jobId}] solver attempt ${attempt}: dragX=${solver.dragX} ` +
            `confidence=${solver.confidence.toFixed(2)} method=${solver.debug.method} ` +
            `debug=${JSON.stringify(solver.debug)}`
        );

        if (solver.confidence < 0.2 && attempt === MAX_SOLVER_ATTEMPTS) {
          lastError = "CAPTCHA solver couldn't lock onto the puzzle (low confidence).";
          break;
        }

        this.update(jobId, { status: "submitting", message: "Dragging slider + submitting..." });
        const submitResult = await dragAndSubmit(page, solver);

        if (submitResult.success) {
          solved = true;
          break;
        }

        lastError = submitResult.error || "Submit failed";
        // If MDAC says the CAPTCHA was wrong and gave a retry, loop
        if (!submitResult.retryable) break;
        await page.waitForTimeout(800);
      }

      if (!solved) {
        this.update(jobId, {
          status: "failed",
          error: `Auto-submit failed after ${MAX_SOLVER_ATTEMPTS} attempts. Last error: ${lastError}`,
          message: "Auto-submit failed.",
        });
        return;
      }

      this.update(jobId, {
        status: "submitted",
        message: "Submitted! Check your email for the PIN, then enter it below.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[job ${jobId}] auto-submit error:`, msg);
      this.update(jobId, { status: "failed", error: msg, message: "Submit failed." });
    } finally {
      if (browser) await browser.close().catch(() => {});
      this.inFlight--;
    }
  }

  private async runRetrieve(jobId: string, pin: string): Promise<void> {
    this.inFlight++;
    try {
      const job = this.jobs.get(jobId);
      if (!job || !job.phone) {
        this.update(jobId, { status: "failed", error: "Job missing phone info", message: "Failed" });
        return;
      }

      // retrieveQR launches its own browser and closes it.
      const result = await retrieveQR(`+${job.phone.region}`, job.phone.mobile, pin);

      if (!result.success) {
        this.update(jobId, {
          status: "failed",
          error: result.error || "Retrieval failed",
          message: "Couldn't fetch QR — check your PIN and try again.",
        });
        return;
      }

      this.update(jobId, {
        status: "done",
        message: "QR ready.",
        qrImageBase64: result.qrImageBase64,
        pdfBase64: result.pdfBase64,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[job ${jobId}] retrieve error:`, msg);
      this.update(jobId, { status: "failed", error: msg, message: "Retrieve failed." });
    } finally {
      this.inFlight--;
    }
  }

  private update(jobId: string, patch: Partial<JobInternal>): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    Object.assign(job, patch, { updatedAt: Date.now() });
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (now - job.updatedAt > JOB_TTL_MS) {
        console.log(`[job ${id}] expired (TTL)`);
        this.jobs.delete(id);
      }
    }
  }
}

/**
 * Replay the slider drag using the solver's dragX, then click submit.
 * Pulled out of session-manager so we can run it without the relay context.
 */
async function dragAndSubmit(
  page: Page,
  solver: SolverResult
): Promise<{ success: boolean; error?: string; retryable?: boolean }> {
  const handleSelectors = [
    '[class*="slider"] [class*="handle"]',
    '[class*="slider"] [class*="btn"]',
    '[class*="captcha"] [class*="drag"]',
    '[class*="verify"] [class*="handler"]',
    '[class*="slider-btn"]',
    ".handler",
    '[class*="slide"] button',
    '[class*="slide"] [class*="icon"]',
  ];

  let handle = null;
  for (const sel of handleSelectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0 && (await loc.isVisible())) {
      handle = loc;
      break;
    }
  }
  if (!handle) return { success: false, error: "Slider handle not found", retryable: false };

  const box = await handle.boundingBox();
  if (!box) return { success: false, error: "Handle bounding box unavailable", retryable: false };

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  // Human-like drag: 20–30 micro-steps with variable spacing + small overshoot+correction.
  const target = startX + solver.dragX;
  const overshoot = target + 4 + Math.random() * 6;
  await page.mouse.move(startX, startY);
  await page.mouse.down();

  const steps = 22 + Math.floor(Math.random() * 8);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Ease-out cubic
    const ease = 1 - Math.pow(1 - t, 3);
    const x = startX + (overshoot - startX) * ease;
    const y = startY + (Math.random() * 2 - 1);
    await page.mouse.move(x, y);
    await page.waitForTimeout(15 + Math.random() * 25);
  }
  // Correct from overshoot
  await page.waitForTimeout(80 + Math.random() * 60);
  await page.mouse.move(target, startY);
  await page.mouse.up();
  await page.waitForTimeout(1200);

  const errorEl = page.locator('.alert-danger, .error, [class*="error"], [class*="alert-danger"]');
  if ((await errorEl.count()) > 0) {
    const text = (await errorEl.first().textContent())?.trim() || "Submit error";
    const lower = text.toLowerCase();
    const retryable =
      lower.includes("captcha") || lower.includes("verification") || lower.includes("slider");
    return { success: false, error: text, retryable };
  }

  // Click submit
  const submitBtn = page.locator(
    'button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Confirm"), button:has-text("Register")'
  );
  if ((await submitBtn.count()) > 0) {
    await submitBtn.first().click();
  }

  await page
    .waitForSelector(
      '.success, .alert-success, [class*="success"], [class*="confirmation"], h2:has-text("Thank"), h2:has-text("Success"), p:has-text("PIN")',
      { timeout: 30_000 }
    )
    .catch(() => null);

  const errorAfterSubmit = page.locator('.alert-danger, .error, [class*="error"]');
  if ((await errorAfterSubmit.count()) > 0) {
    const text = (await errorAfterSubmit.first().textContent())?.trim() || "Submit error";
    const lower = text.toLowerCase();
    const retryable =
      lower.includes("captcha") || lower.includes("verification") || lower.includes("slider");
    return { success: false, error: text, retryable };
  }

  return { success: true };
}

export const jobManager = new JobManager();
