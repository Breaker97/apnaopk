import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

/** Where a search was typed. */
export const ZERO_RESULT_SEARCH_SOURCES = ["storefront", "assistant"] as const;
export type ZeroResultSearchSource = (typeof ZERO_RESULT_SEARCH_SOURCES)[number];

/** How long a day's counts are kept. The report never looks further back. */
export const ZERO_RESULT_SEARCH_RETENTION_DAYS = 90;

/**
 * How often a search found nothing, per query, per source, per UTC day.
 *
 * Counters rather than one row per search: the report only ever asks "which
 * searches came up empty, and how often", and a busy store's misses would
 * otherwise grow without bound. One upsert with `$inc` per miss keeps the
 * collection to (queries × days) rows, and the TTL index drops a day once it
 * falls out of the retention window.
 *
 * Only searches that could have been answered by the catalogue are counted —
 * see lib/products/zero-result-searches.ts — so a query that found nothing
 * because of a price filter never reads as a product the store is missing.
 */
interface IZeroResultSearch {
  /** Midnight UTC of the day the misses happened. */
  day: Date;
  source: ZeroResultSearchSource;
  /** Canonical form: case- and accent-folded, whitespace collapsed. */
  query: string;
  count: number;
  lastSearchedAt: Date;
}

const ZeroResultSearchSchema = new Schema<IZeroResultSearch>(
  {
    day: { type: Date, required: true },
    source: { type: String, enum: ZERO_RESULT_SEARCH_SOURCES, required: true },
    query: { type: String, required: true, maxlength: 100 },
    count: { type: Number, default: 0, min: 0 },
    lastSearchedAt: { type: Date, required: true },
  },
  { versionKey: false },
);

// The upsert key, and the report's date-range scan.
ZeroResultSearchSchema.index({ day: 1, source: 1, query: 1 }, { unique: true });
// TTL needs a single-field index of its own.
ZeroResultSearchSchema.index(
  { day: 1 },
  { expireAfterSeconds: ZERO_RESULT_SEARCH_RETENTION_DAYS * 24 * 60 * 60 },
);

export const ZeroResultSearch =
  models.ZeroResultSearch ||
  model<IZeroResultSearch>("ZeroResultSearch", ZeroResultSearchSchema);
