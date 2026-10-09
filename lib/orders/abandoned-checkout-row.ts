import type { DashboardRange } from "@/lib/admin/dashboard-period";

/**
 * What the Abandoned checkouts list and its export read off a row, kept free of
 * models and the database so the date filter and the CSV can be tested on plain
 * objects.
 */

interface AbandonedDated {
  abandonedAt?: Date | string | null;
  checkoutStartedAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

/**
 * When a checkout counts as abandoned: the Abandoned column's own fallback
 * chain, so a date filter and the date printed in the row never disagree.
 */
export function abandonedAtOf(row: AbandonedDated): Date | null {
  const value = row.abandonedAt || row.checkoutStartedAt || row.updatedAt;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Whether a row was abandoned inside the window. No window means no filter; a
 * row with no usable date is left out of any window rather than guessed at.
 */
export function isAbandonedWithin(
  row: AbandonedDated,
  range: DashboardRange | null,
): boolean {
  if (!range) return true;
  const at = abandonedAtOf(row);
  return Boolean(at && at >= range.from && at <= range.to);
}
