import "server-only";

import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB, mongoose } from "@/lib/db";
import { escapeRegExp } from "@/lib/strings";
import { Product, Review } from "@/models";

export const REVIEW_HIGHLIGHT_SORTS = ["bestRated", "newest"] as const;
export type ReviewHighlightSort = (typeof REVIEW_HIGHLIGHT_SORTS)[number];

/** By a rule (auto), or the vendor's own picks in their order (manual). */
export const REVIEW_HIGHLIGHT_SOURCES = ["auto", "manual"] as const;
export type ReviewHighlightSource = (typeof REVIEW_HIGHLIGHT_SOURCES)[number];

export interface ReviewHighlight {
  id: string;
  rating: number;
  title?: string;
  comment: string;
  authorName: string;
  productName: string;
  productSlug?: string;
  isVerified: boolean;
  /** ISO timestamp; the UI formats it in the reader's locale. */
  createdAt: string;
}

interface HighlightRow {
  _id: unknown;
  rating: number;
  title?: string;
  comment?: string;
  isVerified?: boolean;
  createdAt: Date;
  userId?: { name?: string } | null;
  productId?: { name?: string; slug?: string } | null;
}

/**
 * Reviews worth quoting on a vendor's landing page: approved reviews of the
 * vendor's own products, at or above a rating, with something written in
 * them. The vendor chooses the rule (best first, or newest first) and how
 * many; they never write or edit the words — every quote is what a buyer
 * left, which is the whole point of showing it.
 *
 * First names only: a quote on a store's front page travels further than the
 * reviews tab, and "Sarah" says as much as a full name.
 */
export const getVendorReviewHighlights = unstable_cache(
  async ({
    vendorId,
    sort,
    minRating,
    limit,
  }: {
    vendorId: string;
    sort: ReviewHighlightSort;
    minRating: number;
    limit: number;
  }): Promise<ReviewHighlight[]> => {
    if (!mongoose.isValidObjectId(vendorId)) return [];
    await connectDB();

    const productIds = await Product.distinct("_id", { vendorId });
    if (productIds.length === 0) return [];

    const rows = await Review.find({
      productId: { $in: productIds },
      isApproved: true,
      rating: { $gte: Math.min(5, Math.max(1, Math.round(minRating))) },
      comment: { $regex: /\S/ },
    })
      .select("rating title comment isVerified createdAt userId productId")
      .populate("userId", "name")
      .populate("productId", "name slug")
      .sort(sort === "bestRated" ? { rating: -1, isVerified: -1, createdAt: -1 } : { createdAt: -1 })
      .limit(Math.min(12, Math.max(1, Math.floor(limit))))
      .lean<HighlightRow[]>();

    return rows.map(toHighlight);
  },
  ["vendor-review-highlights"],
  { revalidate: 300, tags: [CACHE_TAGS.products] },
);

const HIGHLIGHT_MAX = 12;

