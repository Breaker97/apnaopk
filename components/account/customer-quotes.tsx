"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/toast-notification";
import { useCart } from "@/hooks/use-cart";
import { useLiveResource } from "@/hooks/use-live-resource";
import { useCurrency } from "@/providers/currency-provider";
import {
  QUOTE_REQUEST_STATUS_LABELS,
  type QuoteOfferState,
} from "@/lib/quotes/quote-status";
import type { QuoteRequestRow } from "@/lib/quotes/quotes";

/**
 * "I asked for a price — where is it?"
 *
 * The shopper's side of the quote inbox. Each row is one request, and the only
 * one that does anything is a request the merchant has answered: that card
 * carries the price, what it covers, and the button that turns it into a
 * normal cart line. Everything after that is the ordinary checkout, because
 * the offer travels on the line rather than being a separate way to pay.
 *
 * Polled rather than static: a shopper who has just asked for a price is very
 * often sitting on this page when it arrives.
 */

interface CustomerQuotesProps {
  locale: string;
}

function stateBadge(
  state: QuoteOfferState,
): { label: string; variant: "default" | "secondary" | "outline" | "destructive" } {
  switch (state) {
    case "live":
      return { label: "Price ready", variant: "default" };
    case "ordered":
      return { label: "Ordered", variant: "secondary" };
    case "expired":
      return { label: "Price expired", variant: "destructive" };
    case "withdrawn":
      return { label: "Price withdrawn", variant: "destructive" };
    default:
      return { label: "Awaiting price", variant: "outline" };
  }
}

function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
}

export function CustomerQuotes({ locale }: CustomerQuotesProps) {
  const router = useRouter();
  const { addItem } = useCart();
  const { formatPrice } = useCurrency();
  const { data, isLoading, refresh } = useLiveResource<QuoteRequestRow[]>(
    "/api/quotes/mine",
  );
  const [addingId, setAddingId] = useState<string | null>(null);

  const quotes = data ?? [];

  const buy = async (row: QuoteRequestRow) => {
    if (!row.offer) return;
    setAddingId(row._id);
    try {
      await addItem({
        productId: row.productId,
        // The offer is good for one exact lot, so the quantity is the
        // merchant's, not the shopper's — the cart refuses any other.
        quantity: row.offer.quantity,
        price: row.offer.unitPrice,
        name: row.productName,
      });
      router.push(`/${locale}/checkout`);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "This price could not be used. Refresh and try again.",
      );
      // The likeliest failure is an offer that stopped being valid while the
      // page was open, and the list is what says so.
      void refresh();
    } finally {
      setAddingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          You have not asked for any prices yet. Products sold by quote show a
          request button instead of a price.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {quotes.map((row) => {
        const badge = stateBadge(row.offerState);
        const isLive = row.offerState === "live" && row.offer;
        return (
          <Card key={row._id}>
            <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
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
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {row.variantName ? `${row.variantName} · ` : ""}
                  Asked for {row.quantity} on {formatDate(row.createdAt)}
                  {row.offerState === "none"
                    ? ` · ${QUOTE_REQUEST_STATUS_LABELS[row.status]}`
                    : ""}
                </p>
                {row.offer ? (
                  <p className="text-sm">
                    <span className="font-medium">
                      {formatPrice(row.offer.unitPrice)} each
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {row.offer.quantity} ={" "}
                      {formatPrice(row.offer.unitPrice * row.offer.quantity)}
                    </span>
                  </p>
                ) : null}
                {row.offer?.note ? (
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {row.offer.note}
                  </p>
                ) : null}
                {isLive && row.offer?.expiresAt ? (
                  <p className="text-xs text-muted-foreground">
                    Held until {formatDate(row.offer.expiresAt)}
                  </p>
                ) : null}
              </div>

              <div className="shrink-0">
                {isLive ? (
                  <Button
                    onClick={() => buy(row)}
                    disabled={addingId === row._id}
                  >
                    {addingId === row._id ? (
                      <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ShoppingCart className="me-2 h-4 w-4" />
                    )}
                    Add to cart
                  </Button>
                ) : row.offerState === "ordered" && row.orderId ? (
                  <Button asChild variant="outline">
                    <Link href={`/${locale}/account/orders/${row.orderId}`}>
                      View order
                    </Link>
                  </Button>
                ) : row.productSlug &&
                  (row.offerState === "expired" ||
                    row.offerState === "withdrawn") ? (
                  <Button asChild variant="outline">
                    <Link href={`/${locale}/products/${row.productSlug}`}>
                      Ask again
                    </Link>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
