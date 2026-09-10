import type {
  AboutStat,
  AboutStatKey,
} from "@/lib/site-config/content-pages-config";

/** Live counts behind the About page's numbers strip. `founded` is never counted. */
export type AboutStatCounts = Record<Exclude<AboutStatKey, "founded">, number>;

/**
 * A live count below this is hidden rather than shown: "12 orders delivered"
 * costs a store trust instead of earning it. A manual value always shows —
 * the merchant typed it on purpose.
 */
export const ABOUT_STAT_MIN_AUTO_VALUE = 10;

export interface ResolvedAboutStat {
  key: AboutStatKey;
  label: string;
  value: string;
}

/** Compact figure for a stat tile: 1.2k / 3.4M, plain digits below a thousand. */
export function formatAboutCount(value: number, locale: string): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString(locale);
}

/**
 * Turn the admin's stat rows plus the live counts into the tiles to render.
 * Disabled rows, unlabeled rows, `founded` without a year, and counts under
 * the threshold all drop out; the caller hides the strip when fewer than two
 * survive.
 */
export function resolveAboutStats(
  stats: AboutStat[],
  counts: AboutStatCounts | null,
  locale: string,
): ResolvedAboutStat[] {
  const resolved: ResolvedAboutStat[] = [];

  for (const stat of stats) {
    if (!stat.enabled) continue;
    const label = stat.label.trim();
    if (!label) continue;

    const manual = stat.manualValue.trim();
    if (manual) {
      resolved.push({ key: stat.key, label, value: manual });
      continue;
    }

    if (stat.key === "founded" || !counts) continue;
    const count = counts[stat.key];
    if (!Number.isFinite(count) || count < ABOUT_STAT_MIN_AUTO_VALUE) continue;

    resolved.push({
      key: stat.key,
      label,
      value: formatAboutCount(count, locale),
    });
  }

  return resolved;
}