function toHighlight(row: HighlightRow): ReviewHighlight {
  return {
    id: String(row._id),
    rating: row.rating,
    title: row.title?.trim() || undefined,
    comment: (row.comment ?? "").trim(),
    authorName: row.userId?.name?.trim().split(/\s+/)[0] || "",
    productName: row.productId?.name?.trim() || "",
    productSlug: row.productId?.slug || undefined,
    isVerified: row.isVerified === true,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/** Valid ObjectIds, de-duplicated in order, capped at the section's max. */
function cleanReviewIds(ids: readonly unknown[]): string[] {
  return Array.from(
    new Set(
      ids.filter(
        (id): id is string => typeof id === "string" && mongoose.isValidObjectId(id),
      ),
    ),
  ).slice(0, HIGHLIGHT_MAX);
}

/**
 * The hand-picked highlights, in the vendor's order. Read with the same rule
 * as the automatic ones — approved, about the vendor's own products, with
 * something written — so a pick that has since been unapproved, deleted or
 * moved off the store simply drops out.
 */
export const getVendorPickedReviewHighlights = unstable_cache(
  async ({
    vendorId,
    reviewIds,
  }: {
    vendorId: string;
    reviewIds: string[];
  }): Promise<ReviewHighlight[]> => {
    const ids = cleanReviewIds(reviewIds);
    if (!mongoose.isValidObjectId(vendorId) || ids.length === 0) return [];
    await connectDB();

    const productIds = await Product.distinct("_id", { vendorId });
    if (productIds.length === 0) return [];

    const rows = await Review.find({
      _id: { $in: ids },
      productId: { $in: productIds },
      isApproved: true,
      comment: { $regex: /\S/ },
    })
      .select("rating title comment isVerified createdAt userId productId")
      .populate("userId", "name")
      .populate("productId", "name slug")
      .lean<HighlightRow[]>();

    const byId = new Map(rows.map((row) => [String(row._id), row]));
    return ids
      .map((id) => byId.get(id))
      .filter((row): row is HighlightRow => Boolean(row))
      .map(toHighlight);
  },
  ["vendor-review-highlights-picked"],
  { revalidate: 300, tags: [CACHE_TAGS.products] },
);

export interface VendorReviewOption extends ReviewHighlight {
  /** The full comment is long; the picker shows the start of it. */
  excerpt: string;
}

const PICKER_PAGE_SIZE = 50;

/**
 * The vendor's quotable reviews for the builder's hand-pick: approved, about
 * the vendor's own products, with something written — newest first, or by
 * id (to label picks that fell off the first page). Not cached: the vendor
 * is looking for the review a buyer left this morning.
 */
export async function listVendorReviewOptions({
  vendorId,
  search = "",
  minRating = 1,
  ids,
}: {
  vendorId: string;
  search?: string;
  minRating?: number;
  ids?: string[];
}): Promise<VendorReviewOption[]> {
  if (!mongoose.isValidObjectId(vendorId)) return [];
  await connectDB();

  const productIds = await Product.distinct("_id", { vendorId });
  if (productIds.length === 0) return [];

  const query: Record<string, unknown> = {
    productId: { $in: productIds },
    isApproved: true,
    comment: { $regex: /\S/ },
  };
  if (ids) {
    const wanted = cleanReviewIds(ids);
    if (wanted.length === 0) return [];
    query._id = { $in: wanted };
  } else {
    query.rating = { $gte: Math.min(5, Math.max(1, Math.round(minRating))) };
    const term = search.trim();
    if (term) {
      const pattern = new RegExp(escapeRegExp(term), "i");
      query.$or = [{ comment: pattern }, { title: pattern }];
    }
  }

  const rows = await Review.find(query)
    .select("rating title comment isVerified createdAt userId productId")
    .populate("userId", "name")
    .populate("productId", "name slug")
    .sort({ createdAt: -1 })
    .limit(PICKER_PAGE_SIZE)
    .lean<HighlightRow[]>();

  return rows.map((row) => {
    const highlight = toHighlight(row);
    const excerpt =
      highlight.comment.length > 160
        ? `${highlight.comment.slice(0, 157).trimEnd()}…`
        : highlight.comment;
    return { ...highlight, excerpt };
  });
}

/**
 * Of the given review ids, the ones a vendor may quote: approved reviews of
 * its own products. The page write gate keeps these and drops the rest.
 */
export async function ownedApprovedReviewIds(
  vendorId: string,
  ids: string[],
): Promise<Set<string>> {
  const wanted = Array.from(
    new Set(ids.filter((id) => mongoose.isValidObjectId(id))),
  );
  if (wanted.length === 0 || !mongoose.isValidObjectId(vendorId)) return new Set();
  const reviews = await Review.find({ _id: { $in: wanted }, isApproved: true })
    .select("productId")
    .lean<{ _id: unknown; productId: unknown }[]>();
  if (reviews.length === 0) return new Set();
  const owned = new Set(
    (
      await Product.find({
        _id: { $in: reviews.map((review) => review.productId) },
        vendorId: new mongoose.Types.ObjectId(vendorId),
      })
        .select("_id")
        .lean<{ _id: unknown }[]>()
    ).map((product) => String(product._id)),
  );
  return new Set(
    reviews
      .filter((review) => owned.has(String(review.productId)))
      .map((review) => String(review._id)),
  );
}
