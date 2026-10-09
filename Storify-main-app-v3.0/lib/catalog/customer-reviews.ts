import "server-only";

import { isValidObjectId } from "mongoose";
import { recomputeProductRating } from "@/lib/catalog/reviews";
import { resolveReviewEligibility } from "@/lib/catalog/review-eligibility";
import { connectDB } from "@/lib/db";
import { Product, Review } from "@/models";
import type { IReview } from "@/types";

/**
 * A shopper's own reviews: writing one, reading theirs back with where each
 * stands, and changing one. The rules are the website's review form's
 * (app/api/reviews): a verified purchase, one review per product per
 * delivered order, the Review model's lengths, four photos.
 */

/** What a review may hold. The Review model enforces the lengths too. */
export const REVIEW_LIMITS = {
  titleMaxLength: 100,
  textMinLength: 10,
  textMaxLength: 1000,
  maxPhotos: 4,
} as const;

/**
 * Whether a new review shows at once. The website approves every review as it
 * is written ("auto-approve"); the store can unpublish one afterwards from
 * Reviews. Read here, not in each client, so the app says what happens.
 */
export const REVIEWS_PUBLISH_IMMEDIATELY = true;

export type ReviewStatus = "PUBLISHED" | "PENDING" | "REJECTED";

/** Approved: shown. Unpublished by the store: rejected. Otherwise waiting. */
export function reviewStatus(review: Pick<IReview, "isApproved" | "moderatedAt">): ReviewStatus {
  if (review.isApproved) return "PUBLISHED";
  return review.moderatedAt ? "REJECTED" : "PENDING";
}

/** A rejected review stays as the store left it. */
export function canEditReview(review: Pick<IReview, "isApproved" | "moderatedAt">): boolean {
  return reviewStatus(review) !== "REJECTED";
}

export type ReviewRefusal = "NOT_REVIEWABLE" | "ALREADY_REVIEWED" | "NOT_EDITABLE" | "PRODUCT_NOT_FOUND" | "REVIEW_NOT_FOUND";

export class ReviewRefusedError extends Error {
  constructor(
    readonly reason: ReviewRefusal,
    message: string,
  ) {
    super(message);
    this.name = "ReviewRefusedError";
  }
}

/** A review with its product, as the shopper's own list shows it. */
export type CustomerReview = IReview & {
  product: { _id: unknown; name?: string; slug?: string; images?: unknown[] } | null;
};

const PRODUCT_FIELDS = "name slug images";

async function withProduct(review: IReview): Promise<CustomerReview> {
  const product = await Product.findById(review.productId)
    .select(PRODUCT_FIELDS)
    .lean<CustomerReview["product"]>();
  return { ...review, product: product ?? null };
}

/** A product by id, or by slug for a caller that only has that. */
async function findProductId(idOrSlug: string): Promise<string | null> {
  const product = await Product.findOne(
    isValidObjectId(idOrSlug) ? { _id: idOrSlug } : { slug: idOrSlug },
  )
    .select("_id")
    .lean<{ _id: unknown } | null>();
  return product ? String(product._id) : null;
}

/**
 * Writes the shopper's review of a product they had delivered, on the newest
 * delivered order of it they have not reviewed yet.
 */
