import type { MyReview, ReviewLimits, ReviewPhoto } from "@/contracts/mobile/shop/v1/reviews";
import { MobileApiError } from "@/lib/api-core/errors";
import { imageSet } from "@/lib/api-core/shop/images";
import {
  REVIEW_LIMITS,
  REVIEWS_PUBLISH_IMMEDIATELY,
  ReviewRefusedError,
  canEditReview,
  reviewStatus,
  type CustomerReview,
} from "@/lib/catalog/customer-reviews";
import type { ReviewCopy } from "@/lib/catalog/review-copy";
import { shopperUploadPolicy, shopperUploadUrls } from "@/lib/media-upload/shopper-uploads";

/**
 * A shopper's own review in the contract's shape, the limits they write
 * within, and the photo ids the app names photos by.
 */

const UPLOAD_ID = /^[a-f0-9]{24}$/i;

/** A photo already on a review is named by its URL, opaque to the app. */
export function reviewPhotoId(url: string): string {
  return `p_${Buffer.from(url).toString("base64url")}`;
}

function uploadNotFound(field: string): MobileApiError {
  const message = "A photo is not one of your uploads. Upload it again.";
  return new MobileApiError(400, "VALIDATION_ERROR", message, {
    reason: "UPLOAD_NOT_FOUND",
    errors: { [field]: [message] },
  });
}

/** The URLs of the shopper's uploads, or UPLOAD_NOT_FOUND. */
export async function uploadUrls(userId: string, ids: readonly string[], field: string): Promise<string[]> {
  const urls = await shopperUploadUrls(userId, ids);
  if (!urls) throw uploadNotFound(field);
  return urls;
}

/**
 * The photos a PATCH names, in order: each a photo the review has now (by
 * `reviewPhotoId`) or one of the shopper's uploads.
 */
export function resolvePhotoIds(userId: string, ids: readonly string[]) {
  return async (current: string[]): Promise<string[]> => {
    const kept = new Map(current.map((url) => [reviewPhotoId(url), url]));
    const uploads = ids.filter((id) => UPLOAD_ID.test(id));
    const uploaded = new Map(
      (await uploadUrls(userId, uploads, "photoIds")).map((url, index) => [uploads[index], url]),
    );
    return ids.map((id) => {
      const url = kept.get(id) ?? uploaded.get(id);
      if (!url) throw uploadNotFound("photoIds");
      return url;
    });
  };
}

/** Field errors for a review outside the limits; null when it is within them. */
export function reviewFieldErrors(review: {
  title?: string | null;
  text?: string;
  photoCount?: number;
}): Record<string, string[]> | null {
  const errors: Record<string, string[]> = {};
  if (review.title && review.title.trim().length > REVIEW_LIMITS.titleMaxLength) {
    errors.title = [`At most ${REVIEW_LIMITS.titleMaxLength} characters.`];
  }
  if (review.text !== undefined) {
    const length = review.text.trim().length;
    if (length < REVIEW_LIMITS.textMinLength) errors.text = [`At least ${REVIEW_LIMITS.textMinLength} characters.`];
    if (length > REVIEW_LIMITS.textMaxLength) errors.text = [`At most ${REVIEW_LIMITS.textMaxLength} characters.`];
  }
  if (review.photoCount !== undefined && review.photoCount > REVIEW_LIMITS.maxPhotos) {
    errors.photos = [`At most ${REVIEW_LIMITS.maxPhotos} photos.`];
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

export function assertWithinLimits(review: Parameters<typeof reviewFieldErrors>[0]): void {
  const errors = reviewFieldErrors(review);
  if (errors) {
    throw new MobileApiError(400, "VALIDATION_ERROR", `Validation failed: ${Object.keys(errors).join(", ")}`, { errors });
  }
}

export async function reviewLimits(copy: ReviewCopy): Promise<ReviewLimits> {
  return {
    ...REVIEW_LIMITS,
    photo: await shopperUploadPolicy(),
    publication: REVIEWS_PUBLISH_IMMEDIATELY ? "IMMEDIATE" : "AFTER_MODERATION",
    publicationMessage: copy.publication(REVIEWS_PUBLISH_IMMEDIATELY),
  };
}

/** The domain's refusals as the contract words them. */
export function toReviewError(error: unknown): unknown {
  if (!(error instanceof ReviewRefusedError)) return error;
  if (error.reason === "PRODUCT_NOT_FOUND" || error.reason === "REVIEW_NOT_FOUND") {
    return new MobileApiError(404, "NOT_FOUND", error.message);
  }
  return new MobileApiError(409, "CONFLICT", error.message, { reason: error.reason });
}

const iso = (value: unknown): string | undefined =>
  value ? new Date(value as string | Date).toISOString() : undefined;

export function toMyReview(review: CustomerReview, copy: ReviewCopy): MyReview {
  const product = review.product;
  const productImage = imageSet(
    product?.images?.find((image): image is string => typeof image === "string"),
    product?.name,
  );
  const status = reviewStatus(review);
  const photos: ReviewPhoto[] = (review.images ?? []).flatMap((url) => {
    const image = imageSet(url);
    return image ? [{ id: reviewPhotoId(url), image }] : [];
  });
  const editedAt = iso(review.editedAt);
  const replyAt = iso((review.reply as { createdAt?: unknown } | undefined)?.createdAt);
  return {
    id: String(review._id),
    product: {
      id: String(product?._id ?? review.productId),
      ...(product?.slug ? { slug: product.slug } : {}),
      name: product?.name ?? "",
      ...(productImage ? { image: productImage } : {}),
    },
    rating: review.rating,
    ...(review.title?.trim() ? { title: review.title.trim() } : {}),
    text: review.comment,
    photos,
    status,
    statusMessage: copy.status(status),
    canEdit: canEditReview(review),
    verifiedPurchase: review.isVerified === true,
    ...(review.reply?.comment
      ? { reply: { comment: review.reply.comment, ...(replyAt ? { createdAt: replyAt } : {}) } }
      : {}),
    createdAt: iso(review.createdAt) ?? new Date(0).toISOString(),
    ...(editedAt ? { editedAt } : {}),
  };
}
