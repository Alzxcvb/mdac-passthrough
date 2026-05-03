/**
 * Async job queue for auto-submit + retrieve flows.
 *
 * Each job runs Playwright headlessly in the background and the frontend
 * polls GET /api/jobs/:id for status. State is in-memory only — if the
 * Railway container restarts mid-job, the job is lost and the user has to
 * resubmit. That's acceptable for MVP; we'll add Redis if traffic warrants.
 *
 * Each job also carries a DebugLogger that captures a timeline of events,
 * per-attempt captcha images, solver decisions, drag distances, and
 * page state on errors. Exposed via GET /api/jobs/:id/debug.
 */

import { randomUUID } from "crypto";
import { chromium, type Browser, type Page } from "playwright";
import { fillForm, captureCaptcha, retrieveQR } from "./mdac";
import { solveSliderCaptcha, type SolverResult } from "./captcha-solver";
import { DebugLogger, type DebugBundle } from "./debug";
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
// 24h so we can pull the debug bundle the day after a real run.
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const NAV_TIMEOUT_MS = 60_000;

interface JobInternal extends JobState {
  data: MdacFormData;
  /** Captured during submit so retrieve can reuse the phone for QR lookup. */
  phone?: { region: string; mobile: string };
  /** Per-job debug logger for the auto-submit phase. */
  logger: DebugLogger;
  /** Separate logger for the retrieve phase (different page lifecycle). */
  retrieveLogger?: DebugLogger;
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
    const { data: _data, phone: _phone, logger: _l, retrieveLogger: _rl, ...publicState } = job;
    return publicState;
  }

  /** Public: full debug bundle for postmortem. */
  getDebug(jobId: string): DebugBundle | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const bundle: DebugBundle = {
      jobId,
      createdAt: job.createdAt,
      status: job.status,
      events: job.logger.events,
      attempts: job.logger.attempts,
      finalScreenshotBase64: job.logger.finalScreenshotBase64,
      finalHtmlSnippet: job.logger.finalHtmlSnippet,
    };
    if (job.retrieveLogger) {
      bundle.retrieve = {
        events: job.retrieveLogger.events,
        screenshotBase64: job.retrieveLogger.finalScreenshotBase64,
        htmlSnippet: job.retrieveLogger.finalHtmlSnippet,
      };
    }
    return bundle;
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
    const logger = new DebugLogger(id, "auto");
    logger.push("info", "queue", "Job queued", {
      hasName: Boolean(data.name),
      hasPassNo: Boolean(data.passNo),
      arrDt: data.arrDt,
      region: data.region,
      trvlMode: data.trvlMode,
      embark: data.embark,
      accommodationState: data.accommodationState,
      sCity: data.sCity,
    });
    const job: JobInternal = {
      id,
      status: "queued",
      message: "Queued",
      attempts: 0,
      data,
      phone: { region: data.region, mobile: data.mobile },
      logger,
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

    job.retrieveLogger = new DebugLogger(jobId, "retrieve");
    job.retrieveLogger.push("info", "queue", "Retrieve queued", { pinLen: pin.length });

    this.update(jobId, { status: "retrieving", message: "Retrieving QR from MDAC site..." });
    void this.runRetrieve(jobId, pin);
  }

  // ---- Internal workers ----

  private async runAutoSubmit(jobId: string): Promise<void> {
    this.inFlight++;
    let browser: Browser | null = null;
    let page: Page | null = null;
    const job = this.jobs.get(jobId);
    if (!job) {
      this.inFlight--;
      return;
    }
    const log = job.logger;

    try {
      this.update(jobId, { status: "filling", message: "Opening MDAC site..." });

      log.push("info", "browser.launch", "Launching headless Chromium");
      browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });
      page = await ctx.newPage();
      page.setDefaultTimeout(NAV_TIMEOUT_MS);

      this.update(jobId, { message: "Filling out form..." });
      await fillForm(page, job.data, log);

      // Try the auto-solver up to N times. After each fail, recapture the
      // CAPTCHA (the site usually serves a fresh image after a wrong drag).
      let solved = false;
      let lastError = "";
      for (let attempt = 1; attempt <= MAX_SOLVER_ATTEMPTS; attempt++) {
        const a = log.attempt(attempt);
        a.capturedAt = Date.now();
        this.update(jobId, {
          status: "solving",
          message: `Solving CAPTCHA (attempt ${attempt}/${MAX_SOLVER_ATTEMPTS})...`,
          attempts: attempt,
        });

        const captcha = await captureCaptcha(page, log);
        a.captchaBgBase64 = captcha.imageBase64;
        a.captchaBgWidth = captcha.width;
        a.captchaBgHeight = captcha.height;
        a.captchaBlockBase64 = captcha.blockImageBase64;
        a.blockOffsetX = captcha.blockOffsetX;

        const captchaBuf = Buffer.from(captcha.imageBase64, "base64");
        const blockBuf = captcha.blockImageBase64
          ? Buffer.from(captcha.blockImageBase64, "base64")
          : undefined;
        const solver = await solveSliderCaptcha({
          background: captchaBuf,
          block: blockBuf,
          blockOffsetX: captcha.blockOffsetX,
        });
        a.solver = solver;

        log.push(
          "info",
          "solver.result",
          `attempt ${attempt} dragX=${solver.dragX} confidence=${solver.confidence.toFixed(2)} method=${solver.debug.method}`,
          { solver: solver.debug }
        );
        console.log(
          `[job ${jobId}] solver attempt ${attempt}: dragX=${solver.dragX} ` +
            `confidence=${solver.confidence.toFixed(2)} method=${solver.debug.method} ` +
            `debug=${JSON.stringify(solver.debug)}`
        );

        if (solver.confidence < 0.2 && attempt === MAX_SOLVER_ATTEMPTS) {
          lastError = "CAPTCHA solver couldn't lock onto the puzzle (low confidence).";
          log.push("error", "solver.lowconf",
            `Final attempt has confidence ${solver.confidence.toFixed(2)} < 0.2 — giving up`);
          break;
        }

        this.update(jobId, { status: "submitting", message: "Dragging slider + submitting..." });
        a.dragX = solver.dragX;
        const submitResult = await dragAndSubmit(page, solver, log, attempt);
        a.submitOk = submitResult.success;
        a.submitError = submitResult.error;
        a.retryable = submitResult.retryable;

        if (submitResult.success) {
          solved = true;
          break;
        }

        lastError = submitResult.error || "Submit failed";
        log.push(
          submitResult.retryable ? "warn" : "error",
          "submit.failed",
          `attempt ${attempt} failed: ${lastError} (retryable=${submitResult.retryable ?? false})`
        );
        // If MDAC says the CAPTCHA was wrong and gave a retry, loop
        if (!submitResult.retryable) break;
        await page.waitForTimeout(800);
      }

      if (!solved) {
        await log.capture("auto-failed", page);
        this.update(jobId, {
          status: "failed",
          error: `Auto-submit failed after ${MAX_SOLVER_ATTEMPTS} attempts. Last error: ${lastError}`,
          message: "Auto-submit failed.",
        });
        return;
      }

      await log.capture("auto-submitted", page);
      this.update(jobId, {
        status: "submitted",
        message: "Submitted! Check your email for the PIN, then enter it below.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.push("error", "auto.exception", msg);
      await log.capture("auto-exception", page);
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
      const result = await retrieveQR(`+${job.phone.region}`, job.phone.mobile, pin, job.retrieveLogger);

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
      const job = this.jobs.get(jobId);
      job?.retrieveLogger?.push("error", "retrieve.exception", msg);
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
  solver: SolverResult,
  logger?: DebugLogger,
  attempt?: number
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
  let matchedSelector = "";
  for (const sel of handleSelectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0 && (await loc.isVisible())) {
      handle = loc;
      matchedSelector = sel;
      break;
    }
  }
  if (!handle) {
    logger?.push("error", "drag.no-handle", "Slider handle not found", { tried: handleSelectors });
    return { success: false, error: "Slider handle not found", retryable: false };
  }
  logger?.push("info", "drag.handle", `Slider handle: ${matchedSelector}`, { attempt });

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
  logger?.push("info", "drag.done",
    `Drag complete: dragX=${solver.dragX} steps=${steps}`, { attempt, target, overshoot });

  const errorEl = page.locator('.alert-danger, .error, [class*="error"], [class*="alert-danger"]');
  if ((await errorEl.count()) > 0) {
    const text = (await errorEl.first().textContent())?.trim() || "Submit error";
    const lower = text.toLowerCase();
    const retryable =
      lower.includes("captcha") || lower.includes("verification") || lower.includes("slider");
    logger?.push("warn", "drag.error",
      `Error after drag: "${text}" (retryable=${retryable})`, { attempt });
    return { success: false, error: text, retryable };
  }

  // Click submit
  const submitBtn = page.locator(
    'button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Confirm"), button:has-text("Register")'
  );
  const submitCount = await submitBtn.count();
  logger?.push("info", "submit.click", `Clicking submit button (count=${submitCount})`, { attempt });
  if (submitCount > 0) {
    await submitBtn.first().click();
  }

  const successEl = await page
    .waitForSelector(
      '.success, .alert-success, [class*="success"], [class*="confirmation"], h2:has-text("Thank"), h2:has-text("Success"), p:has-text("PIN")',
      { timeout: 30_000 }
    )
    .catch(() => null);

  const pageUrl = page.url();
  const pageTitle = await page.title().catch(() => "");
  if (successEl) {
    logger?.push("info", "submit.success-selector", "Success selector found on page", {
      attempt, url: pageUrl, title: pageTitle,
    });
  } else {
    logger?.push("warn", "submit.no-success-selector",
      "No success selector matched after 30s — checking for errors", {
        attempt, url: pageUrl, title: pageTitle,
      });
  }

  const errorAfterSubmit = page.locator('.alert-danger, .error, [class*="error"]');
  if ((await errorAfterSubmit.count()) > 0) {
    const text = (await errorAfterSubmit.first().textContent())?.trim() || "Submit error";
    const lower = text.toLowerCase();
    const retryable =
      lower.includes("captcha") || lower.includes("verification") || lower.includes("slider");
    logger?.push("warn", "submit.error",
      `Error after submit click: "${text}" (retryable=${retryable})`, { attempt, url: pageUrl });
    return { success: false, error: text, retryable };
  }

  logger?.push("info", "submit.ok", "No error indicators after submit click — assuming success", {
    attempt, url: pageUrl, title: pageTitle,
  });
  return { success: true };
}

export const jobManager = new JobManager();
