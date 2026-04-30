/**
 * Slider-CAPTCHA solver for the MDAC "block puzzle" widget.
 *
 * The widget renders two canvases:
 *   - Background canvas (~271x155): photo with a notch cut at some x.
 *   - Block canvas (~63x155): the moveable puzzle piece, transparent
 *     except for the piece silhouette, sitting at the left edge of the
 *     widget.
 *
 * Best algorithm — template matching (used when both canvases are captured):
 *   1. Edge-detect the block (the piece's silhouette outline).
 *   2. Edge-detect the background (notch outline + image content).
 *   3. Slide the block-edges horizontally across the background-edges.
 *      At each x, sum (block_edge[x',y] * bg_edge[x+x',y]) over all (x',y).
 *      The notch's outline matches the block's outline best — peak score.
 *   4. dragX = best x − blockOffsetX (drag from current position to target).
 *
 * Fallback — column-projection peak finding (when block isn't captured):
 *   double-edge search restricted away from the piece's start position.
 *
 * Pure-JS via Jimp — no native deps for Railway.
 */

import { Jimp } from "jimp";

export interface SolverResult {
  /** Pixels to drag the slider handle, relative to its starting position. */
  dragX: number;
  /** 0..1 — how confident we are. < 0.3 means "probably wrong". */
  confidence: number;
  debug: {
    imageWidth: number;
    imageHeight: number;
    blockWidth?: number;
    method:
      | "template-match"
      | "double-edge"
      | "single-peak"
      | "darkness-fallback"
      | "fallback-center";
    matchX?: number;
    matchScore?: number;
    runnerUpScore?: number;
    bbox?: { x: number; y: number; w: number; h: number };
    opaquePixels?: number;
    edgePixels?: number;
    leftPeak?: { x: number; score: number };
    rightPeak?: { x: number; score: number };
    spacing?: number;
    topPeaks?: Array<{ x: number; score: number }>;
  };
}

const SOBEL_X = [
  [-1, 0, 1],
  [-2, 0, 2],
  [-1, 0, 1],
];

const NOTCH_MIN_WIDTH = 35;
const NOTCH_MAX_WIDTH = 75;
const PIECE_SAFETY_BAND = 55;

export interface SolverInput {
  background: Buffer;
  block?: Buffer;
  blockOffsetX?: number;
}

/**
 * Solve the CAPTCHA. Pass `{ background, block, blockOffsetX }` for the best
 * result; passing only `{ background }` falls back to the column-edge heuristic.
 */
export async function solveSliderCaptcha(
  input: Buffer | SolverInput
): Promise<SolverResult> {
  const params: SolverInput =
    Buffer.isBuffer(input) ? { background: input } : input;

  if (params.block) {
    const tm = await templateMatch(params.background, params.block, params.blockOffsetX ?? 0);
    if (tm) return tm;
  }

  return columnEdgeFallback(params.background);
}

// ---------- Template matching (preferred path) ----------

