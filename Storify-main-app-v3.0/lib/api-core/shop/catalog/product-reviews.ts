import {
  ProductReviews,
  ProductReviewsQuery,
  type Review,
  type ReviewSort,
} from "@/contracts/mobile/shop/v1/catalog";
import type { ImageSet } from "@/contracts/mobile/shop/v1/common";
import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/shop/v1/common";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import {
  readProductReviews,
  type ProductReviewSort,
} from "@/lib/catalog/product-reviews";
import { getStorefrontProductBySlug } from "@/lib/products/storefront-product-detail";
import { imageSet } from "../images";
import { nextPageCursor, pageFromCursor } from "../page-cursor";

const REVIEW_SORT: Record<ReviewSort, ProductReviewSort> = {
  NEWEST: "newest",
  OLDEST: "oldest",
  HIGHEST: "highest",
  LOWEST: "lowest",
};

type StoredReview = {
  _id: unknown;
  rating: number;
  title?: string;
  comment?: string;
  images?: string[];
  isVerified?: boolean;
  createdAt?: Date | string;
  reply?: { comment?: string; createdAt?: Date | string };
  userId?: { name?: string; image?: string } | null;
};

function isoDate(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toReview(review: StoredReview): Review {
  const name = review.userId?.name?.trim();
  const avatar = imageSet(review.userId?.image);
  const title = review.title?.trim();
  const reply = review.reply?.comment?.trim();
  const replyAt = isoDate(review.reply?.createdAt);
  return {
    id: String(review._id),
    rating: review.rating,
    ...(title ? { title } : {}),
    comment: review.comment ?? "",
    author: {
      ...(name ? { name } : {}),
      ...(avatar ? { avatar } : {}),
    },
    verifiedPurchase: review.isVerified === true,
    createdAt: isoDate(review.createdAt) ?? new Date(0).toISOString(),
    images: (review.images ?? [])
      .map((url) => imageSet(url))
      .filter((image): image is ImageSet => Boolean(image)),
    ...(reply ? { reply: { comment: reply, ...(replyAt ? { createdAt: replyAt } : {}) } } : {}),
  };
}

/**
 * GET /products/{slug}/reviews: a product's approved reviews, a page at a
 * time, with the rating summary over all of them. The web's own reviews read
 * (lib/catalog/product-reviews.ts), per request like the web's.
 */
export const productReviewsRoute = defineRoute({
  id: "catalog.products.reviews",
  method: "GET",
  path: "/products/{slug}/reviews",
  auth: "none",
  cache: { kind: "public", sMaxAge: 60, swr: 120 },
  etag: true,
  rateLimit: { bucket: "catalog:reviews", preset: "browse" },
  input: ProductReviewsQuery,
  output: ProductReviews,
  handler: async ({ params, input }) => {
    const page = pageFromCursor(input.cursor);
    const product = await getStorefrontProductBySlug(params.slug);
    if (!product) throw new MobileApiError(404, "NOT_FOUND", "This product is not available.");

    const { reviews, stats, pagination } = await readProductReviews({
      productId: String(product._id),
      page,
      limit: input.limit ?? LIST_DEFAULT_LIMIT,
      rating: input.rating ?? null,
      sort: REVIEW_SORT[input.sort ?? "NEWEST"],
    });
    return {
      items: (reviews as unknown as StoredReview[]).map(toReview),
      nextCursor: nextPageCursor(page, pagination.totalPages),
      summary: {
        average: stats.average,
        count: stats.total,
        distribution: ([5, 4, 3, 2, 1] as const).map((stars) => ({
          stars,
          count: stats.breakdown[stars],
        })),
      },
    };
  },
});
