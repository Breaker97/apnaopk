import Link from "next/link";
import { MessageSquare, Star } from "lucide-react";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import type { StorefrontVendorReviewsResult } from "@/lib/vendors/vendor-reviews";

interface VendorReviewsPanelLabels {
  heading: string;
  /** Resolved, e.g. "Based on 312 reviews". */
  basedOn: string;
  verifiedPurchase: string;
  storeReplied: string;
  empty: string;
  emptyHint: string;
  /** Shown above placeholder reviews so they are never mistaken for real ones. */
}

interface VendorReviewsPanelProps {
  data: StorefrontVendorReviewsResult;
  labels: VendorReviewsPanelLabels;
  locale: string;
  basePath: string;
}

function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(
            "h-3.5 w-3.5",
            star <= Math.round(rating)
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/35",
          )}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

function ReviewRow({
  rating,
  title,
  comment,
  authorName,
  authorImage,
  productName,
  productSlug,
  isVerified,
  dateLabel,
  reply,
  replyLabel,
  verifiedLabel,
  locale,
}: {
  rating: number;
  title?: string;
  comment: string;
  authorName: string;
  authorImage?: string;
  productName: string;
  productSlug?: string;
  isVerified: boolean;
  dateLabel: string;
  reply?: { comment: string };
  replyLabel: string;
  verifiedLabel: string;
  locale: string;
}) {
  return (
    <article className="border-b py-5 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-sm font-semibold text-muted-foreground">
          {authorImage ? (
            <AppImage
              src={authorImage}
              alt={authorName}
              width={36}
              height={36}
              className="h-full w-full object-cover"
            />
          ) : (
            authorName.trim().slice(0, 1).toUpperCase()
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold">{authorName}</span>
            {isVerified ? (
              <span className="rounded-full bg-emerald-500/10 px-2 py-px text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                {verifiedLabel}
              </span>
            ) : null}
            <span className="text-xs text-muted-foreground">{dateLabel}</span>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Stars rating={rating} />
            {productName ? (
              productSlug ? (
                <Link
                  href={`/${locale}/products/${productSlug}`}
                  className="truncate text-xs text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                >
                  {productName}
                </Link>
              ) : (
                <span className="truncate text-xs text-muted-foreground">
                  {productName}
                </span>
              )
            ) : null}
          </div>

          {title ? (
            <h3 className="mt-2 text-sm font-semibold">{title}</h3>
          ) : null}
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {comment}
          </p>

          {reply ? (
            <div className="mt-3 rounded-lg border-s-2 border-s-primary bg-muted/50 p-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                {replyLabel}
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {reply.comment}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/**
 * Reviews section of the vendor storefront.
 *
 * Average, per-star breakdown and the reviews themselves, paginated. A store
 * with no approved reviews gets an explicit empty state rather than a filled-in
 * summary — an unreviewed store should read as new, not as badly rated.
 */
export function VendorReviewsPanel({
  data,
  labels,
  locale,
  basePath,
}: VendorReviewsPanelProps) {
  if (data.reviews.length === 0) {
    return (
      <div className="rounded-xl border bg-card px-6 py-14 text-center">
        <Star
          className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40"
          aria-hidden="true"
        />
        <p className="font-medium">{labels.empty}</p>
        <p className="mt-1 text-sm text-muted-foreground">{labels.emptyHint}</p>
      </div>
    );
  }

  const { average, total, breakdown } = data;
  const dateFormat = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <section className="space-y-6">
      {/* Summary: average, then how the stars are distributed. */}
      <div className="grid gap-6 rounded-xl border bg-card p-5 sm:grid-cols-[auto_1fr] sm:gap-8 sm:p-6">
        <div className="text-center sm:min-w-40">
          <p className="text-4xl font-bold tabular-nums">
            {average.toFixed(1)}
          </p>
          <Stars rating={average} className="mt-1.5 justify-center" />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {labels.basedOn}
          </p>
        </div>

        <div className="space-y-1.5">
          {([5, 4, 3, 2, 1] as const).map((star) => {
            const count = breakdown[star] ?? 0;
            const percent = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={star} className="flex items-center gap-2.5 text-xs">
                <span className="w-3 text-end tabular-nums text-muted-foreground">
                  {star}
                </span>
                <Star
                  className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400"
                  aria-hidden="true"
                />
                <span
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                  role="presentation"
                >
                  <span
                    className="block h-full rounded-full bg-amber-400"
                    style={{ width: `${percent}%` }}
                  />
                </span>
                <span className="w-8 text-end tabular-nums text-muted-foreground">
                  {count.toLocaleString(locale)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5 sm:p-6">
        {data.reviews.map((review) => (
          <ReviewRow
            key={review.id}
            {...review}
            dateLabel={dateFormat.format(new Date(review.createdAt))}
            replyLabel={labels.storeReplied}
            verifiedLabel={labels.verifiedPurchase}
            locale={locale}
          />
        ))}
      </div>

      {data.totalPages > 1 ? (
        <Pagination>
          <PaginationContent>
            {data.page > 1 ? (
              <PaginationItem>
                <PaginationPrevious
                  href={`${basePath}?tab=reviews&reviewPage=${data.page - 1}`}
                />
              </PaginationItem>
            ) : null}

            {Array.from(
              { length: Math.min(5, data.totalPages) },
              (_, index) => index + 1,
            ).map((pageNumber) => (
              <PaginationItem key={pageNumber}>
                <PaginationLink
                  href={`${basePath}?tab=reviews&reviewPage=${pageNumber}`}
                  isActive={pageNumber === data.page}
                >
                  {pageNumber}
                </PaginationLink>
              </PaginationItem>
            ))}

            {data.page < data.totalPages ? (
              <PaginationItem>
                <PaginationNext
                  href={`${basePath}?tab=reviews&reviewPage=${data.page + 1}`}
                />
              </PaginationItem>
            ) : null}
          </PaginationContent>
        </Pagination>
      ) : null}
    </section>
  );
}
