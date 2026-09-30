"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, History, Info, Loader2, TriangleAlert } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { apiClient, ApiClientError } from "@/lib/api/client";
import { lotFits, type QuoteLotLimit } from "@/lib/quotes/quote-lot-fit";
import type { AdminQuoteDetail, QuoteOfferRow } from "@/lib/quotes/quotes";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/providers/currency-provider";
import { formatQuoteDate, useLotMessage } from "./quote-ui";

/**
 * Answering one quote with a price.
 *
 * The merchant types a unit price for a quantity, and that pair is the whole
 * offer: the shopper can buy exactly that lot at exactly that price and
 * nothing else. So the dialog shows what the lot adds up to, and says so at
 * once when the store could never sell it — more than the stock, more than one
 * cart line takes, or a variant product with no variant — instead of letting
 * the shopper find out at checkout.
 *
 * Mounted fresh for each opening (the caller keys it), so it starts from the
 * quote as it is now rather than from whatever a previous opening left.
 */

const EXPIRY_CHOICES = [3, 7, 14, 30, 0] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The hold the current price was sent with, so re-quoting keeps it instead of
 * silently resetting it. A first price keeps the store's standing default of
 * no expiry.
 */
function initialExpiry(offer?: QuoteOfferRow): number {
  if (!offer?.expiresAt) return 0;
  const days = Math.round(
    (new Date(offer.expiresAt).getTime() - new Date(offer.offeredAt).getTime()) /
      DAY_MS,
  );
  return (EXPIRY_CHOICES as readonly number[]).includes(days) ? days : 7;
}

interface QuoteOfferDialogProps {
  quoteId: string;
  /** The quote as the sheet already holds it; fetched when absent. */
  initial?: AdminQuoteDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (quote: AdminQuoteDetail) => void;
}

