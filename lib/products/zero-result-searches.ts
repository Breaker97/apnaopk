import { after } from "next/server";
import { connectDB } from "@/lib/db";
import {
  canonicalizeProductSearch,
  parseProductSearch,
} from "@/lib/products/search";
import {
  ZERO_RESULT_SEARCH_RETENTION_DAYS,
  ZeroResultSearch,
  type ZeroResultSearchSource,
} from "@/models/zero-result-search.model";

/**
 * Searches that found nothing — what shoppers want that the store does not
 * (yet) sell. Recorded from the three places a shopper searches: the header
 * search box, the search results page and the AI sales assistant.
 *
 * Two rules keep the report honest:
 *
 * - **Only catalogue searches count.** A search that came up empty because
 *   of a price range, a category or an in-stock filter says nothing about
 *   the catalogue — "iphone under 10" finding nothing does not mean the
 *   store lacks iPhones — so the callers only record a search with no
 *   narrowing facet, on its first page.
 * - **One shopper, one count.** The header box searches as the shopper types
 *   and the results page searches again on Enter; the same query from the
 *   same shopper within a minute counts once. What remains of typing — the
 *   "unic", "unico" on the way to "unicorn" — is folded into the finished
 *   query when the report is read (`collapseTypingPrefixes`).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEDUPE_WINDOW_MS = 60_000;
const DEDUPE_MAX_KEYS = 5_000;

/** Midnight UTC of the day `date` falls on — the counter's bucket. */
export function utcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * True when any of these facets narrows the search. Callers pass exactly the
 * filters they applied; with any of them set, zero results is about the
 * filter, not the catalogue.
 */
export function hasNarrowingFacet(facets: Record<string, unknown>): boolean {
  return Object.values(facets).some((value) => {
    if (value === undefined || value === null || value === false) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });
}

// Recently recorded keys → when. In-process on purpose: it only has to catch
// the same shopper repeating a search seconds apart, and a miss counted twice
// on another instance costs a slightly high number, nothing else.
const recentlyRecorded = new Map<string, number>();

function isFreshKey(key: string, now: number): boolean {
  const seen = recentlyRecorded.get(key);
  if (seen !== undefined && now - seen < DEDUPE_WINDOW_MS) return false;
  if (recentlyRecorded.size >= DEDUPE_MAX_KEYS) {
    for (const [staleKey, at] of recentlyRecorded) {
      if (now - at >= DEDUPE_WINDOW_MS) recentlyRecorded.delete(staleKey);
    }
    // Still full: every key is fresh. Forget the oldest rather than grow.
    if (recentlyRecorded.size >= DEDUPE_MAX_KEYS) {
      const oldest = recentlyRecorded.keys().next().value;
      if (oldest !== undefined) recentlyRecorded.delete(oldest);
    }
  }
  recentlyRecorded.set(key, now);
  return true;
}

async function writeMiss(query: string, source: ZeroResultSearchSource) {
  await connectDB();
  const now = new Date();
  const filter = { day: utcDay(now), source, query };
  const update = { $inc: { count: 1 }, $set: { lastSearchedAt: now } };
  try {
    await ZeroResultSearch.updateOne(filter, update, { upsert: true });
  } catch (error) {
    // Two first misses of the same query racing to create its row: one
    // wins, the other hits the unique index. The row exists now — count
    // into it.
    if ((error as { code?: unknown })?.code !== 11000) throw error;
    await ZeroResultSearch.updateOne(filter, update);
  }
}

/**
 * Count a search that found nothing. Never throws and never delays the
 * response: the write runs after it, through `after()` inside a request or a
 * detached promise outside one.
 *
 * `clientKey` identifies the shopper for the de-duplication window only — an
 * IP address or a session id. It is never stored.
 */
export function recordZeroResultSearch(input: {
  query: string | null | undefined;
  source: ZeroResultSearchSource;
  clientKey?: string | null;
}): void {
  const query = canonicalizeProductSearch(input.query);
  // Nothing searchable — punctuation, a lone letter — is not a product idea.
  if (!query || !parseProductSearch(query)) return;
  if (!isFreshKey(`${input.source}|${input.clientKey ?? ""}|${query}`, Date.now())) {
    return;
  }

  const write = () =>
    writeMiss(query, input.source).catch((error) => {
      console.warn("[search-insights] could not record a zero-result search", error);
    });
  try {
    after(write);
  } catch {
    void write();
  }
}

export type ZeroResultSearchRow = {
  query: string;
  count: number;
  lastSearchedAt: string;
  sources: ZeroResultSearchSource[];
};

/**
 * Fold the leftovers of search-as-you-type into the query they led to.
 *
 * The header box searches every few keystrokes, so one shopper looking for
 * "unicorn" can leave "unic" and "unico" behind as misses of their own. A
 * query is dropped when some longer query in the report begins with it AND
 * was missed at least as often — the only way the shorter one could be
 * nothing but typing. A short query searched more often than anything that
 * extends it is a search in its own right, and stays.
 */
export function collapseTypingPrefixes(
  rows: ZeroResultSearchRow[],
): ZeroResultSearchRow[] {
  const byQuery = [...rows].sort((a, b) =>
    a.query < b.query ? -1 : a.query > b.query ? 1 : 0,
  );
  const dropped = new Set<string>();
  for (let i = 0; i < byQuery.length; i += 1) {
    const row = byQuery[i]!;
    // Every extension of a string sorts directly after it.
    for (let j = i + 1; j < byQuery.length; j += 1) {
      const other = byQuery[j]!;
      if (!other.query.startsWith(row.query)) break;
      if (other.count >= row.count) {
        dropped.add(row.query);
        break;
      }
    }
  }
  return rows.filter((row) => !dropped.has(row.query));
}

export const ZERO_RESULT_REPORT_PERIODS = [7, 30, 90] as const;
export type ZeroResultReportPeriod = (typeof ZERO_RESULT_REPORT_PERIODS)[number];

/** Rows read before the typing fold; the fold only removes, so this bounds it. */
const REPORT_SCAN_LIMIT = 500;

/**
 * The most-missed searches of the last `days` days, today included.
 */
export async function getZeroResultSearchReport(options: {
  days: ZeroResultReportPeriod;
  source?: ZeroResultSearchSource;
  limit?: number;
}): Promise<{ rows: ZeroResultSearchRow[]; total: number }> {
  const days = Math.min(options.days, ZERO_RESULT_SEARCH_RETENTION_DAYS);
  const since = utcDay(new Date(Date.now() - (days - 1) * DAY_MS));

  await connectDB();
  const grouped = await ZeroResultSearch.aggregate<{
    _id: string;
    count: number;
    lastSearchedAt: Date;
    sources: ZeroResultSearchSource[];
  }>([
    {
      $match: {
        day: { $gte: since },
        ...(options.source ? { source: options.source } : {}),
      },
    },
    {
      $group: {
        _id: "$query",
        count: { $sum: "$count" },
        lastSearchedAt: { $max: "$lastSearchedAt" },
        sources: { $addToSet: "$source" },
      },
    },
    { $sort: { count: -1, lastSearchedAt: -1, _id: 1 } },
    { $limit: REPORT_SCAN_LIMIT },
  ]);

  const rows = collapseTypingPrefixes(
    grouped.map((row) => ({
      query: row._id,
      count: row.count,
      lastSearchedAt: new Date(row.lastSearchedAt).toISOString(),
      sources: [...row.sources].sort(),
    })),
  );
  return {
    rows: rows.slice(0, options.limit ?? 100),
    total: rows.reduce((sum, row) => sum + row.count, 0),
  };
}
