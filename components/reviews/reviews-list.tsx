"use client";

import {
  BadgeCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flag,
  MessagesSquare,
  MoreVertical,
  Star,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { ElectronicsSectionHeading } from "@/components/store/sections/themes/electronics-section-heading";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { buildLoginUrl, currentBrowserPath } from "@/lib/auth/return-path";
import { useAuth } from "@/hooks/use-auth";
import { ReviewForm } from "./review-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { AppImage } from "@/components/ui/app-image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface Review {
  _id: string;
  rating: number;
  title?: string;
  comment: string;
  reply?: {
    comment: string;
    createdAt?: string;
    updatedAt?: string;
  };
  isVerified: boolean;
  createdAt: string;
  images?: string[];
  userId: {
    _id: string;
    name: string;
    image?: string;
  } | null;
}

interface RatingStats {
  average: number;
  total: number;
  breakdown: {
    5: number;
    4: number;
    3: number;
    2: number;
    1: number;
  };
}

interface ReviewPagination {
  page: number;
  total: number;
  totalPages: number;
}

interface ReviewsListProps {
  productId: string;
  locale: string;
}

type SortOption = "newest" | "oldest" | "highest" | "lowest";

const REVIEWS_PER_PAGE = 6;

/**
 * The product review thread (Figma 829-2420): a two-tone heading over a
 * summary bar (average, count, write CTA, Rating filter, Sort by), then
 * hairline-separated reviews — stars + recommendation, bold title, body,
 * photo row, "Posted … by …" byline — with the store's reply as an inset
 * "Brand response" panel, and numbered pagination at the foot.
 */
export function ReviewsList({ productId, locale }: ReviewsListProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();

  const tf = (
    key: string,
    fallback: string,
    values?: Record<string, string | number>,
  ) => {
    if (t.has(key)) {
      return t(key as never, values as never);
    }
    if (!values) return fallback;
    return fallback.replace(/\{(\w+)\}/g, (_, token) =>
      String(values[token] ?? `{${token}}`),
    );
  };

  const [reviews, setReviews] = useState<Review[]>([]);
  const [stats, setStats] = useState<RatingStats | null>(null);
  const [pagination, setPagination] = useState<ReviewPagination | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  // Bumped whenever the query resets to page 1 (filter/sort change, new
  // review) so an older in-flight response can't paint a stale page.
  const listGenerationRef = useRef(0);
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [isWriteReviewOpen, setIsWriteReviewOpen] = useState(false);
  const [isCheckingEligibility, setIsCheckingEligibility] = useState(false);
  const [eligibleOrderId, setEligibleOrderId] = useState<string | null>(null);
  const [alreadyReviewed, setAlreadyReviewed] = useState(false);
  const [reviewEligibilityError, setReviewEligibilityError] = useState<
    string | null
  >(null);

  const fetchReviews = useCallback(
    (pageToLoad: number) => {
      const generation = listGenerationRef.current;
      const params = new URLSearchParams({
        productId,
        page: String(pageToLoad),
        limit: String(REVIEWS_PER_PAGE),
        sort: sortBy,
      });
      // Filter + sort at the server so they span ALL reviews, not just
      // the page on screen.
      if (selectedRating !== null) {
        params.set("rating", String(selectedRating));
      }
      return fetch(`/api/reviews?${params.toString()}`)
        .then((res) => res.json())
        .then((data) => {
          if (generation !== listGenerationRef.current) return;
          if (!data?.success) return;
          const payload = data.data ?? {};
          setReviews(
            Array.isArray(payload.reviews) ? (payload.reviews as Review[]) : [],
          );
          setStats(payload.stats ?? null);
          setPagination(payload.pagination ?? null);
        })
        .catch((error) => {
          console.error("Failed to fetch reviews:", error);
        })
        .finally(() => setIsLoading(false));
    },
    [productId, selectedRating, sortBy],
  );

  // Load page 1 on mount and whenever the product, rating filter, or sort
  // changes (fetchReviews' identity changes with those). We don't force the
  // skeleton here (only the initial isLoading=true does) so toggling a
  // rating/sort swaps the list in place instead of flashing the section.
  useApplyOnChange([fetchReviews], () => {
    setPage(1);
  });
  useEffect(() => {
    listGenerationRef.current += 1;
    void fetchReviews(1);
  }, [fetchReviews]);

  const goToPage = (next: number) => {
    if (next === page) return;
    setPage(next);
    void fetchReviews(next);
    document
      .getElementById("reviews")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const sortLabels: Record<SortOption, string> = {
    newest: tf("product.mostRecent", "Newest"),
    oldest: tf("reviews.oldest", "Oldest"),
    highest: tf("product.highestRated", "Highest Rated"),
    lowest: tf("product.lowestRated", "Lowest Rated"),
  };
  const allLabel = tf("reviews.all", "All");

  const resolveEligibility = useCallback(async (): Promise<{
    eligibleOrderId: string | null;
    alreadyReviewed: boolean;
  }> => {
    // Targeted server lookup over ALL of the user's orders (not just the
    // first 100), matching the same rule the review-create endpoint enforces.
    const res = await fetch(
      `/api/orders/review-eligibility?productId=${encodeURIComponent(productId)}`,
    );
    const data = await res.json();
    return {
      eligibleOrderId: data?.success ? (data.data?.eligibleOrderId ?? null) : null,
      alreadyReviewed: data?.success === true && data.data?.alreadyReviewed === true,
    };
  }, [productId]);

  const openWriteReview = async () => {
    setIsWriteReviewOpen(true);
    setReviewEligibilityError(null);
    setEligibleOrderId(null);
    setAlreadyReviewed(false);

    if (!isAuthenticated) return;

    setIsCheckingEligibility(true);
    try {
      const eligibility = await resolveEligibility();
      if (eligibility.eligibleOrderId) {
        setEligibleOrderId(eligibility.eligibleOrderId);
      } else if (eligibility.alreadyReviewed) {
        setAlreadyReviewed(true);
      } else {
        setReviewEligibilityError(
          tf(
            "reviews.eligibleOrderRequired",
            "You can review this product only after it is delivered in one of your orders.",
          ),
        );
      }
    } catch {
      setReviewEligibilityError(
        tf("common.error", "Something went wrong while checking eligibility."),
      );
    } finally {
      setIsCheckingEligibility(false);
    }
  };

  const handleReviewSuccess = async () => {
    setIsWriteReviewOpen(false);
    setSelectedRating(null);
    listGenerationRef.current += 1;
    setPage(1);
    setIsLoading(true);
    await fetchReviews(1);
  };

  if (isLoading) {
    return <ReviewsListSkeleton />;
  }

  const average = stats?.average ?? 0;
  const total = stats?.total ?? 0;
  const filteredTotal = pagination?.total ?? reviews.length;
  const totalPages = pagination?.totalPages ?? 1;
  const from = filteredTotal === 0 ? 0 : (page - 1) * REVIEWS_PER_PAGE + 1;
  const to = Math.min(page * REVIEWS_PER_PAGE, filteredTotal);

  return (
    <section className="py-8">
      <ElectronicsSectionHeading
        title={tf("common.reviews", "Reviews")}
        className="mb-5 text-left text-xl sm:text-2xl"
      />

      {/* Summary bar: average + count + write CTA on the start edge, the
          Rating filter and Sort on the end edge — one row from md, where the
          English row needs ~710px. Below md the same markup stacks: the
          summary keeps its own row and the two controls split the width in
          half with their labels above them, so neither control wraps onto
          its own line or lands half-off a phone screen. */}
      <div className="flex flex-col gap-4 border-t border-border pt-4 md:flex-row md:flex-wrap md:items-center md:gap-x-5 md:gap-y-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <span className="flex items-center gap-2">
            <Star className="h-5 w-5 fill-amber-500 text-amber-500" aria-hidden />
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {average.toFixed(2)}
            </span>
          </span>
          <span className="text-sm text-muted-foreground">
            {total} {tf("common.reviews", "reviews").toLowerCase()}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="rounded-sm border-foreground font-semibold"
            onClick={() => void openWriteReview()}
          >
            {tf("reviews.writeReviewCta", "Write a review!")}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm md:ms-auto md:flex md:flex-wrap md:items-center md:gap-x-6 md:gap-y-3">
          <span className="flex min-w-0 flex-col gap-1.5 md:flex-row md:items-center md:gap-3">
            <span className="text-muted-foreground">
              {tf("reviews.rating", "Rating")}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-between gap-2 rounded-input border border-border px-3 py-1.5 font-medium text-foreground md:w-auto md:min-w-20"
                >
                  <span className="truncate">
                    {selectedRating === null ? allLabel : `${selectedRating} ★`}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-28">
                <DropdownMenuItem onClick={() => setSelectedRating(null)}>
                  {allLabel}
                </DropdownMenuItem>
                {[5, 4, 3, 2, 1].map((value) => (
                  <DropdownMenuItem
                    key={value}
                    onClick={() => setSelectedRating(value)}
                  >
                    {value} ★
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>

          <span className="flex min-w-0 flex-col gap-1.5 md:flex-row md:items-center md:gap-3">
            <span className="text-muted-foreground">
              {tf("product.sortBy", "Sort by")}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-between gap-2 rounded-input border border-border px-3 py-1.5 font-medium text-foreground md:w-auto md:min-w-28"
                >
                  <span className="truncate">{sortLabels[sortBy]}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {(Object.keys(sortLabels) as SortOption[]).map((option) => (
                  <DropdownMenuItem
                    key={option}
                    onClick={() => setSortBy(option)}
                  >
                    {sortLabels[option]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </div>
      </div>

      <Dialog open={isWriteReviewOpen} onOpenChange={setIsWriteReviewOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {tf("reviews.writeReview", "Write a review")}
            </DialogTitle>
            <DialogDescription>
              {tf(
                "reviews.writeReviewHint",
                "Your email address will not be published. Required fields are marked with an asterisk (*).",
              )}
            </DialogDescription>
          </DialogHeader>

          {!isAuthenticated ? (
            <div className="space-y-4 rounded-xl border border-border/70 p-4">
              <p className="text-sm text-muted-foreground">
                {tf(
                  "reviews.loginToReview",
                  "Please sign in to write a review for this product.",
                )}
              </p>
              <Button
                className="rounded-full"
                onClick={() =>
                  router.push(
                    buildLoginUrl(locale, currentBrowserPath() ?? pathname),
                  )
                }
              >
                {tf("common.login", "Login")}
              </Button>
            </div>
          ) : isCheckingEligibility ? (
            <div className="rounded-xl border border-border/70 p-4 text-sm text-muted-foreground">
              {tf(
                "reviews.checkingEligibility",
                "Checking your eligible orders...",
              )}
            </div>
          ) : alreadyReviewed ? (
            <div className="rounded-xl border border-border/70 p-4 text-sm text-muted-foreground">
              {tf(
                "reviews.alreadyReviewed",
                "You have already reviewed this product. Thank you for sharing your experience!",
              )}
            </div>
          ) : reviewEligibilityError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {reviewEligibilityError}
            </div>
          ) : eligibleOrderId ? (
            <ReviewForm
              productId={productId}
              orderId={eligibleOrderId}
              onSuccess={() => void handleReviewSuccess()}
              onCancel={() => setIsWriteReviewOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {reviews.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border px-6 py-10 text-center text-muted-foreground sm:p-10">
          {selectedRating
            ? tf("reviews.noReviewsForRating", "No reviews for this rating yet")
            : tf("reviews.noReviews", "No reviews yet")}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {reviews.map((review) => (
            <article key={review._id} className="py-8">
              <div className="mb-3 flex items-start justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Star
                        key={index}
                        className={cn(
                          "h-4 w-4",
                          index < review.rating
                            ? "fill-amber-500 text-amber-500"
                            : "text-muted-foreground/30",
                        )}
                      />
                    ))}
                  </div>
                  {review.rating >= 4 && (
                    <span className="text-xs text-muted-foreground">
                      {tf("reviews.highlyRecommended", "Highly Recommended")}
                    </span>
                  )}
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={tf("product.report", "Report")}
                      className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-36">
                    <DropdownMenuItem>
                      <Flag className="h-4 w-4" />
                      {tf("product.report", "Report")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {review.title && (
                <h4 className="mb-2.5 text-base font-semibold text-foreground">
                  {review.title}
                </h4>
              )}

              <p className="text-sm leading-relaxed text-foreground/90">
                {review.comment}
              </p>

              {Array.isArray(review.images) && review.images.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2.5">
                  {review.images.slice(0, 4).map((src, idx) => (
                    <div
                      key={`${review._id}-img-${idx}`}
                      className="relative h-24 w-20 overflow-hidden rounded-md bg-muted"
                    >
                      <AppImage
                        src={src}
                        alt={`Review image ${idx + 1}`}
                        fill
                        sizes="80px"
                        className="object-cover"
                      />
                    </div>
                  ))}
                </div>
              )}

              <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                {tf("reviews.postedBy", "Posted {time} by {name}", {
                  time: formatDistanceToNow(new Date(review.createdAt), {
                    addSuffix: true,
                  }),
                  name: (
                    review.userId?.name || tf("reviews.anonymous", "Anonymous")
                  ).toUpperCase(),
                })}
                {review.isVerified && (
                  <BadgeCheck
                    className="h-4 w-4 text-emerald-600"
                    aria-label={tf("reviews.verified", "Verified customer")}
                  />
                )}
              </p>

              {review.reply?.comment && (
                <div className="mt-6 rounded-md bg-muted/40 px-5 py-5 sm:ms-12 sm:px-6">
                  <div className="mb-1 flex items-center gap-2.5">
                    <MessagesSquare
                      className="h-5 w-5 text-foreground/70"
                      aria-hidden
                    />
                    <span className="text-sm font-semibold text-foreground">
                      {tf("reviews.brandResponse", "Brand response")}
                    </span>
                  </div>
                  {review.reply.createdAt && (
                    <p className="mb-4 ps-[30px] text-xs text-muted-foreground">
                      {tf("reviews.postedTime", "Posted {time}", {
                        time: formatDistanceToNow(
                          new Date(review.reply.createdAt),
                          { addSuffix: true },
                        ),
                      })}
                    </p>
                  )}
                  <p className="whitespace-pre-line ps-[30px] text-sm leading-relaxed text-foreground/90">
                    {review.reply.comment}
                  </p>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {filteredTotal > 0 ? (
        <div className="flex flex-col items-start gap-4 border-t border-border pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {tf(
              "reviews.showingRange",
              "Showing {from} - {to} of {total} reviews",
              { from, to, total: filteredTotal },
            )}
          </p>

          {totalPages > 1 ? (
            <nav
              aria-label={tf("common.pagination", "Pagination")}
              className="flex items-center gap-1.5"
            >
              <PageArrow
                direction="prev"
                disabled={page <= 1}
                label={tf("common.previous", "Previous")}
                onClick={() => goToPage(page - 1)}
              />
              {pageNumbers(page, totalPages).map((entry, index) =>
                entry === "…" ? (
                  <span
                    key={`gap-${index}`}
                    className="px-1 text-sm text-muted-foreground"
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={entry}
                    type="button"
                    aria-current={entry === page ? "page" : undefined}
                    onClick={() => goToPage(entry)}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors",
                      entry === page
                        ? "bg-foreground text-background"
                        : "text-foreground hover:bg-muted",
                    )}
                  >
                    {entry}
                  </button>
                ),
              )}
              <PageArrow
                direction="next"
                disabled={page >= totalPages}
                label={tf("common.next", "Next")}
                onClick={() => goToPage(page + 1)}
              />
            </nav>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** 1 … window around the current page … last, capped at 7 slots. */
function pageNumbers(current: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const middle = [current - 1, current, current + 1].filter(
    (value) => value > 1 && value < totalPages,
  );
  const entries: (number | "…")[] = [1];
  if ((middle[0] ?? totalPages) > 2) entries.push("…");
  entries.push(...middle);
  if ((middle[middle.length - 1] ?? 1) < totalPages - 1) entries.push("…");
  entries.push(totalPages);
  return entries;
}

function PageArrow({
  direction,
  disabled,
  label,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-muted/70 disabled:opacity-40"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function ReviewsListSkeleton() {
  return (
    <section className="py-8">
      <Skeleton className="mb-5 h-8 w-36" />
      <div className="flex items-center gap-4 border-t border-border pt-4">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="ms-auto h-8 w-56" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-3 py-8">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-4 w-52" />
          </div>
        ))}
      </div>
    </section>
  );
}
