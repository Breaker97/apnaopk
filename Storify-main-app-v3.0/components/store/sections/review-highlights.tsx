import { BadgeCheck, Star } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "@/components/language/link";
import { type Locale } from "@/config/i18n.config";
import { cn } from "@/lib/utils";
import {
  getVendorPickedReviewHighlights,
  getVendorReviewHighlights,
  type ReviewHighlightSort,
} from "@/lib/vendors/vendor-review-highlights";
import { SectionHeading } from "./section-shell";

/**
 * Review Highlights on a vendor's landing page: real, approved reviews of
 * the store's products, quoted as cards. Server-rendered and quiet when
 * there is nothing to quote — the admin preview shows `emptyState` instead.
 */
export async function ReviewHighlights({
  locale,
  vendorId,
  title,
  sort,
  minRating,
  limit,
  reviewIds,
  showProduct,
  emptyState = null,
}: {
  locale: Locale;
  vendorId: string;
  title: string;
  sort: ReviewHighlightSort;
  minRating: number;
  limit: number;
  /** The vendor's hand-picked reviews, in order; unset reads by the rule. */
  reviewIds?: string[];
  showProduct: boolean;
  emptyState?: React.ReactNode;
}) {
  const reviews = await (
    reviewIds
      ? getVendorPickedReviewHighlights({ vendorId, reviewIds })
      : getVendorReviewHighlights({ vendorId, sort, minRating, limit })
  ).catch(() => []);
  if (reviews.length === 0) return emptyState;

  const t = await getTranslations({ locale });
  const verifiedLabel = t.has("reviews.verified")
    ? t("reviews.verified")
    : "Verified Purchase";
  const formatDate = new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "numeric",
  });

  return (
    <section className="py-5 lg:py-8">
      <div className="container mx-auto px-4">
        <SectionHeading title={title} className="mb-6" />
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="flex flex-col gap-3 rounded-lg border border-border/70 bg-card p-5"
            >
              <span
                className="inline-flex items-center gap-0.5"
                role="img"
                aria-label={`${review.rating} / 5`}
              >
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    aria-hidden="true"
                    className={cn(
                      "h-4 w-4",
                      star <= review.rating
                        ? "fill-amber-400 text-amber-400"
                        : "text-muted-foreground/35",
                    )}
                  />
                ))}
              </span>
              {review.title ? (
                <p className="font-semibold text-foreground">{review.title}</p>
              ) : null}
              <blockquote className="line-clamp-6 text-sm leading-relaxed text-muted-foreground">
                {review.comment}
              </blockquote>
              <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs text-muted-foreground">
                {review.authorName ? (
                  <span className="font-medium text-foreground">
                    {review.authorName}
                  </span>
                ) : null}
                {review.isVerified ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    {verifiedLabel}
                  </span>
                ) : null}
                <span>{formatDate.format(new Date(review.createdAt))}</span>
              </div>
              {showProduct && review.productName ? (
                review.productSlug ? (
                  <Link
                    href={`/products/${review.productSlug}`}
                    className="truncate text-xs font-medium text-[color:var(--store-link,var(--primary))] hover:underline"
                  >
                    {review.productName}
                  </Link>
                ) : (
                  <span className="truncate text-xs text-muted-foreground">
                    {review.productName}
                  </span>
                )
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
