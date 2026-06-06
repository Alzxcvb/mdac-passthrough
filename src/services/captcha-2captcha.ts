/**
 * 2Captcha fallback for the MDAC slider CAPTCHA.
 *
 * The local Jimp solver (captcha-solver.ts) lands the gap location ~50% of the
 * time per attempt. This module escalates to 2Captcha's human-backed
 * CoordinatesTask: we send the background image, a worker clicks the center of
 * the gap, and we convert that click into a `dragX` using the EXACT same
 * geometry as the local solver — so this path is correct if and only if the
 * local path's convention is. The first real submission validates both at once.
 *
 * Disabled (returns null) when:
 *   - TWOCAPTCHA_API_KEY is not set, or
 *   - the block (puzzle-piece) image wasn't captured — without it we can't map
 *     a gap-center click to a left-edge drag, so we don't guess.
 *
 * No new dependencies: uses Node 18+ global fetch.
 *
 * API: https://2captcha.com/api-docs/coordinates
 *   POST https://api.2captcha.com/createTask     -> { errorId, taskId }
 *   POST https://api.2captcha.com/getTaskResult  -> { errorId, status, solution: { coordinates: [{x,y}] } }
 */

import { Jimp } from "jimp";
import { nonTransparentBBox, type SolverInput, type SolverResult } from "./captcha-solver";
import type { DebugLogger } from "./debug";

const API_BASE = "https://api.2captcha.com";
const CREATE_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 4_000;
const POLL_MAX_ATTEMPTS = 24; // ~96s ceiling

const WORKER_INSTRUCTION =
  "This is a slider puzzle. Click the exact center of the empty notch/gap where " +
  "the puzzle piece should be dragged to. Click only the gap, not the piece on the left.";

export function is2CaptchaEnabled(): boolean {
  return Boolean(process.env.TWOCAPTCHA_API_KEY);
}

/**
 * Solve the MDAC slider via 2Captcha and return a SolverResult shaped exactly
 * like the local solver (dragX relative to the handle's start, same units).
 * Returns null when disabled, when the block image is missing, or on any API
 * failure — callers should fall back to the local solver result.
 */
export async function solveWith2Captcha(
  input: SolverInput,
  logger?: DebugLogger
): Promise<SolverResult | null> {
  const apiKey = process.env.TWOCAPTCHA_API_KEY;
  if (!apiKey) {
    logger?.push("info", "2captcha.skip", "TWOCAPTCHA_API_KEY not set — skipping fallback");
    return null;
  }
  if (!input.block) {
    logger?.push(
      "warn",
      "2captcha.skip",
      "No block image captured — can't map gap-center to dragX, skipping 2Captcha"
    );
    return null;
  }

  // Silhouette bbox within the block canvas — same geometry the local solver uses.
  const block = await Jimp.read(input.block);
  const bbox = nonTransparentBBox(block);
  if (!bbox) {
    logger?.push("warn", "2captcha.skip", "Block silhouette bbox empty — skipping 2Captcha");
    return null;
  }
  const blockOffsetX = input.blockOffsetX ?? 0;

  try {
    const taskId = await createTask(apiKey, input.background.toString("base64"));
    logger?.push("info", "2captcha.created", `2Captcha task created`, { taskId });

    const coord = await pollResult(apiKey, taskId, logger);
    if (!coord) {
      logger?.push("error", "2captcha.timeout", "2Captcha returned no coordinate in time");
      return null;
    }

    // Worker clicked the gap CENTER. Convert to the silhouette's target left
    // edge, then apply the IDENTICAL formula as templateMatch():
    //   targetBlockLeftEdge = bestX - bbox.x
    //   dragX = max(0, targetBlockLeftEdge - blockOffsetX)
    const bestX = coord.x - bbox.w / 2;
    const targetBlockLeftEdge = bestX - bbox.x;
    const dragX = Math.max(0, Math.round(targetBlockLeftEdge - blockOffsetX));

    logger?.push(
      "info",
      "2captcha.solved",
      `2Captcha gap center=(${coord.x},${coord.y}) -> dragX=${dragX}`,
      { gapX: coord.x, gapY: coord.y, bbox, blockOffsetX, dragX }
    );

    return {
      dragX,
      confidence: 0.9, // human-backed; clears the local low-confidence gate
      debug: {
        imageWidth: 0,
        imageHeight: 0,
        method: "2captcha",
        matchX: Math.round(bestX),
        bbox,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.push("error", "2captcha.error", `2Captcha request failed: ${msg}`);
    return null;
  }
}

async function createTask(apiKey: string, imageBase64: string): Promise<string> {
  const res = await fetch(`${API_BASE}/createTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: apiKey,
      task: {
        type: "CoordinatesTask",
        body: imageBase64,
        comment: WORKER_INSTRUCTION,
      },
    }),
    signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
  });
  const json = (await res.json()) as { errorId?: number; errorDescription?: string; taskId?: number };
  if (json.errorId && json.errorId !== 0) {
    throw new Error(`createTask errorId=${json.errorId} ${json.errorDescription ?? ""}`.trim());
  }
  if (!json.taskId) throw new Error("createTask returned no taskId");
  return String(json.taskId);
}

interface Coordinate {
  x: number;
  y: number;
}

async function pollResult(
  apiKey: string,
  taskId: string,
  logger?: DebugLogger
): Promise<Coordinate | null> {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetch(`${API_BASE}/getTaskResult`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, taskId: Number(taskId) }),
      signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
    });
    const json = (await res.json()) as {
      errorId?: number;
      errorDescription?: string;
      status?: string;
      solution?: { coordinates?: Coordinate[] };
    };
    if (json.errorId && json.errorId !== 0) {
      throw new Error(`getTaskResult errorId=${json.errorId} ${json.errorDescription ?? ""}`.trim());
    }
    if (json.status === "ready") {
      const coords = json.solution?.coordinates;
      if (coords && coords.length > 0) return coords[0];
      throw new Error("getTaskResult ready but coordinates array empty");
    }
    logger?.push("info", "2captcha.poll", `poll ${i + 1}/${POLL_MAX_ATTEMPTS}: ${json.status}`);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
