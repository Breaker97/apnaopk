"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { AlertCircle, ChevronRight, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/providers/currency-provider";
import { ORDER_STATUS } from "@/config/app.config";
import { getPreorderStatusLabel } from "@/lib/orders/preorder-status-label";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

// Matches the server default limit for /api/orders (parsePageLimit defaultLimit).
const ORDERS_PAGE_SIZE = 10;

interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  purchaseType?: string;
  preorderReleaseDate?: string;
  preorderStatus?: string;
}

/** Statuses carrying an `orders.*` label in every locale. */
const TRANSLATED_ORDER_STATUSES = [
  "pending",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
];

/** One seller's consignment; only sent for orders that span sellers. */
interface Shipment {
  _id?: string;
  vendorId?: string;
  vendorName?: string;
  status: string;
}

interface Order {
  _id: string;
  orderNumber: string;
  status: string;
  total: number;
  items: OrderItem[];
  subOrders?: Shipment[];
  hasPreorder?: boolean;
  preorderStatus?: string;
  preorderReleaseDate?: string;
  createdAt: string;
}

interface CustomerOrdersListProps {
  locale: string;
  filter?: "all" | "regular" | "preorders";
  emptyTitle?: string;
  emptyDescription?: string;
}

function getPreorderReleaseDate(order: Order) {
  if (order.preorderReleaseDate) return order.preorderReleaseDate;
  return order.items.find((item) => item.purchaseType === "preorder")
    ?.preorderReleaseDate;
}

function getPreorderStatus(order: Order) {
  if (order.preorderStatus) return order.preorderStatus;
  return order.items.find((item) => item.purchaseType === "preorder")
    ?.preorderStatus;
}

function getStatusBadge(status: string) {
  const config: Record<
    string,
    {
      variant: "default" | "secondary" | "outline" | "destructive";
      label: string;
    }
  > = {
    [ORDER_STATUS.PENDING]: { variant: "outline", label: "Pending" },
    [ORDER_STATUS.PREORDERED]: { variant: "outline", label: "Pre-ordered" },
    [ORDER_STATUS.PROCESSING]: { variant: "secondary", label: "Processing" },
    [ORDER_STATUS.SHIPPED]: { variant: "default", label: "Shipped" },
    [ORDER_STATUS.DELIVERED]: { variant: "default", label: "Delivered" },
    [ORDER_STATUS.CANCELLED]: { variant: "destructive", label: "Cancelled" },
  };
  const { variant, label } = config[status] || {
    variant: "outline",
    label: status,
  };
  return <Badge variant={variant}>{label}</Badge>;
}

export function CustomerOrdersList({
  locale,
  filter = "all",
  emptyTitle,
  emptyDescription,
}: CustomerOrdersListProps) {
  const t = useTranslations();
  const { formatPrice } = useCurrency();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);

  // Fetch a single page from the server-paginated /api/orders (defaultLimit=10).
  // Previously this component fetched with no page/limit and rendered only the
  // first page as if it were the whole history, hiding every order past the
  // 10th. Now it reads the pagination envelope and appends via "Load more".
  const fetchOrdersPage = useCallback(
    async (
      nextPage: number,
    ): Promise<{ list: Order[]; hasNext: boolean }> => {
      const params = new URLSearchParams();
      params.set("page", String(nextPage));
      params.set("limit", String(ORDERS_PAGE_SIZE));
      if (filter === "preorders") params.set("type", "preorders");
      if (filter === "regular") params.set("type", "regular");

      const res = await fetch(`/api/orders?${params.toString()}`);
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.message || "Failed to load orders");
      }

      const payload = data.data;
      const list: Order[] = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
          ? payload
          : [];
      return { list, hasNext: Boolean(payload?.pagination?.hasNext) };
    },
    [filter],
  );

  // Initial load, and reset to page 1 whenever the filter tab changes.
  useApplyOnChange([fetchOrdersPage], () => {
    setIsLoading(true);
    setError(null);
    setPage(1);
  });

  useEffect(() => {
    let cancelled = false;

    fetchOrdersPage(1)
      .then(({ list, hasNext: more }) => {
        if (cancelled) return;
        setOrders(list);
        setHasNext(more);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load orders");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchOrdersPage]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasNext) return;
    setIsLoadingMore(true);
    try {
      const nextPage = page + 1;
      const { list, hasNext: more } = await fetchOrdersPage(nextPage);
      setOrders((current) => {
        const seen = new Set(current.map((order) => order._id));
        return [...current, ...list.filter((order) => !seen.has(order._id))];
      });
      setPage(nextPage);
      setHasNext(more);
    } catch {
      // Keep the already-loaded orders; the button stays available to retry.
    } finally {
      setIsLoadingMore(false);
    }
  }, [fetchOrdersPage, hasNext, isLoadingMore, page]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-4 space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">{error}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => window.location.reload()}
        >
          Try Again
        </Button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="text-center py-12">
        <Package className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="font-medium text-lg mb-2">
          {emptyTitle ||
            t("orders.noOrders")}
        </h3>
        <p className="text-muted-foreground mb-4">
          {emptyDescription ||
            t("orders.startShopping")}
        </p>
        <Button asChild>
          <Link href={`/${locale}/products`}>
            {t("orders.browseProducts")}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {orders.map((order) => {
        const preorderReleaseDate = getPreorderReleaseDate(order);
        const preorderStatusLabel = getPreorderStatusLabel(
          getPreorderStatus(order),
        );

        return (
          <Link
            key={order._id}
            href={`/${locale}/account/orders/${order._id}`}
            className="block rounded-lg border p-4 hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{order.orderNumber}</span>
                {getStatusBadge(order.status)}
                {order.hasPreorder ? (
                  <Badge variant="outline">Pre-order</Badge>
                ) : null}
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              {order.items.length} {order.items.length === 1 ? "item" : "items"}{" "}
              - {format(new Date(order.createdAt), "MMM d, yyyy 'at' h:mm a")}
            </p>
            {/* The order badge above is the least advanced of these, so on a
                split order it is true but incomplete — a shopper whose first
                parcel arrived should not have to open the order to learn that.
                Only worth the room when the sellers actually disagree. */}
            {(order.subOrders?.length ?? 0) > 1 &&
            new Set(order.subOrders!.map((shipment) => shipment.status)).size > 1 ? (
              <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
                {order.subOrders!.map((shipment, position) => (
                  <span
                    key={shipment._id ?? shipment.vendorId ?? position}
                    className="text-xs text-muted-foreground"
                  >
                    {shipment.vendorName || t("product.vendor")}:{" "}
                    <span className="font-medium">
                      {TRANSLATED_ORDER_STATUSES.includes(shipment.status)
                        ? t(`orders.${shipment.status}`)
                        : shipment.status}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}
            {order.hasPreorder ? (
              <p className="text-sm text-muted-foreground mb-2">
                {preorderStatusLabel || "Pre-order"}
                {preorderReleaseDate
                  ? ` - ships around ${format(
                      new Date(preorderReleaseDate),
                      "MMM d, yyyy",
                    )}`
                  : ""}
              </p>
            ) : null}
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="font-semibold">{formatPrice(order.total)}</span>
            </div>
          </Link>
        );
      })}

      {hasNext ? (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            onClick={() => void loadMore()}
            disabled={isLoadingMore}
          >
            {isLoadingMore
              ? t.has("common.loading")
                ? t("common.loading")
                : "Loading..."
              : t.has("common.loadMore")
                ? t("common.loadMore")
                : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
