import { STORE_PAGE_HISTORY_LIMIT } from "@/models/store-page.model";
import type { SectionInstance } from "@/lib/storefront/sections/types";

/**
 * Pure draft → published → history transforms. The routes apply these to the
 * document in ONE update so a publish can never half-happen; keeping them
 * pure keeps the ordering and cap rules unit-testable.
 */

interface StorePageVersionState {
  sections: SectionInstance[];
  publishedAt?: Date;
  publishedBy?: string;
}

/**
 * The next `published` and `history` after publishing `sections`. The
 * previous published snapshot (if any) moves to the FRONT of history —
 * newest first — and history is trimmed to its cap.
 */
export function buildPublishState(
  sections: SectionInstance[],
  previousPublished: StorePageVersionState | null | undefined,
  previousHistory: StorePageVersionState[] | undefined,
  publishedBy: string,
  now: Date,
): { published: StorePageVersionState; history: StorePageVersionState[] } {
  const history = previousPublished
    ? [previousPublished, ...(previousHistory ?? [])]
    : [...(previousHistory ?? [])];
  return {
    published: { sections, publishedAt: now, publishedBy },
    history: history.slice(0, STORE_PAGE_HISTORY_LIMIT),
  };
}

/**
 * Structural equality for section arrays — the "unpublished changes" test.
 * Both sides come out of the same write normalizer, so JSON comparison is
 * exact rather than approximate.
 */
export function sectionsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
