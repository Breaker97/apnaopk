/**
 * What a store's own Return Policy page says that the store does not do.
 *
 * The default copy is kept true to the app, but a merchant's own text is never
 * rewritten for them — a store that saved its page before the default changed
 * keeps every word. The editor reads this instead, and says what no longer
 * matches: a return window other than the one checkout sells with, and
 * features the store does not offer.
 *
 * Pure and client-safe.
 */

export type ReturnPolicyCopyWarning =
  /** `windowDays` null: the store takes returns with no time limit. */
  | { kind: "days"; days: number[]; windowDays: number | null }
  | { kind: "feature"; feature: "photos" };

/** Every string in a page's data. */
function textOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textOf);
  if (value && typeof value === "object") return Object.values(value).flatMap(textOf);
  return [];
}

/**
 * Day counts on the page that are not the store's window. Ranges ("3–7
 * days") and business or working days are left alone: those describe
 * delivery and refund timing, not how long a return stays open.
 */
function strayDayCounts(text: string, windowDays: number | null): number[] {
  const found = new Set<number>();
  const pattern = /(\d{1,3})(\s*[-–]\s*\d{1,3})?\s*(business\s+|working\s+)?days?\b/gi;
  for (const match of text.matchAll(pattern)) {
    if (match[2] || match[3]) continue;
    const days = Number(match[1]);
    if (Number.isFinite(days) && days !== windowDays) found.add(days);
  }
  return Array.from(found).sort((a, b) => a - b);
}

export function returnPolicyCopyWarnings(
  page: unknown,
  /** The store's window in days, or null for no time limit. */
  windowDays: number | null,
): ReturnPolicyCopyWarning[] {
  const text = textOf(page).join("\n");
  const warnings: ReturnPolicyCopyWarning[] = [];

  const days = strayDayCounts(text, windowDays);
  if (days.length > 0) warnings.push({ kind: "days", days, windowDays });

  // Exchanges (R7) and store credit (R8) are the store's to offer now; a page
  // that mentions them says nothing untrue. The return form still takes a
  // reason and a note, never a picture.
  if (/\bphoto(s|graph|graphs)?\b/i.test(text)) {
    warnings.push({ kind: "feature", feature: "photos" });
  }
  return warnings;
}
