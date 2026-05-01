/**
 * Per-job debug logger. Captures a timeline of events plus per-attempt
 * captcha images and final-page state on error. Exposed via
 * GET /api/jobs/:id/debug for postmortem after a real run.
 */

import type { Page } from "playwright";
import type { SolverResult } from "./captcha-solver";

export type DebugLevel = "info" | "warn" | "error";

export interface DebugEvent {
  ts: number;
  level: DebugLevel;
  step: string;
  message: string;
  extra?: Record<string, unknown>;
}

export interface AttemptDebug {
  attempt: number;
  capturedAt?: number;
  captchaBgBase64?: string;
  captchaBlockBase64?: string;
  captchaBgWidth?: number;
  captchaBgHeight?: number;
  blockOffsetX?: number;
  solver?: SolverResult;
  dragX?: number;
  submitOk?: boolean;
  submitError?: string;
  retryable?: boolean;
}

export interface DebugBundle {
  jobId: string;
  createdAt: number;
  status: string;
  events: DebugEvent[];
  attempts: AttemptDebug[];
  finalScreenshotBase64?: string;
  finalHtmlSnippet?: string;
  retrieve?: {
    screenshotBase64?: string;
    htmlSnippet?: string;
    events: DebugEvent[];
  };
}

const HTML_SNIPPET_BYTES = 30_000;

export class DebugLogger {
  events: DebugEvent[] = [];
  attempts: AttemptDebug[] = [];
  finalScreenshotBase64?: string;
  finalHtmlSnippet?: string;

  constructor(private jobId: string, private scope: string = "auto") {}

  push(
    level: DebugLevel,
    step: string,
    message: string,
    extra?: Record<string, unknown>
  ): void {
    const ev: DebugEvent = { ts: Date.now(), level, step, message };
    if (extra && Object.keys(extra).length > 0) ev.extra = extra;
    this.events.push(ev);
    const tag = `[job ${this.jobId}/${this.scope}] [${step}]`;
    const args: unknown[] = [tag, message];
    if (extra) args.push(extra);
    if (level === "error") console.error(...args);
    else if (level === "warn") console.warn(...args);
    else console.log(...args);
  }

  attempt(n: number): AttemptDebug {
    let a = this.attempts.find((x) => x.attempt === n);
    if (!a) {
      a = { attempt: n, capturedAt: Date.now() };
      this.attempts.push(a);
    }
    return a;
  }

  async capture(label: string, page: Page | null | undefined): Promise<void> {
    if (!page) return;
    try {
      const buf = await page.screenshot({ type: "png", fullPage: false });
      this.finalScreenshotBase64 = buf.toString("base64");
      const html = await page.content().catch(() => "");
      this.finalHtmlSnippet = html.slice(0, HTML_SNIPPET_BYTES);
      this.push("info", "capture", `Captured page state at: ${label}`, {
        screenshotBytes: buf.length,
        htmlLen: html.length,
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.push("warn", "capture", `Capture failed at ${label}: ${m}`);
    }
  }
}
