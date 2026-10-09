"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Copy,
  ExternalLink,
  Loader2,
  Lock,
  Mail,
  Tag,
  TriangleAlert,
} from "lucide-react";
import Link from "@/components/language/link";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { getPaymentMethodMeta } from "@/components/common/payment-method-meta";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { apiClient, ApiClientError } from "@/lib/api/client";
import { lotFits } from "@/lib/quotes/quote-lot-fit";
import type { AdminQuoteDetail, QuoteOfferRow } from "@/lib/quotes/quotes";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/providers/currency-provider";
import {
  formatQuoteDate,
  GuestChip,
  QuoteOfferBy,
  QuoteProductThumb,
  QuoteStageBadge,
  quoteApiPath,
  quoteMovesFor,
  useLotMessage,
  type QuoteScope,
} from "./quote-ui";

/**
 * Everything about one quote, beside the list rather than on a page of its
 * own: who asked, what they asked for and said, the price and whether the
 * store can actually sell that lot, what happened so far, and the note the
 * team keeps for itself. Opens from a row click, like an order does from the
 * Orders list.
 *
 * On the vendor's page the note is the vendor's own (the store reads it, the
 * vendor never sees the store's), the shopper's contact details are missing
 * when the store hides them, and once the store has taken the quote over the
 * sheet says so in place of the moves the vendor no longer has.
 *
 * The moves that ask for confirmation or open the price dialog are handed to
 * the page, which closes this sheet first: a dialog opened over a sheet sits
 * underneath it.
 */

export type QuoteSheetAction =
  | "send_price"
  | "withdraw"
  | "mark_lost"
  | "reopen"
  | "delete";

interface QuoteDetailSheetProps {
  quoteId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  scope?: QuoteScope;
  /** Changed by the page after a write, so an open sheet reads the quote again. */
  version: number;
  onAction: (action: QuoteSheetAction, quote: AdminQuoteDetail) => void;
}

type HistoryEvent = {
  key: string;
  at?: string;
  tone: "slate" | "blue" | "rose" | "cyan" | "green";
  title: string;
  detail?: string;
};