export async function createCustomerReview(input: {
  userId: string;
  product: string;
  rating: number;
  title?: string;
  text: string;
  imageUrls: string[];
}): Promise<CustomerReview> {
  await connectDB();
  const productId = await findProductId(input.product);
  if (!productId) throw new ReviewRefusedError("PRODUCT_NOT_FOUND", "Product not found.");

  const eligibility = await resolveReviewEligibility(input.userId, productId);
  if (!eligibility.eligibleOrderId) {
    throw eligibility.alreadyReviewed
      ? new ReviewRefusedError("ALREADY_REVIEWED", "You have already reviewed this product.")
      : new ReviewRefusedError(
          "NOT_REVIEWABLE",
          "You can review a product once it has been delivered to you.",
        );
  }

  let created;
  try {
    created = await Review.create({
      productId,
      userId: input.userId,
      orderId: eligibility.eligibleOrderId,
      rating: input.rating,
      title: input.title?.trim() || "",
      comment: input.text.trim(),
      images: input.imageUrls,
      isVerified: true,
      isApproved: REVIEWS_PUBLISH_IMMEDIATELY,
    });
  } catch (error) {
    // Two taps at once: the unique index let one through.
    if ((error as { code?: unknown })?.code === 11000) {
      throw new ReviewRefusedError("ALREADY_REVIEWED", "You have already reviewed this product.");
    }
    throw error;
  }

  await recomputeProductRating(productId);
  void import("@/lib/customers/customer")
    .then(({ refreshCustomerStats }) => refreshCustomerStats(input.userId))
    .catch((error) => console.error("Failed to refresh customer stats:", error));

  return withProduct(created.toObject() as IReview);
}

/** The shopper's reviews, newest first, optionally of one star rating. */
export async function listCustomerReviews(input: {
  userId: string;
  rating?: number;
  page: number;
  limit: number;
}): Promise<{ reviews: CustomerReview[]; totalPages: number }> {
  await connectDB();
  const filter: Record<string, unknown> = { userId: input.userId };
  if (input.rating) filter.rating = input.rating;
  const [rows, total] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((input.page - 1) * input.limit)
      .limit(input.limit)
      .populate("productId", PRODUCT_FIELDS)
      .lean<Array<IReview & { productId: unknown }>>(),
    Review.countDocuments(filter),
  ]);
  return {
    reviews: rows.map((row) => {
      const populated = row.productId as CustomerReview["product"] | null;
      const product =
        populated && typeof populated === "object" && "_id" in populated && "name" in populated
          ? populated
          : null;
      return {
        ...row,
        productId: (product?._id ?? row.productId) as IReview["productId"],
        product,
      };
    }),
    totalPages: Math.max(1, Math.ceil(total / input.limit)),
  };
}

/**
 * Changes the shopper's own review: only the fields given. `imageUrls`, when
 * given, replaces the photos; as a function it is handed the photos the
 * review has now and answers the new set (it may throw to refuse).
 */
export async function updateCustomerReview(input: {
  userId: string;
  reviewId: string;
  rating?: number;
  title?: string | null;
  text?: string;
  imageUrls?: string[] | ((current: string[]) => Promise<string[]>);
}): Promise<CustomerReview> {
  if (!isValidObjectId(input.reviewId)) {
    throw new ReviewRefusedError("REVIEW_NOT_FOUND", "Review not found.");
  }
  await connectDB();
  const before = await Review.findOne({ _id: input.reviewId, userId: input.userId }).lean<IReview | null>();
  if (!before) throw new ReviewRefusedError("REVIEW_NOT_FOUND", "Review not found.");
  if (!canEditReview(before)) {
    throw new ReviewRefusedError("NOT_EDITABLE", "The store has taken this review down; it can no longer be changed.");
  }

  const set: Record<string, unknown> = { editedAt: new Date() };
  if (input.rating !== undefined) set.rating = input.rating;
  if (input.title !== undefined) set.title = input.title?.trim() || "";
  if (input.text !== undefined) set.comment = input.text.trim();
  if (input.imageUrls !== undefined) {
    set.images =
      typeof input.imageUrls === "function" ? await input.imageUrls(before.images ?? []) : input.imageUrls;
  }

  const after = await Review.findOneAndUpdate(
    { _id: input.reviewId, userId: input.userId },
    { $set: set },
    { returnDocument: "after", runValidators: true },
  ).lean<IReview | null>();
  if (!after) throw new ReviewRefusedError("REVIEW_NOT_FOUND", "Review not found.");
  if (after.rating !== before.rating) await recomputeProductRating(String(after.productId));
  return withProduct(after);
}
