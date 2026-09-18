"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { apiClient, ApiClientError } from "@/lib/api/client";
import { useCurrency } from "@/providers/currency-provider";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { QUOTE_OFFER_STATE_LABELS } from "@/lib/quotes/quote-status";
import type { QuoteRequestRow } from "@/lib/quotes/quotes";

/**
 * Answering one quote with a price.
 *
 * The merchant types a unit price for a quantity, and that pair is the whole
 * offer: the shopper can buy exactly that lot at exactly that price and
 * nothing else, so the dialog shows the line total it adds up to rather than
 * leaving them to multiply. Everything else — who it belongs to, when it dies,
 * whether it has been spent — is handled server-side.
 *
 * Re-opening on a quote that already has a price shows what was offered and
 * lets the merchant replace or withdraw it; the old number is kept in the
 * quote's history either way.
 */

const EXPIRY_CHOICES = [
  { value: "0", label: "No expiry" },
  { value: "3", label: "3 days" },
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
];

interface QuoteOfferDialogProps {
  quote: QuoteRequestRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (row: QuoteRequestRow) => void;
}

export function QuoteOfferDialog({
  quote,
  open,
  onOpenChange,
  onSaved,
}: QuoteOfferDialogProps) {
  const { formatPrice } = useCurrency();
  const [unitPrice, setUnitPrice] = useState<number | undefined>(undefined);
  const [quantity, setQuantity] = useState<number | undefined>(1);
  const [note, setNote] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [saving, setSaving] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  // Re-seed from the row each time the dialog is opened on one, so re-quoting
  // starts from the number that is already on the table rather than blank.
  // Keyed on primitives: the row object is rebuilt by every list refetch, and
  // an object dep here would re-seed the form under the merchant mid-edit.
  useApplyOnChange(
    [open, quote?._id, quote?.offer?.unitPrice, quote?.offer?.quantity],
    () => {
      if (!open || !quote) return;
      setUnitPrice(quote.offer?.unitPrice);
      setQuantity(quote.offer?.quantity ?? quote.quantity);
      setNote(quote.offer?.note ?? "");
      setExpiresInDays(quote.offer?.expiresAt ? "7" : "0");
    },
  );

  if (!quote) return null;

  const lineTotal = (unitPrice ?? 0) * (quantity ?? 0);
  const hasOffer = Boolean(quote.offer);
  const canWithdraw = hasOffer && quote.offerState === "live";

  const send = async () => {
    if (!unitPrice || unitPrice <= 0) {
      toast.error("Enter a price above zero");
      return;
    }
    if (!quantity || quantity < 1) {
      toast.error("Enter the quantity this price covers");
      return;
    }
    setSaving(true);
    try {
      const row = await apiClient.post<QuoteRequestRow>(
        `/api/admin/quotes/${quote._id}/offer`,
        {
          unitPrice,
          quantity,
          note: note.trim(),
          expiresInDays: Number(expiresInDays) || 0,
        },
      );
      onSaved(row);
      toast.success("Price sent to the customer");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "Failed to send the price",
      );
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async () => {
    setWithdrawing(true);
    try {
      const row = await apiClient.patch<QuoteRequestRow>(
        `/api/admin/quotes/${quote._id}/offer`,
        {},
      );
      onSaved(row);
      toast.success("Price withdrawn");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "Failed to withdraw the price",
      );
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {hasOffer ? "Update the price" : "Send a price"}
          </DialogTitle>
          <DialogDescription>
            {quote.productName}
            {quote.variantName ? ` — ${quote.variantName}` : ""} · asked for by{" "}
            {quote.name} (qty {quote.quantity})
          </DialogDescription>
        </DialogHeader>

        {hasOffer ? (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span className="font-medium">
              {formatPrice(quote.offer!.unitPrice)} × {quote.offer!.quantity}
            </span>
            <span className="text-muted-foreground">
              {" "}
              · {QUOTE_OFFER_STATE_LABELS[quote.offerState]}
            </span>
          </div>
        ) : null}

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="quote-offer-price">Price each</Label>
              <NumberInput
                id="quote-offer-price"
                value={unitPrice}
                onValueChange={setUnitPrice}
                min={0}
                inputMode="decimal"
                placeholder="0.00"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="quote-offer-qty">Quantity</Label>
              <NumberInput
                id="quote-offer-qty"
                value={quantity}
                onValueChange={setQuantity}
                min={1}
                whenEmpty="keep"
                normalize={(value) => Math.round(value)}
              />
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            The customer can order exactly this quantity at{" "}
            <span className="font-medium text-foreground">
              {formatPrice(lineTotal)}
            </span>{" "}
            in total. They cannot change the amount without asking again.
          </p>

          <div className="grid gap-1.5">
            <Label htmlFor="quote-offer-note">Note to the customer</Label>
            <Textarea
              id="quote-offer-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Lead time, what the price includes, delivery terms…"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="quote-offer-expiry">Hold this price for</Label>
            <Select value={expiresInDays} onValueChange={setExpiresInDays}>
              <SelectTrigger id="quote-offer-expiry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_CHOICES.map((choice) => (
                  <SelectItem key={choice.value} value={choice.value}>
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {canWithdraw ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              onClick={withdraw}
              disabled={withdrawing || saving}
            >
              {withdrawing ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : null}
              Withdraw
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving || withdrawing}
            >
              Cancel
            </Button>
            <Button type="button" onClick={send} disabled={saving || withdrawing}>
              {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              {hasOffer ? "Send new price" : "Send price"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
