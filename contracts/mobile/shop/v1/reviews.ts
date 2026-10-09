/**
 * The shopper's own reviews: writing one, reading theirs back, changing one,
 * and the products waiting for one. (A product's published reviews are
 * GET /products/{slug}/reviews, catalog.ts.)
 *
 * - POST /products/{slug}/reviews (auth user; `Idempotency-Key` required;
 *   refused on a demo store): write the review. The path segment takes the
 *   product's `id` (its slug works too). Answers 201 `MyReview`. A retry with
 *   the same key answers the review already written, never a second one.
 *   Whether it may be written at all is `MeProduct.canReview`; the limits to
 *   respect are `MeProduct.reviewLimits`.
 * - GET /me/reviews (auth user, private, `ETag`): the shopper's reviews,
 *   newest first, optionally of one star rating, each with where it stands
 *   and whether it can still be changed.
 * - PATCH /me/reviews/{id} (auth user; refused on a demo store): change one,
 *   within the same limits. Answers the review.
 * - GET /me/reviews/waiting (auth user, private, `ETag`): products delivered
 *   to the shopper that they have not reviewed yet.
 *
 * Every answer that lets the shopper write carries `ReviewLimits`; the app
 * checks against those, never numbers of its own, and prints
 * `ReviewLimits.publicationMessage` beside the button.
 *
 * Refusals, with `reason` (`REVIEW_REASONS`):
 * - 409 CONFLICT `NOT_REVIEWABLE`: the product was never delivered to the
 *   shopper, so a review is not a verified purchase.
 * - 409 CONFLICT `ALREADY_REVIEWED`: they reviewed it on every order it was
 *   delivered on; change that review instead.
 * - 409 CONFLICT `NOT_EDITABLE`: the store took the review down.
 * - 400 VALIDATION_ERROR `UPLOAD_NOT_FOUND`: a photo id that is neither one
 *   of the shopper's uploads nor a photo already on the review.
 * - 400 VALIDATION_ERROR (no reason): a field outside the limits, on
 *   `errors.{field}`.
 * - 404 NOT_FOUND: no such product, or no such review of theirs.
 */
import * as z from "zod";

import { ImageSet, ListQuery, listOf } from "./common";
import { UploadPolicy } from "./uploads";

export const REVIEW_REASONS = [
  "NOT_REVIEWABLE",
  "ALREADY_REVIEWED",
  "NOT_EDITABLE",
  "UPLOAD_NOT_FOUND",
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

/**
 * When a new review shows on the product page: `IMMEDIATE` (as soon as it is
 * posted) or `AFTER_MODERATION` (once the store approves it).
 */
export const REVIEW_PUBLICATIONS = ["IMMEDIATE", "AFTER_MODERATION"] as const;

/** What a review may hold, and when it shows. The store's numbers: check against these. */
export const ReviewLimits = z.object({
  titleMaxLength: z.number().int(),
  textMinLength: z.number().int(),
  textMaxLength: z.number().int(),
  maxPhotos: z.number().int(),
  /** Each photo, as POST /uploads takes it. */
  photo: UploadPolicy,
  /** `REVIEW_PUBLICATIONS`. */
  publication: z.string(),
  /** `publication` in the store's words, in the path's locale. Print it. */
  publicationMessage: z.string(),
});
export type ReviewLimits = z.infer<typeof ReviewLimits>;

/** The product a review is about. Opens it: GET /products/{slug}. */
export const ReviewProduct = z.object({
  id: z.string(),
  /** Left out when the product is gone from the store. */
  slug: z.string().optional(),
  name: z.string(),
  image: ImageSet.optional(),
});
export type ReviewProduct = z.infer<typeof ReviewProduct>;

/** A photo on a review. Send its `id` back in `UpdateReviewRequest.photoIds` to keep it. */
export const ReviewPhoto = z.object({
  id: z.string(),
  image: ImageSet,
});
export type ReviewPhoto = z.infer<typeof ReviewPhoto>;

/**
 * Where a review stands: `PUBLISHED` (shown on the product page), `PENDING`
 * (waiting for the store), `REJECTED` (the store took it down). Show another
 * value by `statusMessage`.
 */
export const REVIEW_STATUSES = ["PUBLISHED", "PENDING", "REJECTED"] as const;

/** One of the shopper's own reviews. */
export const MyReview = z.object({
  id: z.string(),
  product: ReviewProduct,
  rating: z.number().int(),
  title: z.string().optional(),
  text: z.string(),
  photos: z.array(ReviewPhoto),
  /** `REVIEW_STATUSES`. */
  status: z.string(),
  /** `status` in the store's words, in the path's locale. */
  statusMessage: z.string(),
  /** PATCH /me/reviews/{id} would be accepted. */
  canEdit: z.boolean(),
  verifiedPurchase: z.boolean(),
  /** The store's answer. */
  reply: z
    .object({
      comment: z.string(),
      createdAt: z.string().optional(),
    })
    .optional(),
  createdAt: z.string(),
  /** When the shopper last changed it. */
  editedAt: z.string().optional(),
});
export type MyReview = z.infer<typeof MyReview>;

/** POST /products/{slug}/reviews. Send `Idempotency-Key`. */
export const CreateReviewRequest = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().max(200).optional(),
  text: z.string().max(5000),
  /** `Upload.id`s, in the order to show; at most `ReviewLimits.maxPhotos`. */
  uploadIds: z.array(z.string().max(64)).max(20).optional(),
});
export type CreateReviewRequest = z.infer<typeof CreateReviewRequest>;

/** GET /me/reviews. Newest first. */
export const MyReviewListQuery = ListQuery.extend({
  /** Only reviews with this many stars. */
  rating: z.number().int().min(1).max(5).optional(),
});
export type MyReviewListQuery = z.infer<typeof MyReviewListQuery>;

export const MyReviewList = listOf(MyReview).extend({
  limits: ReviewLimits,
});
export type MyReviewList = z.infer<typeof MyReviewList>;

/**
 * PATCH /me/reviews/{id}: only the fields sent change; `title: null` clears
 * it. `photoIds`, when sent, is the review's whole set of photos in order:
 * each a `ReviewPhoto.id` to keep or an `Upload.id` to add; a photo left out
 * is removed.
 */
export const UpdateReviewRequest = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  title: z.string().max(200).nullable().optional(),
  text: z.string().max(5000).optional(),
  photoIds: z.array(z.string().max(2048)).max(20).optional(),
});
export type UpdateReviewRequest = z.infer<typeof UpdateReviewRequest>;

/** A product delivered to the shopper and not reviewed yet. */
export const WaitingReview = z.object({
  product: ReviewProduct,
  /** The order it came on. */
  orderId: z.string(),
  orderNumber: z.string(),
  deliveredAt: z.string().optional(),
});
export type WaitingReview = z.infer<typeof WaitingReview>;

/** GET /me/reviews/waiting: the most recent first, twenty at most. */
export const WaitingReviews = z.object({
  items: z.array(WaitingReview),
  limits: ReviewLimits,
});
export type WaitingReviews = z.infer<typeof WaitingReviews>;
