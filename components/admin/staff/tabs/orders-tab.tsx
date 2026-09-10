"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useCurrency } from "@/providers/currency-provider";
import type { StaffStats } from "../staff-detail-types";

interface StaffOrderRow {
  _id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  channel?: string;
  total: number;
  customerName?: string;
  createdAt: string;
}

interface StaffOrdersResponse {
  data: StaffOrderRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  stats: StaffStats;
}

interface OrdersTabProps {
  /** `/api/admin/staff` or `/api/vendor/staff`. */
  apiBasePath: string;
  staffId: string;
  /** Where an order number links to, e.g. `/en/admin/orders`. */
  orderBasePath: string;
  /** Keeps the header KPIs in step with what this tab loaded. */
  onStatsChange?: (stats: StaffStats) => void;
}

const CHANNELS = [
  { value: "all", label: "All channels" },
  { value: "pos", label: "POS" },
  { value: "online", label: "Online" },
] as const;

const STATUS_VARIANT: Record<
  string,
  "default" | "outline" | "secondary" | "destructive"
> = {
  pending: "outline",
  processing: "secondary",
  shipped: "default",
  delivered: "default",
  cancelled: "destructive",
  paid: "default",
  refunded: "destructive",
  partially_refunded: "destructive",
};

function labelize(value?: string) {
  if (!value) return "—";
  return value
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const PAGE_SIZE = 10;

export function OrdersTab({
  apiBasePath,
  staffId,
  orderBasePath,
  onStatsChange,
}: OrdersTabProps) {
  const { formatPrice } = useCurrency();
  const [rows, setRows] = useState<StaffOrderRow[]>([]);
  const [channel, setChannel] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      const res = await apiClient.get<StaffOrdersResponse>(
        `${apiBasePath}/${staffId}/orders?page=${page}&limit=${PAGE_SIZE}&channel=${channel}`,
      );
      setRows(res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
      setTotal(res.pagination?.total || 0);
      // Only the unfiltered view describes the whole staff member, so a
      // channel filter must not rewrite the header KPIs.
      if (res.stats && channel === "all") onStatsChange?.(res.stats);
    } catch (error) {
      console.error("Failed to load staff orders:", error);
      setHasError(true);
      toast.error("Failed to load orders");
    } finally {
      setIsLoading(false);
    }
  }, [apiBasePath, channel, onStatsChange, page, staffId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Orders processed</CardTitle>
            <CardDescription>
              Orders rung up or created by this staff member, newest first
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {CHANNELS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={channel === option.value ? "default" : "outline"}
                onClick={() => {
                  setChannel(option.value);
                  setPage(1);
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
        ) : hasError ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Orders could not be loaded.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={load}>
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <ShoppingBag className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No orders recorded for this staff member yet
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[640px]">
                <thead className="bg-muted/50">
                  <tr className="border-b">
                    {["Order", "Date", "Channel", "Customer", "Total", "Status"].map(
                      (heading) => (
                        <th
                          key={heading}
                          className={cn(
                            "px-4 py-2.5 text-left text-xs font-semibold tracking-wider text-muted-foreground uppercase",
                            heading === "Total" && "text-right",
                          )}
                        >
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row._id} className="border-b last:border-b-0">
                      <td className="px-4 py-3 text-sm font-medium">
                        <Link
                          href={`${orderBasePath}/${row._id}`}
                          className="tabular-nums hover:underline"
                        >
                          #{row.orderNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {formatDate(row.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={cn(
                            row.channel === "pos" &&
                              "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
                          )}
                        >
                          {row.channel === "pos" ? "POS" : "Online"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {row.customerName || "Walk-in"}
                      </td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums">
                        {formatPrice(row.total)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Badge
                            variant={STATUS_VARIANT[row.status] ?? "outline"}
                          >
                            {labelize(row.status)}
                          </Badge>
                          <Badge
                            variant={
                              STATUS_VARIANT[row.paymentStatus] ?? "outline"
                            }
                          >
                            {labelize(row.paymentStatus)}
                          </Badge>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {total.toLocaleString()} order{total === 1 ? "" : "s"} · page{" "}
                {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
