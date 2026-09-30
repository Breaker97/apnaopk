/**
 * A snapshot's countdown offers end when they ended in the store it was
 * exported from, and the storefront draws nothing for a countdown that has
 * ended. Three of the four templates shipped with theirs already over, so a
 * fresh demo's home page had no deals panel.
 *
 * On import each one is re-based on the import, the way the imported coupons
 * are. It ends as far after the import as it did after the export, and never
 * sooner than 30 days out. Both importers use it: the install wizard
 * (lib/install/sample-data.ts) and `pnpm db:seed` (scripts/seed.mjs). That is
 * why there is no `server-only` here.
 */

const COUNTDOWN_SECTION = "countdown-offer";
const MIN_REMAINING_MS = 30 * 24 * 60 * 60 * 1000;

function timeOf(value: unknown): number | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * `sections` with every countdown offer's `endsAt` moved to the same distance
 * after `now` as it had after `exportedAt` (the snapshot manifest's), and at
 * least 30 days. A countdown with no date, or a snapshot with no export date,
 * gets the 30 days. Everything else is returned as it was.
 */
export function rebaseCountdownSections<T>(
  sections: readonly T[],
  exportedAt: unknown,
  now: Date = new Date(),
): T[] {
  const exported = timeOf(exportedAt);
  return sections.map((section) => {
    const { type, settings } = (section ?? {}) as { type?: unknown; settings?: unknown };
    if (type !== COUNTDOWN_SECTION || !settings || typeof settings !== "object") {
      return section;
    }
    const endsAt = timeOf((settings as { endsAt?: unknown }).endsAt);
    if (endsAt === null) return section;
    const remaining = exported === null ? 0 : endsAt - exported;
    const rebased = new Date(now.getTime() + Math.max(remaining, MIN_REMAINING_MS));
    return { ...section, settings: { ...settings, endsAt: rebased.toISOString() } };
  });
}
