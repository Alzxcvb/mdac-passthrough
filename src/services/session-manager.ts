import { randomUUID } from "crypto";
import { chromium, type Browser, type Page } from "playwright";
import { fillForm, captureCaptcha, solveCaptchaAndSubmit, type CaptchaCapture } from "./mdac";
import {
  type MdacFormData,
  type SessionStartResponse,
  type SessionStatus,
  type CaptchaSolveResponse,
} from "../types";

const MAX_SESSIONS = 5;
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // check every 60s

interface SessionState {
  id: string;
  browser: Browser;
  page: Page;
  captcha: CaptchaCapture;
  status: SessionStatus["status"];
  error?: string;
  createdAt: number;
}

class SessionManager {
  private sessions = new Map<string, SessionState>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** Start the background cleanup loop. */
  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  /** Stop the cleanup loop (for graceful shutdown). */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** How many sessions are alive right now. */
  get activeCount(): number {
    return this.sessions.size;
  }

  /**
   * Create a new session: launch a browser, fill the form, screenshot the
   * CAPTCHA, and keep the browser alive waiting for the user to solve it.
   */
  async createSession(data: MdacFormData): Promise<SessionStartResponse> {
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error("Server busy — too many active sessions. Please try again shortly.");
    }

    const id = randomUUID();
    let browser: Browser | null = null;

    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);

      // Fill the form — stops before CAPTCHA
      await fillForm(page, data);

      // Screenshot the CAPTCHA
      const captcha = await captureCaptcha(page);

      const session: SessionState = {
        id,
        browser,
        page,
        captcha,
        status: "waiting_captcha",
        createdAt: Date.now(),
      };
      this.sessions.set(id, session);

      console.log(`[session] Created ${id} (${this.sessions.size} active)`);

      return {
        sessionId: id,
        captchaImageBase64: captcha.imageBase64,
        captchaWidth: captcha.width,
        captchaHeight: captcha.height,
      };
    } catch (err) {
      // Clean up on failure
      if (browser) await browser.close().catch(() => {});
      throw err;
    }
  }

  /**
   * Solve the CAPTCHA for a session by replaying the slider drag,
   * then click Submit.
   */
  async solveCaptcha(sessionId: string, sliderX: number): Promise<CaptchaSolveResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: "Session not found or expired", retryable: false };
    }
    if (session.status !== "waiting_captcha") {
      return { success: false, error: `Invalid session state: ${session.status}`, retryable: false };
    }

    session.status = "solving";

    try {
      const result = await solveCaptchaAndSubmit(session.page, sliderX);

      if (result.success) {
        session.status = "submitted";
        // Close browser after successful submission
        await this.destroySession(sessionId);
        return { success: true, message: result.message };
      }

      // Submission failed
      if (result.retryable) {
        // Re-capture the CAPTCHA for another attempt
        try {
          const newCaptcha = await captureCaptcha(session.page);
          session.captcha = newCaptcha;
          session.status = "waiting_captcha";
          return {
            success: false,
            error: result.error,
            retryable: true,
            newCaptchaImageBase64: newCaptcha.imageBase64,
            newCaptchaWidth: newCaptcha.width,
            newCaptchaHeight: newCaptcha.height,
          };
        } catch {
          // Can't re-capture — destroy and tell frontend to start over
          await this.destroySession(sessionId);
          return { success: false, error: result.error, retryable: false };
        }
      }

      // Non-retryable error
      session.status = "error";
      session.error = result.error;
      await this.destroySession(sessionId);
      return { success: false, error: result.error, retryable: false };
    } catch (err) {
      session.status = "error";
      const message = err instanceof Error ? err.message : String(err);
      session.error = message;
      await this.destroySession(sessionId);
      return { success: false, error: `Solve failed: ${message}`, retryable: false };
    }
  }

  /** Get the status of a session. */
  getStatus(sessionId: string): SessionStatus {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { status: "expired" };
    }
    return { status: session.status, error: session.error };
  }

  /** Destroy a single session (close browser, remove from map). */
  async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    await session.browser.close().catch(() => {});
    console.log(`[session] Destroyed ${sessionId} (${this.sessions.size} active)`);
  }

  /** Close all expired sessions. */
  private async cleanup(): Promise<void> {
    const now = Date.now();
    const expired: string[] = [];

    for (const [id, session] of this.sessions) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        expired.push(id);
      }
    }

    for (const id of expired) {
      console.log(`[session] Expiring ${id}`);
      await this.destroySession(id);
    }
  }
}

// Singleton
export const sessionManager = new SessionManager();