async function templateMatch(
  bgBuf: Buffer,
  blockBuf: Buffer,
  blockOffsetX: number
): Promise<SolverResult | null> {
  const bg = await Jimp.read(bgBuf);
  const block = await Jimp.read(blockBuf);

  const bgW = bg.bitmap.width;
  const bgH = bg.bitmap.height;
  const bw = block.bitmap.width;
  const bh = block.bitmap.height;

  // Find the block's bbox of non-transparent pixels — the actual puzzle silhouette.
  const bbox = nonTransparentBBox(block);
  if (!bbox) return null;

  // Build interior mask (inside the silhouette) and a thin outer rim mask
  // (1–4px outside the silhouette). The notch is darker INSIDE than its
  // immediate surroundings — score = outside_avg − inside_avg, peak = notch.
  //
  // We don't use Sobel-edge correlation here because vertical edges in the
  // photo content (wooden boards, building outlines, wave edges) compete
  // with the soft notch outline. The inside-vs-outside luminance test is
  // specific to the puzzle-shaped darker region.
  const alphaMask = new Uint8Array(bw * bh);
  let opaquePixelCount = 0;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const idx = (y * bw + x) * 4;
      const a = block.bitmap.data[idx + 3];
      if (a > 200) {
        alphaMask[y * bw + x] = 1;
        opaquePixelCount++;
      }
    }
  }

  // Inside mask in bbox coordinates
  const insideMask = new Uint8Array(bbox.w * bbox.h);
  let insideCount = 0;
  for (let y = 0; y < bbox.h; y++) {
    for (let x = 0; x < bbox.w; x++) {
      const gy = bbox.y + y;
      const gx = bbox.x + x;
      if (alphaMask[gy * bw + gx]) {
        insideMask[y * bbox.w + x] = 1;
        insideCount++;
      }
    }
  }

  // Outer-rim mask: pixels within 3px outside the silhouette but inside bbox+pad.
  // We expand the working area by RIM_PAD so we can sample pixels outside the bbox.
  const RIM_PAD = 4;
  const rimW = bbox.w + 2 * RIM_PAD;
  const rimH = bbox.h + 2 * RIM_PAD;
  const rimMask = new Uint8Array(rimW * rimH);
  let rimCount = 0;
  for (let ry = 0; ry < rimH; ry++) {
    for (let rx = 0; rx < rimW; rx++) {
      // Position in bbox coords (can be negative or beyond bbox.w)
      const bxX = rx - RIM_PAD;
      const bxY = ry - RIM_PAD;
      // Skip if INSIDE silhouette
      if (
        bxX >= 0 &&
        bxX < bbox.w &&
        bxY >= 0 &&
        bxY < bbox.h &&
        insideMask[bxY * bbox.w + bxX]
      ) {
        continue;
      }
      // Mark rim if there's any inside-mask pixel within RIM_PAD pixels
      let nearInside = false;
      for (let dy = -RIM_PAD; dy <= RIM_PAD && !nearInside; dy++) {
        for (let dx = -RIM_PAD; dx <= RIM_PAD; dx++) {
          if (dx * dx + dy * dy > RIM_PAD * RIM_PAD) continue;
          const ix = bxX + dx;
          const iy = bxY + dy;
          if (ix < 0 || iy < 0 || ix >= bbox.w || iy >= bbox.h) continue;
          if (insideMask[iy * bbox.w + ix]) {
            nearInside = true;
            break;
          }
        }
      }
      if (nearInside) {
        rimMask[ry * rimW + rx] = 1;
        rimCount++;
      }
    }
  }

  // Greyscale + Sobel-edge versions of bg for fast access during slide.
  const bgGrey = bg.clone();
  bgGrey.greyscale();
  const bgGreyData = bgGrey.bitmap.data;
  const bgEdges = bg.clone();
  bgEdges.greyscale();
  bgEdges.convolute(SOBEL_X);
  const bgEdgeData = bgEdges.bitmap.data;

  function readBgGrey(x: number, y: number): number {
    if (x < 0 || x >= bgW || y < 0 || y >= bgH) return -1;
    return bgGreyData[(y * bgW + x) * 4];
  }
  function readBgEdge(x: number, y: number): number {
    if (x < 0 || x >= bgW || y < 0 || y >= bgH) return 0;
    return bgEdgeData[(y * bgW + x) * 4];
  }

  // Compute a thin BOUNDARY mask (silhouette outline pixels only).
  const boundaryMask = new Uint8Array(bbox.w * bbox.h);
  let boundaryCount = 0;
  for (let y = 0; y < bbox.h; y++) {
    for (let x = 0; x < bbox.w; x++) {
      const idx = y * bbox.w + x;
      if (!insideMask[idx]) continue;
      // boundary if any 4-neighbor is outside the silhouette
      let isBoundary = false;
      for (const [dy, dx] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= bbox.w || ny >= bbox.h) {
          isBoundary = true;
          break;
        }
        if (!insideMask[ny * bbox.w + nx]) {
          isBoundary = true;
          break;
        }
      }
      if (isBoundary) {
        boundaryMask[idx] = 1;
        boundaryCount++;
      }
    }
  }

  // Slide the (template, rim) pair horizontally. At each x, compute:
  //   inside_mean = avg of bg pixels under inside-mask
  //   outside_mean = avg of bg pixels under rim-mask
  //   score = outside_mean − inside_mean   (larger = darker hole, brighter rim)
  // The notch should produce a strong positive score; flat photo regions ~0.
  // We also count how many of the rim/inside pixels actually fell inside the
  // bg image (some at the edges fall off) and skip if too few.
  const edgeCount = rimCount; // for debug/back-compat field

  // Search range: from past the piece's start to bgW - bbox.w.
  const searchLo = Math.max(0, blockOffsetX + PIECE_SAFETY_BAND);
  const searchHi = bgW - bbox.w;

  let bestX = -1;
  let bestScore = -Infinity;
  let runnerUp = -Infinity;

  for (let x = searchLo; x < searchHi; x++) {
    let insideSum = 0;
    let insideN = 0;
    let outsideSum = 0;
    let outsideN = 0;

    // Inside pixels
    for (let yy = 0; yy < bbox.h; yy++) {
      const targetY = bbox.y + yy;
      if (targetY < 0 || targetY >= bgH) continue;
      for (let xx = 0; xx < bbox.w; xx++) {
        const tIdx = yy * bbox.w + xx;
        if (!insideMask[tIdx]) continue;
        const v = readBgGrey(x + xx, targetY);
        if (v < 0) continue;
        insideSum += v;
        insideN++;
      }
    }
    if (insideN < 50) continue;

    // Outer rim pixels
    for (let ry = 0; ry < rimH; ry++) {
      const targetY = bbox.y + ry - RIM_PAD;
      if (targetY < 0 || targetY >= bgH) continue;
      for (let rx = 0; rx < rimW; rx++) {
        const rIdx = ry * rimW + rx;
        if (!rimMask[rIdx]) continue;
        const v = readBgGrey(x + rx - RIM_PAD, targetY);
        if (v < 0) continue;
        outsideSum += v;
        outsideN++;
      }
    }
    if (outsideN < 30) continue;

    const insideMean = insideSum / insideN;
    const outsideMean = outsideSum / outsideN;
    // The MDAC CAPTCHA renders the destination notch as a translucent
    // white puzzle-shaped overlay → INSIDE is BRIGHTER than the surrounding
    // photo. Use absolute luminance contrast so we still pick up the rare
    // dark-hole variant if MDAC ever changes the render.
    const lumContrast = Math.abs(insideMean - outsideMean);
    if (lumContrast <= 2) continue;

    // Edge strength along the silhouette boundary — distinguishes the
    // puzzle-piece-shaped notch from arbitrary dark blobs (wooden railings,
    // shadows). A real notch has high edge magnitude EXACTLY at the puzzle
    // outline; a flat dark region does not.
    let edgeSum = 0;
    let edgeN = 0;
    for (let yy = 0; yy < bbox.h; yy++) {
      const targetY = bbox.y + yy;
      if (targetY < 0 || targetY >= bgH) continue;
      for (let xx = 0; xx < bbox.w; xx++) {
        const tIdx = yy * bbox.w + xx;
        if (!boundaryMask[tIdx]) continue;
        const e = readBgEdge(x + xx, targetY);
        edgeSum += e;
        edgeN++;
      }
    }
    if (edgeN < 20) continue;
    const edgeMean = edgeSum / edgeN;

    // Combined score: luminance contrast × edge-on-silhouette. Both must be
    // strong for the location to win.
    const score = lumContrast * (edgeMean + 5);

    if (score > bestScore) {
      runnerUp = bestScore;
      bestScore = score;
      bestX = x;
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  if (bestX < 0) return null;

  // dragX = how far to move the block. Block currently sits at blockOffsetX
  // (in background coordinates), and we want its left edge to land at
  // bestX - bbox.x (the silhouette's offset within the block canvas).
  const targetBlockLeftEdge = bestX - bbox.x;
  const dragX = Math.max(0, targetBlockLeftEdge - blockOffsetX);

  // Confidence: ratio of best to runner-up, scaled. Score range is now
  // wider (lumDip * (edgeMean+5)) so we use ratio rather than absolute.
  const ratio = runnerUp > 0 ? bestScore / runnerUp : 3;
  const confidence = Math.min(1, Math.max(0, (ratio - 1.0) * 1.5));

  return {
    dragX,
    confidence,
    debug: {
      imageWidth: bgW,
      imageHeight: bgH,
      blockWidth: bw,
      method: "template-match",
      matchX: bestX,
      matchScore: Math.round(bestScore),
      runnerUpScore: Math.round(runnerUp),
      bbox,
      opaquePixels: opaquePixelCount,
      edgePixels: edgeCount,
    },
  };
}

interface JimpLike {
  bitmap: { width: number; height: number; data: Uint8Array | Buffer };
}

function nonTransparentBBox(
  img: JimpLike
): { x: number; y: number; w: number; h: number } | null {
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  let xMin = w;
  let xMax = -1;
  let yMin = h;
  let yMax = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const alpha = img.bitmap.data[idx + 3];
      if (alpha > 100) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
  }
  if (xMax < 0) return null;
  return { x: xMin, y: yMin, w: xMax - xMin + 1, h: yMax - yMin + 1 };
}

