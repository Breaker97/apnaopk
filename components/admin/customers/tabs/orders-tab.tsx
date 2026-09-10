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
import { SummaryStat } from "../summary-stat";
import type { CustomerStats } from "../customer-detail-types";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface CustomerOrderRow {
  _id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  total: number;
  currency?: string;
  channel?: string;
  itemCount: number;
  refundedTotal: number;
  createdAt: string;
}

interface OrdersResponse {
  data: CustomerOrderRow[];
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
  customerId: string;
  basePath: string;
  stats: CustomerStats;
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

export function OrdersTab({ customerId, basePath, stats }: OrdersTabProps) {
  const router = useRouter();
  const { formatPrice } = useCurrency();
  const [rows, setRows] = useState<CustomerOrderRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<{
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  } | null>(null);

  useApplyOnChange([customerId, page], () => {
    setIsLoading(true);
  });

  useEffect(() => {
    let active = true;

    apiClient
      .get<OrdersResponse>(
        `/api/admin/customers/${customerId}/orders?page=${page}&limit=10`,
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
      })
      .catch((error) => {
        if (!active) return;
        console.error("Failed to load customer orders:", error);
        toast.error("Failed to load orders");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [customerId, page]);

  const columns: DataTableColumn<CustomerOrderRow>[] = [
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
        <StatusCell status={row.status} statusMap={ORDER_STATUS_MAP} />
      ),
      className: "w-[130px]",
    },
    {
      id: "payment",
      header: "Payment",
      cell: (row) => (
        <StatusCell
          status={row.paymentStatus}
          statusMap={PAYMENT_STATUS_MAP}
        />
      ),
      className: "w-[150px]",
    },
    {
      id: "items",
      header: "Items",
      cell: (row) => <span className="tabular-nums">{row.itemCount}</span>,
      className: "w-[90px]",
    },
    {
      id: "total",
      header: "Total",
      cell: (row) => (
        <CurrencyCell value={row.total} />
      ),
      className: "w-[130px]",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryStat
          label="Total orders"
          value={(stats.totalOrders ?? 0).toLocaleString()}
        />
        <SummaryStat
          label="Total spent"
          value={formatPrice(stats.totalSpent ?? 0)}
        />
        <SummaryStat
          label="Avg. order value"
          value={formatPrice(stats.averageOrderValue ?? 0)}
        />
        <SummaryStat
          label="Last order"
          value={
            stats.lastOrderDate
              ? new Date(stats.lastOrderDate).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })
              : "—"
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Order history</CardTitle>
          <CardDescription>
            All orders placed by this customer, newest first
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
            emptyMessage="This customer has no orders yet"
          />
        </CardContent>
      </Card>
    </div>
  );
}
