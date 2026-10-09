import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB, mongoose } from "@/lib/db";
import { Product, Review } from "@/models";

type StorefrontVendorReview = {
  id: string;
  rating: number;
  title?: string;
  comment: string;
  authorName: string;
  authorImage?: string;
  productName: string;
  productSlug?: string;
  isVerified: boolean;
  /** ISO timestamp; the UI formats it in the reader's locale. */
  createdAt: string;
  reply?: { comment: string; createdAt?: string };
};

export type StorefrontVendorReviewsResult = {
  reviews: StorefrontVendorReview[];
  total: number;
  page: number;
  totalPages: number;
  average: number;
  /** Counts keyed 1–5, always all five keys so the bars render at zero. */
  breakdown: Record<1 | 2 | 3 | 4 | 5, number>;
};

const EMPTY_BREAKDOWN: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 0,
  2: 0,
  3: 0,
  4: 0,
  5: 0,
};

const VENDOR_REVIEWS_PAGE_SIZE = 8;

/**
 * Furthest offset the reviews tab will seek to. `?reviewPage=` is anonymous and
 * feeds `.skip()` directly, so it carries the same unbounded-offset exposure as
 * the product grid's `?page=` — see MAX_PRODUCT_SKIP in
 * lib/products/storefront-products.ts. Kept in the same order of magnitude.
 */
const MAX_REVIEW_SKIP = 10_000;

/** Result for a store with no approved reviews. */
function buildEmptyResult(): StorefrontVendorReviewsResult {
  return {
    reviews: [],
    total: 0,
    page: 1,
    totalPages: 1,
    average: 0,
    breakdown: { ...EMPTY_BREAKDOWN },
  };
}

type ReviewLean = {
  _id: unknown;
  rating: number;
  title?: string;
  comment: string;
  isVerified?: boolean;
  createdAt: Date;
  userId?: { name?: string; image?: string } | null;
  productId?: { name?: string; slug?: string } | null;
  reply?: { comment?: string; createdAt?: Date };
};

/**
 * Approved reviews across everything a vendor sells, newest first.
 *
 * `Review` carries `productId`, not `vendorId`, so the vendor's products are the
 * join hop — the same route `getVendorReviewStatsMap` takes, which is why the
 * average here agrees with the one in the store header.
 *
 * Only approved reviews are returned: the storefront must never surface a review
 * still awaiting moderation.
 */
export const getStorefrontVendorReviews = unstable_cache(
  async ({
    vendorId,
    page = 1,
    limit = VENDOR_REVIEWS_PAGE_SIZE,
  }: {
    vendorId: string;
    page?: number;
    limit?: number;
  }): Promise<StorefrontVendorReviewsResult> => {
    const empty = buildEmptyResult();

    if (!mongoose.isValidObjectId(vendorId)) return empty;

    await connectDB();

    const productIds = await Product.distinct("_id", { vendorId });
    if (productIds.length === 0) return empty;

    const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)));
    const safePage = Math.min(
      Math.max(1, Math.floor(page)),
      Math.floor(MAX_REVIEW_SKIP / safeLimit) + 1,
    );
    const match = { productId: { $in: productIds }, isApproved: true };

    // One round trip for the page and the breakdown; the breakdown's counts sum
    // to the total, so a separate countDocuments would be redundant.
    const [rows, stats] = await Promise.all([
      Review.find(match)
        .select(
          "rating title comment isVerified createdAt reply.comment reply.createdAt userId productId",
        )
        .populate("userId", "name image")
        .populate("productId", "name slug")
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean<ReviewLean[]>(),
      Review.aggregate<{ _id: number; count: number }>([
        { $match: match },
        { $group: { _id: "$rating", count: { $sum: 1 } } },
      ]),
    ]);

    const breakdown = { ...EMPTY_BREAKDOWN };
    let total = 0;
    let ratingSum = 0;
    for (const row of stats) {
      const star = Math.round(row._id);
      if (star >= 1 && star <= 5) {
        breakdown[star as 1 | 2 | 3 | 4 | 5] = row.count;
        total += row.count;
        ratingSum += star * row.count;
      }
    }

    // Products exist but none carry an approved review — same situation as a
    // store with no products, so it gets the same treatment.
    if (total === 0) return buildEmptyResult();

    return {
      reviews: rows.map((row) => ({
        id: String(row._id),
        rating: row.rating,
        title: row.title?.trim() || undefined,
        comment: row.comment,
        // A deleted account leaves the populate null; the review still stands.
        authorName: row.userId?.name?.trim() || "Verified buyer",
        authorImage: row.userId?.image || undefined,
        productName: row.productId?.name?.trim() || "",
        productSlug: row.productId?.slug || undefined,
        isVerified: row.isVerified === true,
        createdAt: new Date(row.createdAt).toISOString(),
        reply: row.reply?.comment
          ? {
              comment: row.reply.comment,
              createdAt: row.reply.createdAt
                ? new Date(row.reply.createdAt).toISOString()
                : undefined,
            }
          : undefined,
      })),
      total,
      page: safePage,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      average: total > 0 ? Math.round((ratingSum / total) * 10) / 10 : 0,
      breakdown,
    };
  },
  ["storefront-vendor-reviews"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.products],
  },
);
