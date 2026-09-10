"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Mail, Phone, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { apiClient, ApiClientError } from "@/lib/api/client";
import {
  QUOTE_REQUEST_STATUSES,
  QUOTE_REQUEST_STATUS_LABELS,
} from "@/lib/quotes/quote-status";
import type { QuoteRequestRow } from "@/lib/quotes/quotes";

/**
 * The quote inbox: every "Price on request" enquiry a shopper has sent.
 *
 * A working queue, not a report — the merchant reads who asked for what,
 * emails or calls them back, and moves the row along. Answering happens in a
 * mail client on purpose: a quote is a negotiation, and the store has no
 * business pretending a status dropdown is one.
 */

function statusVariant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "won") return "default";
  if (status === "lost") return "destructive";
  if (status === "new") return "secondary";
  return "outline";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export function QuotesDataTable({ locale }: { locale: string }) {
  const { confirmDelete } = useConfirmation();
  const [quotes, setQuotes] = useState<QuoteRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchQuotes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: "1", limit: "50" });
      if (search.trim()) params.set("search", search.trim());
      if (status !== "all") params.set("status", status);
      const rows = await apiClient.get<QuoteRequestRow[]>(
        `/api/admin/quotes?${params.toString()}`,
      );
      setQuotes(rows || []);
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "Failed to load quote requests",
      );
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  // Debounced so typing in the search box does not fire a request per key.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchQuotes();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [fetchQuotes]);

  const changeStatus = async (id: string, next: string) => {
    setUpdatingId(id);
    try {
      const updated = await apiClient.patch<QuoteRequestRow>(
        `/api/admin/quotes/${id}`,
        { status: next },
      );
      setQuotes((current) =>
        current.map((row) => (row._id === id ? { ...row, ...updated } : row)),
      );
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "Failed to update the quote request",
      );
    } finally {
      setUpdatingId(null);
    }
  };

  const removeQuote = async (row: QuoteRequestRow) => {
    const confirmed = await confirmDelete(
      `${row.name} — ${row.productName}`,
    );
    if (!confirmed) return;

    try {
      await apiClient.delete(`/api/admin/quotes/${row._id}`);
      setQuotes((current) => current.filter((item) => item._id !== row._id));
      toast.success("Quote request deleted");
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "Failed to delete the quote request",
      );
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>Quote requests</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, company or product"
              className="w-full ps-8 sm:w-72"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {QUOTE_REQUEST_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {QUOTE_REQUEST_STATUS_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : quotes.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No quote requests yet. They arrive when a shopper asks for a price
            on a product you have marked{" "}
            <span className="font-medium">Price on request</span>.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Requested</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-end">Qty</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="w-40">Status</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(row.createdAt)}
                    </TableCell>
                    <TableCell className="max-w-[16rem]">
                      {row.productSlug ? (
                        <Link
                          href={`/${locale}/products/${row.productSlug}`}
                          className="font-medium hover:underline"
                        >
                          {row.productName}
                        </Link>
                      ) : (
                        <span className="font-medium">{row.productName}</span>
                      )}
                      {row.variantName ? (
                        <span className="block text-xs text-muted-foreground">
                          {row.variantName}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-[16rem]">
                      <span className="block font-medium">{row.name}</span>
                      {row.company ? (
                        <span className="block text-xs text-muted-foreground">
                          {row.company}
                        </span>
                      ) : null}
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <a
                          href={`mailto:${row.email}`}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <Mail className="h-3 w-3" />
                          {row.email}
                        </a>
                        {row.phone ? (
                          <a
                            href={`tel:${row.phone}`}
                            className="inline-flex items-center gap-1 text-muted-foreground hover:underline"
                          >
                            <Phone className="h-3 w-3" />
                            {row.phone}
                          </a>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {row.quantity}
                    </TableCell>
                    <TableCell className="max-w-[22rem]">
                      <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                        {row.message || "—"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Select
                          value={row.status}
                          onValueChange={(next) => changeStatus(row._id, next)}
                          disabled={updatingId === row._id}
                        >
                          <SelectTrigger className="w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {QUOTE_REQUEST_STATUSES.map((value) => (
                              <SelectItem key={value} value={value}>
                                {QUOTE_REQUEST_STATUS_LABELS[value]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Badge
                          variant={statusVariant(row.status)}
                          className="hidden xl:inline-flex"
                        >
                          {QUOTE_REQUEST_STATUS_LABELS[row.status] || row.status}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete quote request"
                        onClick={() => removeQuote(row)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
