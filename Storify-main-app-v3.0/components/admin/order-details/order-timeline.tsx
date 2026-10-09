import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTranslations } from "next-intl/server";
import { getOrderTimeline } from "@/lib/orders/order-details";
import type { StaffAccessScope } from "@/lib/access/staff-scope";
import { OrderTimelineFeed } from "./order-timeline-feed";

interface OrderTimelineProps {
  orderId: string;
  staffScope?: StaffAccessScope | null;
  /** Whether this viewer may post comments (EDIT_ORDERS / MANAGE_ORDERS). */
  canComment?: boolean;
  /** Whether they may delete other people's (DELETE_ORDERS / MANAGE_ORDERS). */
  canModerate?: boolean;
  /** Used to decide which comments the viewer may edit — their own only. */
  currentUserId?: string;
}

/**
 * Order timeline: system events and staff comments in one stream.
 *
 * Stays a server component so the page can keep it in a `<Suspense>` boundary
 * and render the order without waiting on this query. It does the reading and
 * hands plain serializable rows to a client island, which owns the composer
 * and the per-comment edit/delete — the repo has no server actions, so every
 * mutation is an `apiClient` call followed by `router.refresh()`, and this
 * loader is deliberately uncached so that refresh actually re-reads.
 */
export async function OrderTimeline({
  orderId,
  staffScope,
  canComment,
  canModerate,
  currentUserId,
}: OrderTimelineProps) {
  const [t, entries] = await Promise.all([
    getTranslations("admin"),
    getOrderTimeline(orderId, staffScope),
  ]);

  return (
    <Card className="gap-2">
      <CardHeader className="pb-4">
        <CardTitle>{t("orderDetails.timeline")}</CardTitle>
      </CardHeader>
      <CardContent>
        <OrderTimelineFeed
          orderId={orderId}
          entries={entries}
          canComment={canComment}
          canModerate={canModerate}
          currentUserId={currentUserId}
        />
      </CardContent>
    </Card>
  );
}