// ---------- Column-edge fallback ----------

async function columnEdgeFallback(bgBuf: Buffer): Promise<SolverResult> {
  const img = await Jimp.read(bgBuf);
  const w = img.bitmap.width;
  const h = img.bitmap.height;

  img.greyscale();
  img.convolute(SOBEL_X);

  const colSums = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      colSums[x] += img.bitmap.data[idx];
    }
  }

  const lo = Math.max(PIECE_SAFETY_BAND, 5);
  const hi = w - 5;

  const peaks = findTopPeaks(colSums, lo, hi, 8, 6);
  const median = quickMedian(Array.from(colSums.slice(lo, hi)));

  let best: { left: Peak; right: Peak; score: number } | null = null;
  for (let i = 0; i < peaks.length; i++) {
    for (let j = i + 1; j < peaks.length; j++) {
      const a = peaks[i];
      const b = peaks[j];
      const left = a.x < b.x ? a : b;
      const right = a.x < b.x ? b : a;
      const spacing = right.x - left.x;
      if (spacing < NOTCH_MIN_WIDTH || spacing > NOTCH_MAX_WIDTH) continue;
      const score = a.score + b.score;
      if (!best || score > best.score) best = { left, right, score };
    }
  }

  if (best) {
    const dragX = best.left.x;
    const dominance = best.score / (2 * Math.max(median, 1));
    const confidence = Math.min(1, Math.max(0, (dominance - 1.5) / 3));
    return {
      dragX,
      confidence,
      debug: {
        imageWidth: w,
        imageHeight: h,
        method: "double-edge",
        leftPeak: best.left,
        rightPeak: best.right,
        spacing: best.right.x - best.left.x,
        topPeaks: peaks.slice(0, 6),
      },
    };
  }

  if (peaks.length > 0) {
    const top = peaks[0];
    const dominance = top.score / Math.max(median, 1);
    const confidence = Math.min(0.5, Math.max(0, (dominance - 1.5) / 4));
    return {
      dragX: top.x,
      confidence,
      debug: {
        imageWidth: w,
        imageHeight: h,
        method: "single-peak",
        leftPeak: top,
        topPeaks: peaks.slice(0, 6),
      },
    };
  }

  return {
    dragX: Math.floor(w / 2),
    confidence: 0,
    debug: { imageWidth: w, imageHeight: h, method: "fallback-center" },
  };
}

interface Peak {
  x: number;
  score: number;
}

function findTopPeaks(
  values: Float64Array,
  lo: number,
  hi: number,
  topN: number,
  minSeparation: number
): Peak[] {
  const candidates: Peak[] = [];
  for (let x = lo + 1; x < hi - 1; x++) {
    const v = values[x];
    if (v > values[x - 1] && v >= values[x + 1]) {
      candidates.push({ x, score: v });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen: Peak[] = [];
  for (const c of candidates) {
    if (chosen.every((p) => Math.abs(p.x - c.x) >= minSeparation)) {
      chosen.push(c);
      if (chosen.length >= topN) break;
    }
  }
  return chosen;
}

function quickMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
