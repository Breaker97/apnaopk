"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { SummaryStat } from "../summary-stat";
import type { CustomerHeaderData } from "../customer-detail-types";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface RecentReview {
  _id: string;
  productId: string | null;
  productName: string;
  productImage?: string;
  rating: number;
  title?: string;
  comment: string;
  isApproved: boolean;
  createdAt: string;
}

interface ActivityResponse {
  reviewCount: number;
  wishlistCount: number;
  recentReviews: RecentReview[];
}

interface ActivityTabProps {
  customerId: string;
  acquisitionSource?: string;
  lastActiveAt?: string;
  createdAt?: string;
  stats: CustomerHeaderData["stats"];
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          className={cn(
            "h-3.5 w-3.5",
            value <= rating
              ? "fill-yellow-400 text-yellow-400"
              : "text-muted-foreground/40",
          )}
        />
      ))}
    </div>
  );
}

function formatDate(date?: string) {
  if (!date) return "—";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ActivityTab({
  customerId,
  acquisitionSource,
  lastActiveAt,
  createdAt,
  stats,
}: ActivityTabProps) {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useApplyOnChange([customerId], () => {
    setIsLoading(true);
  });

  useEffect(() => {
    let active = true;

    apiClient
      .get<ActivityResponse>(`/api/admin/customers/${customerId}/activity`)
      .then((res) => {
        if (active) setData(res);
      })
      .catch((error) => {
        if (!active) return;
        console.error("Failed to load customer activity:", error);
        toast.error("Failed to load activity");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [customerId]);

  const averageRating = stats.averageRating
    ? stats.averageRating.toFixed(1)
    : "—";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryStat
          label="Reviews"
          value={(data?.reviewCount ?? stats.totalReviews ?? 0).toLocaleString()}
        />
        <SummaryStat label="Avg. rating" value={averageRating} />
        <SummaryStat
          label="Wishlist items"
          value={(
            data?.wishlistCount ??
            stats.totalWishlistItems ??
            0
          ).toLocaleString()}
        />
        <SummaryStat
          label="Acquisition"
          value={acquisitionSource?.trim() || "Direct"}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent reviews</CardTitle>
            <CardDescription>Latest product reviews left by this customer</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ul className="divide-y">
                {Array.from({ length: 4 }).map((_, index) => (
                  <li key={index} className="flex gap-3 py-3 first:pt-0">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
                      </div>
                      <Skeleton className="h-3.5 w-24" />
                      <Skeleton className="h-4 w-full" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : !data?.recentReviews.length ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No reviews yet
              </p>
            ) : (
              <ul className="divide-y">
                {data.recentReviews.map((review) => (
                  <li key={review._id} className="flex gap-3 py-3 first:pt-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">
                          {review.productName}
                        </p>
                        <Badge
                          variant={review.isApproved ? "default" : "outline"}
                          className="shrink-0"
                        >
                          {review.isApproved ? "Published" : "Pending"}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <Stars rating={review.rating} />
                        <span className="text-xs text-muted-foreground">
                          {formatDate(review.createdAt)}
                        </span>
                      </div>
                      {review.title && (
                        <p className="mt-1 text-sm font-medium">
                          {review.title}
                        </p>
                      )}
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                        {review.comment}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
            <CardDescription>Account activity dates</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Customer since
              </p>
              <p className="text-sm font-medium">{formatDate(createdAt)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Last active
              </p>
              <p className="text-sm font-medium">{formatDate(lastActiveAt)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Last order
              </p>
              <p className="text-sm font-medium">
                {formatDate(stats.lastOrderDate)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
