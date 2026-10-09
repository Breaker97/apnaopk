/**
 * The shape of a quoted lot's ceiling, and the one check made against it.
 *
 * Kept apart from lib/quotes/quote-lot.ts, which works the ceiling out: that
 * module reads the pre-order rules, and they import the models. The admin's
 * send-price dialog re-checks the quantity on every keystroke, so the check
 * itself has to be importable from a client component.
 */

export type QuoteLotReason =
  | "stock"
  | "untracked"
  | "preorder"
  | "needs_variant"
  | "unavailable";

export type QuoteLotLimit = {
  /** The most units one order can take; null when nothing caps it. */
  max: number | null;
  reason: QuoteLotReason;
};

/** Whether one order can take `quantity` units under this limit. */
export function lotFits(limit: QuoteLotLimit, quantity: number): boolean {
  if (limit.reason === "needs_variant" || limit.reason === "unavailable") {
    return false;
  }
  return limit.max === null || quantity <= limit.max;
}