export function QuoteOfferDialog({
  quoteId,
  initial,
  open,
  onOpenChange,
  onSaved,
}: QuoteOfferDialogProps) {
  const t = useTranslations("admin.quotesPage.dialog");
  const tq = useTranslations("admin.quotesPage");
  const tc = useTranslations("common");
  const { currency, formatPrice } = useCurrency();
  const lotMessage = useLotMessage();

  const [fetched, setFetched] = useState<AdminQuoteDetail | null>(null);
  const quote = initial?._id === quoteId ? initial : fetched;

  useEffect(() => {
    if (!open || initial?._id === quoteId) return;
    const controller = new AbortController();
    apiClient
      .get<AdminQuoteDetail>(`/api/admin/quotes/${quoteId}`, {
        signal: controller.signal,
      })
      .then((detail) => {
        if (!controller.signal.aborted) setFetched(detail);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        toast.error(
          error instanceof ApiClientError && error.message
            ? error.message
            : tq("toast.loadFailed"),
        );
        onOpenChange(false);
      });
    return () => controller.abort();
  }, [initial, onOpenChange, open, quoteId, tq]);

  const [unitPrice, setUnitPrice] = useState<number | undefined>(undefined);
  const [quantity, setQuantity] = useState<number | undefined>(1);
  const [variantId, setVariantId] = useState("");
  const [expiryDays, setExpiryDays] = useState<number>(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // "Held until" is counted from the moment the dialog opened — close enough
  // to the send, and read once so the date does not tick while typing.
  const [openedAt] = useState(() => Date.now());

  useApplyOnChange([quote?._id ?? null], () => {
    if (!quote) return;
    setUnitPrice(quote.offer?.unitPrice);
    setQuantity(quote.offer?.quantity ?? quote.quantity);
    setVariantId(quote.variantId ?? "");
    setExpiryDays(initialExpiry(quote.offer));
    setNote(quote.offer?.note ?? "");
  });

  const variants = quote?.productInfo.variants ?? [];
  const needsVariant = Boolean(quote) && variants.length > 0 && !quote?.variantId;
  const chosenVariant = variants.find((variant) => variant._id === variantId);
  const limit: QuoteLotLimit | null = !quote
    ? null
    : needsVariant
      ? (chosenVariant?.lot ?? null)
      : quote.lot;
  const lot = quantity ?? 0;
  const lotProblem = limit && lot > 0 && !lotFits(limit, lot) ? limit : null;
  const canUseMax =
    lotProblem !== null &&
    lotProblem.max !== null &&
    lotProblem.max > 0 &&
    (lotProblem.reason === "stock" || lotProblem.reason === "preorder");
  const total = (unitPrice ?? 0) * lot;
  const heldUntil =
    expiryDays > 0 ? formatQuoteDate(new Date(openedAt + expiryDays * DAY_MS)) : "";

  const send = async () => {
    if (!quote) return;
    if (needsVariant && !variantId) {
      toast.error(t("chooseVariantError"));
      return;
    }
    if (!unitPrice || unitPrice <= 0) {
      toast.error(t("priceError"));
      return;
    }
    if (!quantity || quantity < 1) {
      toast.error(t("quantityError"));
      return;
    }
    setSaving(true);
    try {
      const saved = await apiClient.post<AdminQuoteDetail>(
        `/api/admin/quotes/${quote._id}/offer`,
        {
          unitPrice,
          quantity,
          note: note.trim(),
          expiresInDays: expiryDays,
          ...(needsVariant ? { variantId } : {}),
        },
      );
      toast.success(
        saved.replacedOffers
          ? t("sentReplaced", { name: quote.name, count: saved.replacedOffers })
          : t("sent", { name: quote.name }),
      );
      onSaved(saved);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof ApiClientError && error.message
          ? error.message
          : t("sendFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const lastPriceState = (() => {
    if (!quote?.offer) return "";
    if (quote.stage === "expired") {
      return t("lastPriceExpired", { date: formatQuoteDate(quote.offer.expiresAt) });
    }
    if (quote.offer.withdrawnAt) {
      return t("lastPriceWithdrawn", {
        date: formatQuoteDate(quote.offer.withdrawnAt),
      });
    }
    return quote.offer.expiresAt
      ? t("lastPriceOpenUntil", { date: formatQuoteDate(quote.offer.expiresAt) })
      : t("lastPriceOpen");
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {quote?.offer ? t("titleUpdate") : t("titleSend")}
          </DialogTitle>
          <DialogDescription>
            {quote
              ? t("description", {
                  product: quote.variantName
                    ? `${quote.productName} — ${quote.variantName}`
                    : quote.productName,
                  name: quote.name,
                  quantity: quote.quantity,
                })
              : t("loading")}
          </DialogDescription>
        </DialogHeader>

        {!quote ? (
          <div className="grid gap-3">
            <Skeleton className="h-10 w-full" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <div className="grid gap-4">
            {quote.offer ? (
              <div className="flex items-center gap-2 rounded-lg bg-muted/70 px-3 py-2.5 text-sm text-muted-foreground">
                <History className="h-4 w-4 shrink-0" />
                <span>
                  {t("lastPrice")}{" "}
                  <span className="font-semibold text-foreground">
                    {quote.offer.quantity} × {formatPrice(quote.offer.unitPrice)}
                  </span>{" "}
                  · {lastPriceState}
                </span>
              </div>
            ) : null}

            {needsVariant ? (
              <div className="grid gap-1.5">
                <Label htmlFor="quote-offer-variant">{t("variant")}</Label>
                <Select value={variantId} onValueChange={setVariantId}>
                  <SelectTrigger id="quote-offer-variant" className="w-full">
                    <SelectValue placeholder={t("variantPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {variants.map((variant) => (
                      <SelectItem key={variant._id} value={variant._id}>
                        {variant.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t("variantHelp")}</p>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="quote-offer-price">{t("priceEach")}</Label>
                <div className="flex h-10 items-center rounded-md border border-input bg-background focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                  <span className="ps-3 text-sm text-muted-foreground">
                    {currency.symbol}
                  </span>
                  <NumberInput
                    id="quote-offer-price"
                    value={unitPrice}
                    onValueChange={setUnitPrice}
                    min={0}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="h-full border-0 bg-transparent ps-1.5 shadow-none focus-visible:ring-0"
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="quote-offer-qty">{tc("quantity")}</Label>
                <NumberInput
                  id="quote-offer-qty"
                  value={quantity}
                  onValueChange={setQuantity}
                  min={1}
                  whenEmpty="keep"
                  normalize={(value) => Math.round(value)}
                  // A warning, not an error: the store may restock before the
                  // shopper buys, so the lot is flagged but still sendable.
                  aria-describedby={lotProblem ? "quote-offer-lot" : undefined}
                  className={cn(
                    "h-10",
                    lotProblem && "border-amber-500 focus-visible:border-amber-500",
                  )}
                />
              </div>
            </div>

            {lotProblem ? (
              <div
                id="quote-offer-lot"
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="flex-1">{lotMessage.long(lotProblem, lot)}</span>
                {canUseMax ? (
                  <button
                    type="button"
                    className="shrink-0 font-semibold underline underline-offset-2"
                    onClick={() => setQuantity(lotProblem.max ?? lot)}
                  >
                    {t("useMax", { max: lotProblem.max ?? 0 })}
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/30 px-4 py-3">
              <div>
                <div className="text-xs text-muted-foreground">
                  {t("customerPays")}
                </div>
                <div className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums">
                  {formatPrice(total)}
                </div>
              </div>
              <div className="text-end text-xs leading-relaxed text-muted-foreground">
                <div className="tabular-nums">
                  {lot} × {formatPrice(unitPrice ?? 0)}
                </div>
                <div>{t("beforeShippingTax")}</div>
              </div>
            </div>

            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">{t("validFor")}</legend>
              <div className="flex flex-wrap gap-2">
                {EXPIRY_CHOICES.map((days) => {
                  const selected = expiryDays === days;
                  return (
                    <button
                      key={days}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setExpiryDays(days)}
                      className={cn(
                        "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3.5 text-sm font-medium transition-colors",
                        selected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-input bg-background hover:bg-muted",
                      )}
                    >
                      {selected ? <Check className="h-3.5 w-3.5" /> : null}
                      {days === 0 ? t("noExpiry") : t("days", { count: days })}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {heldUntil ? t("heldUntil", { date: heldUntil }) : t("heldForever")}
              </p>
            </fieldset>

            <div className="grid gap-1.5">
              <Label htmlFor="quote-offer-note">{t("note")}</Label>
              <Textarea
                id="quote-offer-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={t("notePlaceholder")}
              />
            </div>

            {!quote.userId ? (
              <div className="flex items-start gap-2.5 rounded-lg bg-primary/10 px-3 py-2.5 text-xs leading-relaxed text-primary">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {t("guestNote", { name: quote.name, email: quote.email })}
                </span>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {tc("cancel")}
          </Button>
          <Button type="button" onClick={send} disabled={!quote || saving}>
            {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
            {quote?.offer ? t("sendNew") : t("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
