"use client";

import { useState } from "react";
import Link from "@/components/language/link";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { AlertCircle, ChevronRight, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCurrency } from "@/providers/currency-provider";
import { ORDER_STATUS } from "@/config/app.config";
import { getPreorderStatusLabel } from "@/lib/orders/preorder-status-label";
import { useSuspenseResource } from "@/hooks/use-suspense-resource";

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

type OrdersFilter = "all" | "regular" | "preorders";

interface CustomerOrdersListProps {
  filter?: OrdersFilter;
  emptyTitle?: string;
  emptyDescription?: string;
}

/** The pages loaded so far, held as one list so "Load more" survives a visit away. */
interface LoadedOrders {
  orders: Order[];
  page: number;
  hasNext: boolean;
}

// Fetch a single page from the server-paginated /api/orders (defaultLimit=10).
// Previously this component fetched with no page/limit and rendered only the
// first page as if it were the whole history, hiding every order past the
// 10th. Now it reads the pagination envelope and appends via "Load more".
async function fetchOrdersPage(
  filter: OrdersFilter,
  nextPage: number,
): Promise<{ list: Order[]; hasNext: boolean }> {
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
  filter = "all",
  emptyTitle,
  emptyDescription,
}: CustomerOrdersListProps) {
  const t = useTranslations();
  const { formatPrice } = useCurrency();
  // Suspends on the first page — the list pages wrap this in
  // `<ClientSuspense>` with the list skeleton. Opening an order and coming
  // back renders the held list, "Load more" pages included, with no request.
  const { data, error, mutate } = useSuspenseResource<LoadedOrders>(
    `/api/orders?type=${filter}&limit=${ORDERS_PAGE_SIZE}`,
    {
      load: async () => {
        const { list, hasNext } = await fetchOrdersPage(filter, 1);
        return { orders: list, page: 1, hasNext };
      },
    },
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const orders = data?.orders ?? [];
  const hasNext = data?.hasNext ?? false;

  const loadMore = async () => {
    if (!data || isLoadingMore || !hasNext) return;
    setIsLoadingMore(true);
    try {
      const nextPage = data.page + 1;
      const { list, hasNext: more } = await fetchOrdersPage(filter, nextPage);
      mutate((current) => {
        const seen = new Set(current.orders.map((order) => order._id));
        return {
          orders: [
            ...current.orders,
            ...list.filter((order) => !seen.has(order._id)),
          ],
          page: nextPage,
          hasNext: more,
        };
      });
    } catch {
      // Keep the already-loaded orders; the button stays available to retry.
    } finally {
      setIsLoadingMore(false);
    }
  };

  if (error) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Failed to load orders</p>
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
          <Link href="/products">
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
            href={`/account/orders/${order._id}`}
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
