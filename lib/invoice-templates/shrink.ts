/**
 * Shrink-to-fit maths (docs/INVOICE_TEMPLATE_BUILDER.md §5.6): a text
 * element with `shrinkToFit` prints at the largest size, down to 6 px, at
 * which its text fits its box; below that it wraps and clips, and the Review
 * tab warns. The renderer supplies `fits(px)` from a DOM measurement; this
 * module only searches, so it is testable without one.
 *
 * Client-safe.
 */

export const MIN_FONT_PX = 6;
export const FONT_STEP_PX = 0.5;

export interface FitResult {
  /** The size to print at. */
  px: number;
  /** False when even the minimum overflows (then wrap and clip, and warn). */
  fits: boolean;
}

/**
 * The largest size in `[minPx, basePx]` (in `stepPx` steps) for which
 * `fits(px)` holds. `fits` must be monotonic: once a size overflows, every
 * larger size does too. Never larger than designed: the minimum only limits
 * shrinking, so text designed below it prints at its own size.
 */
export function fitFontSize(basePx: number, fits: (px: number) => boolean, minPx = MIN_FONT_PX, stepPx = FONT_STEP_PX): FitResult {
  if (basePx <= minPx) return { px: basePx, fits: fits(basePx) };
  const base = basePx;
  if (fits(base)) return { px: base, fits: true };
  if (!fits(minPx)) return { px: minPx, fits: false };
  // Binary search over the steps between min (fits) and base (doesn't).
  let low = 0; // step index that fits
  let high = Math.ceil((base - minPx) / stepPx); // step index that doesn't
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (fits(Math.min(base, minPx + mid * stepPx))) low = mid;
    else high = mid;
  }
  return { px: Math.min(base, minPx + low * stepPx), fits: true };
}
