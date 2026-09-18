"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Mail, Phone, Search, Tag, Trash2 } from "lucide-react";
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
  QUOTE_OFFER_STATE_LABELS,
  QUOTE_REQUEST_STATUSES,
  QUOTE_REQUEST_STATUS_LABELS,
  type QuoteOfferState,
} from "@/lib/quotes/quote-status";
import type { QuoteRequestRow } from "@/lib/quotes/quotes";
import { QuoteOfferDialog } from "@/components/admin/quote-offer-dialog";
import { useCurrency } from "@/providers/currency-provider";

/**
 * The quote inbox: every "Price on request" enquiry a shopper has sent.
 *
 * A working queue, not a report — the merchant reads who asked for what,
 * sends back a price, and moves the row along. The negotiation itself still
 * happens by email or phone; what this page owns is the one step that has to
 * be a store action rather than a conversation, because it is what lets the
 * shopper actually buy: the price, sent to their account.
 */

function statusVariant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "won") return "default";
  if (status === "lost") return "destructive";
  if (status === "new") return "secondary";
  return "outline";
}

function offerVariant(
  state: QuoteOfferState,
): "default" | "secondary" | "outline" | "destructive" {
  if (state === "live") return "default";
  if (state === "ordered") return "secondary";
  if (state === "expired" || state === "withdrawn") return "destructive";
  return "outline";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export function QuotesDataTable({ locale }: { locale: string }) {
  const { confirmDelete } = useConfirmation();
  const { formatPrice } = useCurrency();
  const [offerQuote, setOfferQuote] = useState<QuoteRequestRow | null>(null);
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
      // The route answers with `paginatedResponse`, so the rows arrive under
      // `data` — reading the envelope as an array is how this table used to
      // hand React something with no `.map`.
      const result = await apiClient.get<{ data: QuoteRequestRow[] }>(
        `/api/admin/quotes?${params.toString()}`,
      );
      setQuotes(Array.isArray(result?.data) ? result.data : []);
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

  const applyRow = (row: QuoteRequestRow) => {
    setQuotes((current) =>
      current.map((item) => (item._id === row._id ? { ...item, ...row } : item)),
    );
    setOfferQuote((current) =>
      current && current._id === row._id ? { ...current, ...row } : current,
    );
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
      <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <CardTitle>Quote requests</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1 lg:flex-none">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, company or product"
              className="w-full ps-8 lg:w-72"
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
          // Laid out by the table's own width, not the viewport's: the admin
          // sidebar takes a different share of the screen open and collapsed.
          // Under 56rem each request stacks into a card; under 80rem the date,
          // quantity and message fold in under the product instead of taking
          // columns of their own.
          <div className="@container">
            <Table className="@max-4xl:block">
              <TableHeader className="@max-4xl:hidden">
                <TableRow>
                  <TableHead className="hidden @7xl:table-cell">
                    Requested
                  </TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden text-end @7xl:table-cell">
                    Qty
                  </TableHead>
                  <TableHead className="hidden @7xl:table-cell">
                    Message
                  </TableHead>
                  <TableHead className="w-44">Price</TableHead>
                  <TableHead className="w-40">Status</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody className="@max-4xl:block">
                {quotes.map((row) => (
                  <TableRow
                    key={row._id}
                    className="@max-4xl:flex @max-4xl:flex-wrap @max-4xl:items-start @max-4xl:gap-3 @max-4xl:py-4"
                  >
                    <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground @7xl:table-cell">
                      {formatDate(row.createdAt)}
                    </TableCell>
                    {/* Text cells wrap inside a sized box: the cell default is
                        nowrap, and a capped column of unbreakable text spills
                        over the one beside it. */}
                    <TableCell className="whitespace-normal @max-4xl:-order-2 @max-4xl:min-w-0 @max-4xl:flex-1 @max-4xl:p-0">
                      <div className="wrap-anywhere @4xl:min-w-44 @4xl:max-w-96">
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
                        <span className="mt-1 block text-xs text-muted-foreground @7xl:hidden">
                          Qty {row.quantity} · Requested{" "}
                          {formatDate(row.createdAt)}
                        </span>
                        {row.message ? (
                          <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap border-s-2 ps-2 text-xs text-muted-foreground @7xl:hidden">
                            {row.message}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal @max-4xl:basis-full @max-4xl:p-0">
                      <div className="wrap-anywhere @4xl:min-w-44 @4xl:max-w-72">
                        <span className="block font-medium">{row.name}</span>
                        {row.company ? (
                          <span className="block text-xs text-muted-foreground">
                            {row.company}
                          </span>
                        ) : null}
                        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <a
                            href={`mailto:${row.email}`}
                            className="inline-flex items-start gap-1 text-primary hover:underline"
                          >
                            <Mail className="mt-0.5 h-3 w-3 shrink-0" />
                            {row.email}
                          </a>
                          {row.phone ? (
                            <a
                              href={`tel:${row.phone}`}
                              className="inline-flex items-start gap-1 text-muted-foreground hover:underline"
                            >
                              <Phone className="mt-0.5 h-3 w-3 shrink-0" />
                              {row.phone}
                            </a>
                          ) : null}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-end tabular-nums @7xl:table-cell">
                      {row.quantity}
                    </TableCell>
                    <TableCell className="hidden whitespace-normal @7xl:table-cell">
                      <p className="line-clamp-3 min-w-36 max-w-80 whitespace-pre-wrap text-sm text-muted-foreground wrap-anywhere">
                        {row.message || "—"}
                      </p>
                    </TableCell>
                    <TableCell className="@max-4xl:p-0">
                      {row.offer ? (
                        <div className="space-y-1">
                          <span className="block text-sm font-medium tabular-nums">
                            {formatPrice(row.offer.unitPrice)} × {row.offer.quantity}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant={offerVariant(row.offerState)}
                              className="text-[10px]"
                            >
                              {QUOTE_OFFER_STATE_LABELS[row.offerState]}
                            </Badge>
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-xs"
                              onClick={() => setOfferQuote(row)}
                            >
                              Edit
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setOfferQuote(row)}
                        >
                          <Tag className="me-1.5 h-3.5 w-3.5" />
                          Send price
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="@max-4xl:ms-auto @max-4xl:p-0">
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
                          className="hidden @7xl:inline-flex"
                        >
                          {QUOTE_REQUEST_STATUS_LABELS[row.status] || row.status}
                        </Badge>
                      </div>
                    </TableCell>
                    {/* On a card the trash sits beside the product title. */}
                    <TableCell className="@max-4xl:-order-1 @max-4xl:-mt-2 @max-4xl:p-0">
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

      <QuoteOfferDialog
        quote={offerQuote}
        open={Boolean(offerQuote)}
        onOpenChange={(next) => {
          if (!next) setOfferQuote(null);
        }}
        onSaved={applyRow}
      />
    </Card>
  );
}
