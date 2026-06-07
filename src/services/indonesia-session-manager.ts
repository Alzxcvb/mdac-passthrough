/**
 * Session-relay manager for the Indonesia (All-Indonesia) arrival card.
 *
 * Mirrors session-manager.ts (the MDAC relay), but the human's contribution is
 * different. MDAC needs the user to solve a slider CAPTCHA; Indonesia's captcha
 * is machine-solvable (JWT-decoded), so the user's role shifts to **reviewing
 * the filled form and authorizing the final submit** — a better posture for
 * filing a government record than silent auto-submit.
 *
 * Lifecycle:
 *   createSession(traveler)  -> launch browser, fill steps 1-3 + declaration,
 *                               screenshot the page, keep the browser alive,
 *                               return { sessionId, submissionId, reviewImage }.
 *   confirm(sessionId)       -> user authorized: click Submit (GATED behind
 *                               INDONESIA_LIVE_SUBMIT + a selector recon pass),
 *                               return the QR or an honest "blocked" outcome.
 *
 * In-memory only, like the MDAC session manager — a container restart drops
 * live sessions. Acceptable for MVP.
 */

import { randomUUID } from "crypto";
import { chromium, type Browser, type Page } from "playwright";
import {
  fillIndonesiaToDeclaration,
  submitIndonesiaDeclaration,
  generateSubmissionId,
  type ArrivalPassTraveler,
} from "../adapters/indonesia";
import type {
  IndonesiaSessionStartResponse,
  IndonesiaConfirmResponse,
  IndonesiaSessionStatus,
  IndonesiaSessionStatusValue,
} from "../types";

const MAX_SESSIONS = 5;
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 min — fill + human review takes longer than MDAC
const CLEANUP_INTERVAL_MS = 60 * 1000;

interface IdSessionState {
  id: string;
  submissionId: string;
  browser: Browser;
  page: Page;
  status: IndonesiaSessionStatusValue;
  error?: string;
  createdAt: number;
}

class IndonesiaSessionManager {
  private sessions = new Map<string, IdSessionState>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

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
    return this.sessions.size;
  }

  /**
   * Fill the Indonesia form through the declaration step and screenshot it for
   * the user to review. Keeps the browser alive pending authorization.
   */
  async createSession(
    traveler: ArrivalPassTraveler
  ): Promise<IndonesiaSessionStartResponse> {
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error("Server busy — too many active sessions. Please try again shortly.");
    }

    const id = randomUUID();
    const submissionId = generateSubmissionId();
    let browser: Browser | null = null;

    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);

      await fillIndonesiaToDeclaration(page, traveler);

      const shot = await page.screenshot({ type: "png", fullPage: true });

      const session: IdSessionState = {
        id,
        submissionId,
        browser,
        page,
        status: "waiting_review",
        createdAt: Date.now(),
      };
      this.sessions.set(id, session);
      console.log(`[id-session] Created ${id} (${this.sessions.size} active)`);

      return {
        sessionId: id,
        submissionId,
        reviewImageBase64: shot.toString("base64"),
      };
    } catch (err) {
      if (browser) await browser.close().catch(() => {});
      throw err;
    }
  }

  /**
   * User authorized the submit. Click the final Submit (gated) and return the
   * QR or an honest "blocked" outcome when the recon pass is still pending.
   */
  async confirm(sessionId: string): Promise<IndonesiaConfirmResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, status: "expired", error: "Session not found or expired" };
    }
    if (session.status !== "waiting_review") {
      return { success: false, status: session.status, error: `Invalid session state: ${session.status}` };
    }

    session.status = "submitting";
    try {
      const result = await submitIndonesiaDeclaration(session.page, session.submissionId);

      if (result.status === "submitted") {
        session.status = "submitted";
        await this.destroySession(sessionId);
        return { success: true, status: "submitted", qrUrl: result.qrUrl };
      }

      if (result.status === "blocked-pre-submit") {
        // Recon pass pending — be honest, don't pretend it filed.
        session.status = "blocked";
        await this.destroySession(sessionId);
        return {
          success: false,
          status: "blocked",
          message:
            "Indonesia filing is wired but the final submit is gated pending a " +
            "selector recon pass. Your details were filled through the declaration step.",
        };
      }

      session.status = "error";
      session.error = result.error;
      await this.destroySession(sessionId);
      return { success: false, status: "error", error: result.error || "Submit failed" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      session.status = "error";
      session.error = msg;
      await this.destroySession(sessionId);
      return { success: false, status: "error", error: `Submit failed: ${msg}` };
    }
  }

  getStatus(sessionId: string): IndonesiaSessionStatus {
    const session = this.sessions.get(sessionId);
    if (!session) return { status: "expired" };
    return { status: session.status, error: session.error };
  }

  async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    await session.browser.close().catch(() => {});
    console.log(`[id-session] Destroyed ${sessionId} (${this.sessions.size} active)`);
  }

  private async cleanup(): Promise<void> {
    const now = Date.now();
    const expired: string[] = [];
    for (const [id, session] of this.sessions) {
      if (now - session.createdAt > SESSION_TTL_MS) expired.push(id);
    }
    for (const id of expired) {
      console.log(`[id-session] Expiring ${id}`);
      await this.destroySession(id);
    }
  }
}

export const indonesiaSessionManager = new IndonesiaSessionManager();
