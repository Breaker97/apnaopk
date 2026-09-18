"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronDown, Package, Star } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AppImage } from "@/components/ui/app-image";
import { InteractiveStarRating } from "@/components/reviews/star-rating";
import { ReviewDialog, type ReviewTarget } from "@/components/reviews/review-dialog";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import type { PendingReview } from "@/lib/catalog/review-eligibility";

/** Rows shown before "Show more" — enough to act on without burying the page. */
const COLLAPSED_COUNT = 3;

interface PendingReviewsCardProps {
  locale: string;
  items: PendingReview[];
}

/**
 * "Rate your purchases": the delivered products still waiting for the
 * shopper's review. Tapping a star opens the review with that rating already
 * chosen; a reviewed product leaves the list, and the card leaves the page
 * with the last one.
 */
export function PendingReviewsCard({
  locale,
  items: initialItems,
}: PendingReviewsCardProps) {
  const t = useTranslations();
  const tf = useFallbackTranslator(t);
  const [items, setItems] = useState(initialItems);
  const [expanded, setExpanded] = useState(false);
  const [target, setTarget] = useState<ReviewTarget | null>(null);

  if (items.length === 0) return null;

  const visibleItems = expanded ? items : items.slice(0, COLLAPSED_COUNT);
  const hiddenCount = items.length - visibleItems.length;

  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const openReview = (item: PendingReview, rating?: number) =>
    setTarget({
      productId: item.productId,
      orderId: item.orderId,
      name: item.name,
      image: item.image,
      orderNumber: item.orderNumber,
      rating,
    });

  return (
    <Card className="border-0 bg-transparent py-0 shadow-none sm:border sm:bg-card sm:py-6 sm:shadow-sm">
      <CardHeader className="px-0 sm:px-6">
        <CardTitle className="flex items-center gap-2">
          <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" aria-hidden />
          {tf("reviews.pendingTitle", "Rate your purchases")}
        </CardTitle>
        <CardDescription>
          {tf(
            "reviews.pendingDescription",
            "Your orders have arrived. Tell other shoppers what you think.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {visibleItems.map((item) => (
            <li
              key={item.productId}
              className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="relative size-12 shrink-0 overflow-hidden rounded-md bg-muted">
                  {item.image ? (
                    <AppImage
                      src={item.image}
                      alt={item.name}
                      fill
                      sizes="48px"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Package className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <Link
                    href={`/${locale}/products/${item.slug}`}
                    className="line-clamp-1 text-sm font-medium hover:underline"
                  >
                    {item.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {item.deliveredAt
                      ? `${tf("reviews.deliveredOn", "Delivered {date}", {
                          date: formatDate(item.deliveredAt),
                        })} · `
                      : null}
                    <Link
                      href={`/${locale}/account/orders/${item.orderId}`}
                      className="hover:underline"
                    >
                      #{item.orderNumber}
                    </Link>
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                <InteractiveStarRating
                  value={0}
                  size="sm"
                  onChange={(rating) => openReview(item, rating)}
                  labelFor={(star) =>
                    tf("reviews.rateStar", "Rate {count} out of 5", {
                      count: star,
                    })
                  }
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openReview(item)}
                >
                  {tf("reviews.writeReview", "Write a Review")}
                </Button>
              </div>
            </li>
          ))}
        </ul>

        {items.length > COLLAPSED_COUNT ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 min-h-11 w-full sm:min-h-8"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded
              ? tf("reviews.showFewer", "Show fewer")
              : tf("reviews.showMore", "Show {count} more", {
                  count: hiddenCount,
                })}
            <ChevronDown
              className={`ml-1 h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </Button>
        ) : null}
      </CardContent>

      <ReviewDialog
        target={target}
        onClose={() => setTarget(null)}
        onReviewed={(reviewed) => {
          setTarget(null);
          setItems((current) =>
            current.filter((item) => item.productId !== reviewed.productId),
          );
        }}
      />
    </Card>
  );
}
