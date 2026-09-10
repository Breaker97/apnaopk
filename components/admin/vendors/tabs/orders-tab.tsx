"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import {
  DataTable,
  CurrencyCell,
  DateCell,
  StatusCell,
  type DataTableColumn,
} from "@/components/ui/data-table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { useCurrency } from "@/providers/currency-provider";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface VendorOrderRow {
  _id: string;
  orderNumber: string;
  /** This vendor's sub-order fulfilment status. */
  status: string;
  /** The whole order's status, shown when it differs from the vendor's. */
  orderStatus: string;
  paymentStatus: string;
  /** This vendor's sub-order subtotal — their share of the order. */
  total: number;
  /** The whole order's total, shown when the order is split across vendors. */
  orderTotal: number;
  currency?: string;
  channel?: string;
  /** Line items belonging to this vendor, not the whole basket. */
  itemCount: number;
  /** Platform's cut of this sub-order. */
  commission: number;
  /** Subtotal less commission — what a payout would pay for this sub-order. */
  vendorEarnings: number;
  isSplitOrder: boolean;
  refundedTotal: number;
  createdAt: string;
}

interface OrdersResponse {
  data: VendorOrderRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

interface OrdersTabProps {
  vendorId: string;
  basePath: string;
  /** Reports the authoritative order count up so the header KPI can match. */
  onTotalChange?: (total: number) => void;
}

const ORDER_STATUS_MAP = {
  preordered: { label: "Preordered", variant: "secondary" as const },
  pending: { label: "Pending", variant: "outline" as const },
  processing: { label: "Processing", variant: "secondary" as const },
  shipped: { label: "Shipped", variant: "default" as const },
  delivered: { label: "Delivered", variant: "default" as const },
  cancelled: { label: "Cancelled", variant: "destructive" as const },
};

const PAYMENT_STATUS_MAP = {
  pending: { label: "Pending", variant: "outline" as const },
  paid: { label: "Paid", variant: "default" as const },
  partially_paid: { label: "Partially paid", variant: "secondary" as const },
  refunded: { label: "Refunded", variant: "destructive" as const },
  partially_refunded: {
    label: "Partially refunded",
    variant: "secondary" as const,
  },
};

function OrderTotalCell({ row }: { row: VendorOrderRow }) {
  const { formatPrice: format } = useCurrency();
  return (
    <div className="min-w-0">
      <CurrencyCell value={row.total} />
      {row.isSplitOrder && (
        <p className="truncate text-xs text-muted-foreground">
          of {format(row.orderTotal)} order
        </p>
      )}
    </div>
  );
}

export function OrdersTab({
  vendorId,
  basePath,
  onTotalChange,
}: OrdersTabProps) {
  const router = useRouter();
  const [rows, setRows] = useState<VendorOrderRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<{
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  } | null>(null);

  useApplyOnChange([vendorId, page, onTotalChange], () => {
    setIsLoading(true);
  });

  useEffect(() => {
    let active = true;

    apiClient
      .get<OrdersResponse>(
        `/api/admin/vendors/${vendorId}/orders?page=${page}&limit=10`,
      )
      .then((res) => {
        if (!active) return;
        setRows(res.data || []);
        setPagination({
          page: res.pagination.page,
          pageSize: res.pagination.limit,
          total: res.pagination.total,
          totalPages: res.pagination.totalPages,
        });
        onTotalChange?.(res.pagination.total);
      })
      .catch((error) => {
        if (!active) return;
        console.error("Failed to load vendor orders:", error);
        toast.error("Failed to load orders");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [vendorId, page, onTotalChange]);

  const columns: DataTableColumn<VendorOrderRow>[] = [
    {
      id: "orderNumber",
      header: "Order",
      cell: (row) => (
        <Link
          href={`${basePath}/orders/${row._id}`}
          className="inline-flex items-center gap-1.5 font-medium hover:underline"
        >
          #{row.orderNumber}
          <ExternalLink className="h-3 w-3 text-muted-foreground" />
        </Link>
      ),
      className: "w-[180px]",
    },
    {
      id: "date",
      header: "Date",
      cell: (row) => <DateCell date={row.createdAt} format="medium" />,
      className: "w-[140px]",
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <div className="min-w-0">
          <StatusCell status={row.status} statusMap={ORDER_STATUS_MAP} />
          {row.orderStatus !== row.status && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Order: {row.orderStatus}
            </p>
          )}
        </div>
      ),
      className: "w-[140px]",
    },
    {
      id: "payment",
      header: "Payment",
      cell: (row) => (
        <StatusCell status={row.paymentStatus} statusMap={PAYMENT_STATUS_MAP} />
      ),
      className: "w-[150px]",
    },
    {
      id: "items",
      header: "Items",
      cell: (row) => <span className="tabular-nums">{row.itemCount}</span>,
      className: "w-[80px]",
    },
    {
      id: "total",
      header: "Vendor total",
      cell: (row) => <OrderTotalCell row={row} />,
      className: "w-[150px]",
    },
    {
      id: "commission",
      header: "Commission",
      cell: (row) => (
        <CurrencyCell value={row.commission} />
      ),
      className: "w-[130px]",
    },
    {
      id: "earnings",
      header: "Earnings",
      cell: (row) => (
        <CurrencyCell value={row.vendorEarnings} />
      ),
      className: "w-[130px]",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order history</CardTitle>
        <CardDescription>
          All orders containing this vendor&apos;s items, newest first. Status,
          item count and money are this vendor&apos;s share of each order —
          payment status is order-wide. Earnings shown here are before refunds
          and order-level discounts; see the Payouts tab for the payable figure.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          data={rows}
          columns={columns}
          keyField="_id"
          isLoading={isLoading}
          loadingMode="rows"
          pagination={pagination ?? undefined}
          onPageChange={setPage}
          onRowClick={(row) => {
            router.push(`${basePath}/orders/${row._id}`);
          }}
          emptyMessage="This vendor has no orders yet"
        />
      </CardContent>
    </Card>
  );
}
