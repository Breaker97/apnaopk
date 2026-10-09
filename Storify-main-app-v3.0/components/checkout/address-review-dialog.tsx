"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

/**
 * "Did you mean…" at checkout, before an order is placed with an address a
 * courier can't find. Advice only: the shopper can keep what they typed, and
 * any failure to check lets the order through — a hold after the order is the
 * safety net, not this.
 */

export type CheckoutAddress = {
  address: string;
  apartment?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
};

export type CheckoutAddressReview = {
  messages: string[];
  suggestion?: { street: string; apartment?: string; city: string; postalCode: string };
};

const CHECK_TIMEOUT_MS = 6000;

/** The address as the check saw it — a changed field means check again. */
export function checkoutAddressKey(address: CheckoutAddress): string {
  return [address.address, address.apartment, address.city, address.state, address.postalCode, address.country]
    .map((part) => String(part || "").trim().toLowerCase())
    .join("|");
}

/** A review to show, or null to carry on (valid, unknown, or the check failed). */
export async function reviewCheckoutAddress(
  address: CheckoutAddress,
): Promise<CheckoutAddressReview | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch("/api/checkout/address-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        address: {
          street: address.address,
          apartment: address.apartment || undefined,
          city: address.city,
          state: address.state || undefined,
          postalCode: address.postalCode || undefined,
          country: address.country,
        },
      }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      data?: { verdict?: string; messages?: string[]; suggestion?: CheckoutAddressReview["suggestion"] };
    };
    if (body.data?.verdict !== "invalid") return null;
    return { messages: body.data.messages || [], suggestion: body.data.suggestion };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function AddressReviewDialog(props: {
  review: CheckoutAddressReview | null;
  entered: CheckoutAddress | null;
  onUseSuggestion: () => void;
  onKeep: () => void;
  onEdit: () => void;
}) {
  const t = useTranslations();
  const tf = useFallbackTranslator(t);
  const { review, entered } = props;
  const line = (parts: Array<string | undefined>) => parts.filter(Boolean).join(", ");

  return (
    <Dialog open={Boolean(review)} onOpenChange={(open) => (!open ? props.onEdit() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tf("checkout.addressReview.title", "Check your delivery address")}</DialogTitle>
          <DialogDescription>
            {tf(
              "checkout.addressReview.description",
              "The courier couldn't find this address. A wrong address can delay or stop your delivery.",
            )}
          </DialogDescription>
        </DialogHeader>

        {review?.messages.length ? (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{review.messages.join("; ")}</span>
          </p>
        ) : null}

        <div className="space-y-2 text-sm">
          {entered ? (
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">
                {tf("checkout.addressReview.entered", "You entered")}
              </p>
              <p>{line([entered.address, entered.apartment, entered.city, entered.postalCode])}</p>
            </div>
          ) : null}
          {review?.suggestion ? (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
              <p className="text-xs text-muted-foreground">
                {tf("checkout.addressReview.suggested", "Suggested")}
              </p>
              <p>
                {line([
                  review.suggestion.street,
                  review.suggestion.apartment,
                  review.suggestion.city,
                  review.suggestion.postalCode,
                ])}
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:flex-col sm:space-x-0">
          {review?.suggestion ? (
            <Button type="button" onClick={props.onUseSuggestion}>
              {tf("checkout.addressReview.useSuggestion", "Use suggested address")}
            </Button>
          ) : (
            <Button type="button" onClick={props.onEdit}>
              {tf("checkout.addressReview.edit", "Edit address")}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={props.onKeep}>
            {tf("checkout.addressReview.keep", "Keep the address I entered")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