const TONE_DOT: Record<HistoryEvent["tone"], string> = {
  slate: "bg-slate-400",
  blue: "bg-blue-600",
  rose: "bg-rose-600",
  cyan: "bg-cyan-600",
  green: "bg-emerald-600",
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function QuoteDetailSheet({
  quoteId,
  open,
  onOpenChange,
  canManage,
  scope = "admin",
  version,
  onAction,
}: QuoteDetailSheetProps) {
  const t = useTranslations("admin.quotesPage");
  const tRoot = useTranslations();
  const { formatPrice } = useCurrency();
  const lotMessage = useLotMessage();

  const requestKey = quoteId ? `${quoteId}:${version}` : "";
  const [loaded, setLoaded] = useState<{
    key: string;
    quote: AdminQuoteDetail;
  } | null>(null);
  const quote = loaded?.key === requestKey ? loaded.quote : null;

  useEffect(() => {
    if (!open || !quoteId || loaded?.key === requestKey) return;
    const controller = new AbortController();
    apiClient
      .get<AdminQuoteDetail>(quoteApiPath(scope, quoteId), {
        signal: controller.signal,
      })
      .then((detail) => {
        if (!controller.signal.aborted) {
          setLoaded({ key: requestKey, quote: detail });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        toast.error(
          error instanceof ApiClientError && error.message
            ? error.message
            : t("toast.loadFailed"),
        );
        onOpenChange(false);
      });
    return () => controller.abort();
  }, [loaded?.key, onOpenChange, open, quoteId, requestKey, scope, t]);

  // The note this page writes: the store's internal one, or the vendor's own.
  const noteField = scope === "vendor" ? "vendorNote" : "adminNote";
  const savedNote = quote?.[noteField] ?? "";
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  useApplyOnChange([quote?._id ?? null, savedNote], () => {
    setNote(savedNote);
  });

  const saveNote = async () => {
    if (!quote) return;
    setSavingNote(true);
    try {
      const updated = await apiClient.patch<AdminQuoteDetail>(
        quoteApiPath(scope, quote._id),
        { [noteField]: note.trim() },
      );
      setLoaded({ key: requestKey, quote: updated });
      toast.success(t("toast.noteSaved"));
    } catch (error) {
      toast.error(
        error instanceof ApiClientError && error.message
          ? error.message
          : t("toast.failed"),
      );
    } finally {
      setSavingNote(false);
    }
  };

  const history = useMemo<HistoryEvent[]>(() => {
    if (!quote) return [];
    const heldFor = (offer: QuoteOfferRow) => {
      if (!offer.expiresAt) return t("history.noExpiry");
      const days = Math.max(
        1,
        Math.round(
          (new Date(offer.expiresAt).getTime() -
            new Date(offer.offeredAt).getTime()) /
            DAY_MS,
        ),
      );
      return t("history.heldDays", { count: days });
    };

    const events: HistoryEvent[] = [
      {
        key: "request",
        at: quote.createdAt,
        tone: "slate",
        title: t("history.requested", { quantity: quote.quantity }),
        detail: quote.userId ? t("history.fromAccount") : t("history.fromGuest"),
      },
    ];
    const offers = [...quote.offerHistory, ...(quote.offer ? [quote.offer] : [])];
    offers.forEach((offer, index) => {
      events.push({
        key: `offer-${index}`,
        at: offer.offeredAt,
        tone: "blue",
        title: index === 0 ? t("history.priceSent") : t("history.newPriceSent"),
        detail: `${offer.quantity} × ${formatPrice(offer.unitPrice)} · ${heldFor(offer)} · ${t(`by.${offer.offeredByRole}`)}`,
      });
      if (offer.withdrawnAt) {
        events.push({
          key: `withdrawn-${index}`,
          at: offer.withdrawnAt,
          tone: "slate",
          title: t("history.withdrawn"),
          detail: offer.withdrawnByRole ? t(`by.${offer.withdrawnByRole}`) : undefined,
        });
      }
    });
    if (quote.stage === "expired" && quote.offer?.expiresAt) {
      events.push({
        key: "expired",
        at: quote.offer.expiresAt,
        tone: "rose",
        title: t("history.expired"),
      });
    }
    if (quote.order) {
      events.push({
        key: "order",
        at: quote.order.createdAt,
        tone: quote.stage === "won" ? "green" : "cyan",
        title: t("history.ordered", { order: quote.order.orderNumber ?? "" }),
        detail: quote.stage === "won" ? t("history.paid") : t("history.unpaid"),
      });
    }

    const dated = events
      .filter((event) => event.at)
      .sort(
        (a, b) => new Date(b.at!).getTime() - new Date(a.at!).getTime(),
      );
    // Closing a quote leaves no timestamp of its own, and it is always the
    // latest thing that happened to it.
    const lost: HistoryEvent[] =
      quote.status === "lost"
        ? [{ key: "lost", tone: "slate", title: t("history.markedLost") }]
        : [];
    return [...lost, ...dated];
  }, [formatPrice, quote, t]);

  const offerLotProblem =
    quote?.offer &&
    (quote.stage === "offer_sent" || quote.stage === "expired") &&
    !lotFits(quote.lot, quote.offer.quantity)
      ? quote.lot
      : null;

  const stockLine = (() => {
    if (!quote) return "";
    switch (quote.lot.reason) {
      case "stock":
        return t("lot.inStock", { max: quote.lot.max ?? 0 });
      case "untracked":
        return t("lot.untracked");
      case "preorder":
        return t("lot.preorderOpen");
      case "needs_variant":
        return t("lot.needsVariantShort");
      default:
        return t("lot.unavailableShort");
    }
  })();

  const priceState = (() => {
    if (!quote?.offer) return "";
    switch (quote.stage) {
      case "offer_sent":
        return quote.offer.expiresAt
          ? t("price.openUntil", { date: formatQuoteDate(quote.offer.expiresAt) })
          : t("price.openNoExpiry");
      case "expired":
        return t("price.expiredOn", { date: formatQuoteDate(quote.offer.expiresAt) });
      case "ordered":
        return t("price.onOrderUnpaid");
      case "won":
        return t("price.onOrderPaid");
      default:
        return quote.offer.withdrawnAt
          ? t("price.withdrawnOn", {
              date: formatQuoteDate(quote.offer.withdrawnAt),
            })
          : t("price.closed");
    }
  })();

  const onOrder = quote?.stage === "ordered" || quote?.stage === "won";
  const moves = quote ? quoteMovesFor(scope, quote) : null;

  const copyEmail = () => {
    if (!quote?.email) return;
    void navigator.clipboard.writeText(quote.email);
    toast.success(t("toast.emailCopied"));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-[560px]"
        // The loading frame has no description to point at yet.
        {...(!quote ? { "aria-describedby": undefined } : {})}
      >
        {!quote ? (
          <div className="grid gap-4 p-6">
            <SheetTitle className="sr-only">{t("sheet.loading")}</SheetTitle>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <SheetHeader className="gap-1 border-b px-6 pb-4 pt-5 pe-12">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {t("sheet.requestedOn", { date: formatQuoteDate(quote.createdAt) })}
                </span>
                <QuoteStageBadge stage={quote.stage} />
              </div>
              <SheetTitle className="text-xl">{quote.name}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {quote.company ? <span>{quote.company}</span> : null}
                {quote.company && quote.email ? (
                  <span aria-hidden="true">·</span>
                ) : null}
                {quote.email ? <span>{quote.email}</span> : null}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-6">
              <section className="grid gap-3 border-b py-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("sheet.customer")}
                </h3>
                <dl className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">{tRoot("common.email")}</dt>
                  {quote.contactHidden ? (
                    <dd className="italic text-muted-foreground">
                      {t("sheet.contactHidden")}
                    </dd>
                  ) : (
                    <dd className="flex min-w-0 items-center gap-1.5">
                      <a
                        href={`mailto:${quote.email}`}
                        className="truncate font-medium text-primary hover:underline"
                      >
                        {quote.email}
                      </a>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
                        aria-label={t("sheet.copyEmail")}
                        onClick={copyEmail}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </dd>
                  )}
                  {quote.contactHidden ? (
                    <>
                      <dt className="text-muted-foreground">{t("sheet.phone")}</dt>
                      <dd className="italic text-muted-foreground">
                        {t("sheet.contactHidden")}
                      </dd>
                    </>
                  ) : quote.phone ? (
                    <>
                      <dt className="text-muted-foreground">{t("sheet.phone")}</dt>
                      <dd>
                        <a href={`tel:${quote.phone}`} className="hover:underline">
                          {quote.phone}
                        </a>
                      </dd>
                    </>
                  ) : null}
                  <dt className="text-muted-foreground">{t("sheet.account")}</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    {quote.userId ? (
                      <span>{t("sheet.hasAccount")}</span>
                    ) : (
                      <>
                        <GuestChip />
                        <span className="text-muted-foreground">
                          {t("sheet.guestBuys")}
                        </span>
                      </>
                    )}
                  </dd>
                </dl>
              </section>

              <section className="grid gap-3 border-b py-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("sheet.request")}
                </h3>
                <div className="flex items-center gap-3">
                  <QuoteProductThumb
                    src={quote.productImage}
                    alt={quote.productName}
                    size={48}
                  />
                  <div className="min-w-0">
                    <Link
                      href={`/${scope}/products/${quote.productId}/edit`}
                      className="line-clamp-2 text-sm font-medium hover:text-primary hover:underline"
                    >
                      {quote.productName}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[quote.variantName, stockLine].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </div>
                <p className="text-sm">
                  <span className="text-muted-foreground">
                    {t("sheet.quantityAsked")}
                  </span>
                  <span className="ms-2 font-semibold tabular-nums">
                    {quote.quantity}
                  </span>
                </p>
                {quote.message ? (
                  <blockquote className="whitespace-pre-wrap rounded-lg bg-muted/70 px-3 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere]">
                    {quote.message}
                  </blockquote>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("sheet.noMessage")}</p>
                )}
              </section>

              <section className="grid gap-3 border-b py-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("sheet.price")}
                </h3>
                {quote.offer ? (
                  <div className="grid gap-1 rounded-xl border px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          "text-2xl font-bold tracking-tight tabular-nums",
                          quote.stage === "closed" && "text-muted-foreground",
                        )}
                      >
                        {formatPrice(quote.offerTotal ?? 0)}
                      </span>
                      <span
                        className={cn(
                          "text-xs font-medium",
                          quote.stage === "expired"
                            ? "text-rose-700 dark:text-rose-300"
                            : "text-muted-foreground",
                        )}
                      >
                        {priceState}
                      </span>
                    </div>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                      <QuoteOfferBy role={quote.offer.offeredByRole} />
                      <span>
                        {quote.offer.quantity} × {formatPrice(quote.offer.unitPrice)} ·{" "}
                        {t("price.beforeShippingTax")}
                      </span>
                    </span>
                    {quote.offer.note ? (
                      <p className="mt-1.5 whitespace-pre-wrap border-t pt-2 text-xs leading-relaxed text-muted-foreground">
                        {quote.offer.note}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("price.none")}</p>
                )}
                {moves?.lockedByStore ? (
                  <div
                    role="note"
                    className="flex items-start gap-2.5 rounded-lg bg-muted/70 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground"
                  >
                    <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{t("sheet.lockedByStore")}</span>
                  </div>
                ) : null}
                {offerLotProblem && quote.offer ? (
                  <div
                    role="note"
                    className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                  >
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{lotMessage.long(offerLotProblem, quote.offer.quantity)}</span>
                  </div>
                ) : null}
                {quote.order ? (
                  <Link
                    href={`/${scope}/orders/${quote.order._id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm hover:bg-muted/50"
                  >
                    <span>
                      <span className="font-semibold text-primary">
                        {quote.order.orderNumber}
                      </span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {getPaymentMethodMeta(tRoot, quote.order.paymentMethod).label}
                        {" · "}
                        {quote.stage === "won" ? t("history.paid") : t("history.unpaid")}
                      </span>
                    </span>
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ) : null}
              </section>

              <section className="grid gap-3 border-b py-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("sheet.history")}
                </h3>
                <ol className="grid gap-3">
                  {history.map((event) => (
                    <li key={event.key} className="flex gap-3">
                      <span
                        className={cn(
                          "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                          TONE_DOT[event.tone],
                        )}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{event.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {[event.at ? formatQuoteDate(event.at) : "", event.detail]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>

              {/* The store reads the vendor's note but cannot change it. */}
              {scope === "admin" && quote.vendorNote ? (
                <section className="grid gap-2 border-b py-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("sheet.vendorNote")}
                  </h3>
                  <p className="whitespace-pre-wrap rounded-lg bg-muted/70 px-3 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere]">
                    {quote.vendorNote}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("sheet.vendorNoteReadOnly")}
                  </p>
                </section>
              ) : null}

              <section className="grid gap-2 py-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <label htmlFor="quote-internal-note">
                    {scope === "vendor" ? t("sheet.vendorNote") : t("sheet.internalNote")}
                  </label>
                </h3>
                <Textarea
                  id="quote-internal-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder={
                    scope === "vendor"
                      ? t("sheet.vendorNotePlaceholder")
                      : t("sheet.internalNotePlaceholder")
                  }
                  disabled={!canManage}
                />
                {canManage && note.trim() !== savedNote ? (
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={saveNote}
                      disabled={savingNote}
                    >
                      {savingNote ? (
                        <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      {t("sheet.saveNote")}
                    </Button>
                  </div>
                ) : null}
              </section>
            </div>

            {/* Two groups, so a long label (Bengali runs wider) wraps the
                whole right-hand pair onto its own line, still on the right. */}
            <div className="flex flex-wrap items-center gap-2 border-t px-6 py-4">
              <div className="flex flex-wrap items-center gap-1">
                {canManage && moves?.canWithdraw ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() => onAction("withdraw", quote)}
                  >
                    {t("actions.withdraw")}
                  </Button>
                ) : null}
                {canManage && moves?.canMarkLost ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() => onAction("mark_lost", quote)}
                  >
                    {t("actions.markLost")}
                  </Button>
                ) : null}
                {canManage && moves?.canDelete && quote.stage === "closed" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onAction("delete", quote)}
                  >
                    {tRoot("common.delete")}
                  </Button>
                ) : null}
              </div>
              <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
                {quote.email ? (
                  <Button asChild variant="outline">
                    <a href={`mailto:${quote.email}`}>
                      <Mail className="me-2 h-4 w-4" />
                      {t("actions.email")}
                    </a>
                  </Button>
                ) : null}
                {onOrder && quote.order ? (
                  <Button asChild>
                    <Link href={`/${scope}/orders/${quote.order._id}`}>
                      {t("actions.openOrder")}
                    </Link>
                  </Button>
                ) : canManage && moves?.canReopen ? (
                  <Button type="button" onClick={() => onAction("reopen", quote)}>
                    {t("actions.reopen")}
                  </Button>
                ) : canManage && moves?.canSendPrice ? (
                  <Button type="button" onClick={() => onAction("send_price", quote)}>
                    <Tag className="me-2 h-4 w-4" />
                    {quote.offer ? t("actions.sendNewPrice") : t("actions.sendPrice")}
                  </Button>
                ) : null}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
