import "server-only";

import { getTranslations } from "next-intl/server";
import type { ReviewStatus } from "@/lib/catalog/customer-reviews";

/** The words the shopper app prints about a shopper's own review. */
export interface ReviewCopy {
  /** When a new review shows, beside the button. */
  publication(immediate: boolean): string;
  status(status: ReviewStatus): string;
}

const STATUS: Record<ReviewStatus, [string, string]> = {
  PUBLISHED: ["reviews.statusPublished", "Published"],
  PENDING: ["reviews.statusPending", "Waiting for the store's approval"],
  REJECTED: ["reviews.statusRejected", "Not published by the store"],
};

/**
 * The words in one language, from the store's message catalogue, each falling
 * back to English where a language lacks the key.
 */
export async function getReviewCopy(locale: string): Promise<ReviewCopy> {
  const t = await getTranslations({ locale });
  const say = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);
  return {
    publication: (immediate) =>
      immediate
        ? say("reviews.publishedImmediately", "Your review shows on the product page as soon as you post it.")
        : say("reviews.publishedAfterModeration", "Your review shows once the store has approved it."),
    status: (status) => say(...STATUS[status]),
  };
}
