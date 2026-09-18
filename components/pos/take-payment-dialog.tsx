"use client";

import * as React from "react";
import {
  loadStripe,
  type Stripe,
  type StripeCardCvcElement,
  type StripeCardExpiryElement,
  type StripeCardNumberElement,
  type StripeElements,
} from "@stripe/stripe-js";
import { useTranslations } from "next-intl";
import {
  X,
  Banknote,
  CreditCard,
  Building2,
  Loader2,
  CheckCircle2,
  Tag,
  Nfc,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createStripeElementStyle } from "@/components/checkout/checkout-helpers";
import { cn } from "@/lib/utils";
import type { POSSettings } from "@/lib/pos/build-pos-settings";
import type { POSDiscount } from "@/components/pos/discount-dialog";
import { roundMoney } from "@/lib/intl/money";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

type PaymentMethodId = "cash" | "card" | "bank" | "manual";
type CardSubMethod = "touch" | "stripe";

interface PaymentMethodOption {
  id: PaymentMethodId;
  label: string;
  description: string;
  icon: React.ReactNode;
}

interface CardSubOption {
  id: CardSubMethod;
  label: string;
  description: string;
  icon: React.ReactNode;
}

interface POSTakePaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  itemCount: number;
  discount: POSDiscount | null;
  onProcess: (
    method: string,
    cashTendered: number,
    reference?: string,
    note?: string,
    stripePaymentIntentId?: string,
  ) => Promise<void> | void;
  onCreateStripeIntent: () => Promise<{
    paymentIntentId: string;
    clientSecret: string;
  }>;
  isProcessing: boolean;
  settings: POSSettings;
  /**
   * Whether the register has lost its connection.
   *
   * Only Stripe cares: cash is entirely local, and a "Touch" card payment is
   * settled by the reader on its own line — the register is merely recording
   * that it happened. Stripe needs a PaymentIntent from the server, so offering
   * it offline would strand the cashier mid-sale with a customer waiting.
   */
  isOffline?: boolean;
  fp: (amount: number) => string;
}

/**
 * Standard cash denominations (in major currency units) used to build
 * dynamic quick-amount suggestions for the cash payment flow. The list is
 * intentionally broad so the dialog adapts to both small and large totals.
 */
const QUICK_CASH_DENOMINATIONS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000,
];

/**
 * Build a dynamic list of quick-amount suggestions based on the order
 * total. The first entry is always the exact total (so the cashier can
 * charge the precise amount). The remaining entries are the next three
 * standard cash denominations greater than the total, so the customer can
 * hand over a common bill/note and receive change.
 *
 * @example
 *   getQuickCashAmounts(286)    // -> [286, 500, 1000, 2000]
 *   getQuickCashAmounts(50.25)  // -> [50.25, 100, 200, 500]
 *   getQuickCashAmounts(5.5)    // -> [5.5, 10, 20, 50]
 *   getQuickCashAmounts(100)    // -> [100, 200, 500, 1000]
 */
function getQuickCashAmounts(total: number): number[] {
  if (!Number.isFinite(total) || total <= 0) return [];
  const exact = roundMoney(total);
  const above = QUICK_CASH_DENOMINATIONS.filter((d) => d > total).slice(0, 3);
  // Dedupe in case total is exactly a denomination and also used for `exact`.
  const set = new Set<number>([exact, ...above]);
  return Array.from(set).sort((a, b) => a - b);
}

export function POSTakePaymentDialog({
  open,
  onOpenChange,
  total,
  itemCount,
  discount,
  onProcess,
  onCreateStripeIntent,
  isProcessing,
  settings,
  isOffline = false,
  fp,
}: POSTakePaymentDialogProps) {
  const t = useTranslations();
  const [selectedMethod, setSelectedMethod] =
    React.useState<PaymentMethodId>("cash");
  const [cardSubMethod, setCardSubMethod] =
    React.useState<CardSubMethod>("touch");
  const [cashTendered, setCashTendered] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [stripeElementReady, setStripeElementReady] = React.useState(false);
  const [stripeElementError, setStripeElementError] = React.useState<
    string | null
  >(null);
  const [stripeProcessing, setStripeProcessing] = React.useState(false);
  const [cardNumberMountEl, setCardNumberMountEl] =
    React.useState<HTMLDivElement | null>(null);
  const [cardExpiryMountEl, setCardExpiryMountEl] =
    React.useState<HTMLDivElement | null>(null);
  const [cardCvcMountEl, setCardCvcMountEl] =
    React.useState<HTMLDivElement | null>(null);
  const stripeRef = React.useRef<Stripe | null>(null);
  const stripeElementsRef = React.useRef<StripeElements | null>(null);
  const cardNumberElementRef = React.useRef<StripeCardNumberElement | null>(
    null,
  );
  const cardExpiryElementRef = React.useRef<StripeCardExpiryElement | null>(
    null,
  );
  const cardCvcElementRef = React.useRef<StripeCardCvcElement | null>(null);
  const stripeElementStyle = React.useMemo(
    () => createStripeElementStyle(false),
    [],
  );

  const CARD_SUB_OPTIONS: CardSubOption[] = React.useMemo(
    () => [
      {
        id: "touch",
        label: "Touch",
        description: "Tap or insert card on reader",
        icon: <Nfc className="h-4 w-4" />,
      },
      // Dropped entirely rather than shown disabled: a greyed-out button at the
      // counter is a question the cashier has to stop and answer while somebody
      // waits. The reader-based option next to it still takes cards.
      ...(isOffline
        ? []
        : [
            {
              id: "stripe" as const,
              label: "Stripe",
              description: "Card details form",
              icon: <Wallet className="h-4 w-4" />,
            },
          ]),
    ],
    [isOffline],
  );

  // A connection lost while the dialog is already open, with Stripe selected,
  // would otherwise leave the sale pointed at a method that no longer exists.
  useApplyOnChange([isOffline, cardSubMethod], () => {
    if (isOffline && cardSubMethod === "stripe") setCardSubMethod("touch");
  });

  // Reset state when dialog opens
  useApplyOnChange([open, total], () => {
    if (!open) return;
    setSelectedMethod("cash");
    setCardSubMethod("touch");
    // Prefill the exact total — paying to the cent is the common case, and an
    // empty field left the confirm button disabled for no visible reason.
    setCashTendered(total > 0 ? total.toFixed(2) : "");
    setReference("");
    setStripeElementError(null);
  });

  // Available payment methods based on settings
  const methods: PaymentMethodOption[] = React.useMemo(() => {
    const list: PaymentMethodOption[] = [];
    if (settings.paymentMethods.includes("cash")) {
      list.push({
        id: "cash",
        label: t("pos.cash"),
        description: "With change",
        icon: <Banknote className="h-4 w-4" />,
      });
    }
    if (settings.paymentMethods.includes("card")) {
      list.push({
        id: "card",
        label: "Card",
        // Offline the Stripe form is gone, so promising it here would send the
        // cashier looking for a button that is not on the screen.
        description: isOffline ? "Reader only" : "Touch or Stripe",
        icon: <CreditCard className="h-4 w-4" />,
      });
    }
    if (settings.paymentMethods.includes("bank")) {
      list.push({
        id: "bank",
        label: "Bank Transfer",
        description: "With reference",
        icon: <Building2 className="h-4 w-4" />,
      });
    }
    if (settings.paymentMethods.includes("manual")) {
      list.push({
        id: "manual",
        label: t("pos.manual"),
        description: "Custom method",
        icon: <Tag className="h-4 w-4" />,
      });
    }
    return list;
  }, [settings.paymentMethods, isOffline, t]);

  // Make sure selected method is valid
  useApplyOnChange([methods, selectedMethod], () => {
    if (!methods.find((m) => m.id === selectedMethod) && methods.length > 0) {
      setSelectedMethod(methods[0].id);
    }
  });

  const publishableKey = settings.stripe?.publishableKey;
  const shouldMountStripe =
    open &&
    selectedMethod === "card" &&
    cardSubMethod === "stripe" &&
    Boolean(publishableKey);

  // The elements are torn down below the moment Stripe stops being the
  // method, so "ready" cannot outlive that decision.
  useApplyOnChange([shouldMountStripe], () => {
    if (!shouldMountStripe) setStripeElementReady(false);
  });

  React.useEffect(() => {
    if (!shouldMountStripe) {
      cardNumberElementRef.current?.destroy();
      cardExpiryElementRef.current?.destroy();
      cardCvcElementRef.current?.destroy();
      cardNumberElementRef.current = null;
      cardExpiryElementRef.current = null;
      cardCvcElementRef.current = null;
      stripeElementsRef.current = null;
      stripeRef.current = null;
      return;
    }

    if (!cardNumberMountEl || !cardExpiryMountEl || !cardCvcMountEl) {
      return;
    }

    let active = true;
    (async () => {
      try {
        const stripe = await loadStripe(publishableKey as string);
        if (!active) return;
        if (!stripe) {
          setStripeElementError("Stripe is not configured");
          setStripeElementReady(false);
          return;
        }

        cardNumberElementRef.current?.destroy();
        cardExpiryElementRef.current?.destroy();
        cardCvcElementRef.current?.destroy();

        const elements = stripe.elements();
        const cardNumber = elements.create("cardNumber", {
          style: stripeElementStyle,
          showIcon: false,
          placeholder: "1234 1234 1234 1234",
        });
        const cardExpiry = elements.create("cardExpiry", {
          style: stripeElementStyle,
          placeholder: "MM / YY",
        });
        const cardCvc = elements.create("cardCvc", {
          style: stripeElementStyle,
          placeholder: "CVC",
        });

        cardNumber.on("change", (event) => {
          setStripeElementError(event.error?.message || null);
        });
        cardExpiry.on("change", (event) => {
          setStripeElementError(event.error?.message || null);
        });
        cardCvc.on("change", (event) => {
          setStripeElementError(event.error?.message || null);
        });

        if (!active) {
          cardNumber.destroy();
          cardExpiry.destroy();
          cardCvc.destroy();
          return;
        }

        stripeRef.current = stripe;
        stripeElementsRef.current = elements;
        cardNumber.mount(cardNumberMountEl);
        cardExpiry.mount(cardExpiryMountEl);
        cardCvc.mount(cardCvcMountEl);
        cardNumberElementRef.current = cardNumber;
        cardExpiryElementRef.current = cardExpiry;
        cardCvcElementRef.current = cardCvc;
        setStripeElementReady(true);
        setStripeElementError(null);
      } catch (error) {
        if (!active) return;
        setStripeElementReady(false);
        setStripeElementError(
          error instanceof Error ? error.message : "Failed to load Stripe",
        );
      }
    })();

    return () => {
      active = false;
      cardNumberElementRef.current?.destroy();
      cardExpiryElementRef.current?.destroy();
      cardCvcElementRef.current?.destroy();
      cardNumberElementRef.current = null;
      cardExpiryElementRef.current = null;
      cardCvcElementRef.current = null;
    };
  }, [
    cardCvcMountEl,
    cardExpiryMountEl,
    cardNumberMountEl,
    publishableKey,
    shouldMountStripe,
    stripeElementStyle,
  ]);

  // Dynamic quick-amount suggestions based on the order total
  const quickAmounts = React.useMemo(() => getQuickCashAmounts(total), [total]);

  const cash = parseFloat(cashTendered) || 0;
  const change = Math.max(0, cash - total);
  const cashShort = selectedMethod === "cash" && cash < total;

  // Escape closes the dialog unless a charge is already in flight.
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isProcessing && !stripeProcessing) {
        event.preventDefault();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, isProcessing, stripeProcessing, onOpenChange]);

  if (!open) return null;

  const handleConfirm = async () => {
    if (selectedMethod === "cash" && cashShort) return;

    if (selectedMethod === "card" && cardSubMethod === "stripe") {
      if (!settings.stripe?.enabled || !settings.stripe.configured) {
        setStripeElementError("Stripe is not configured");
        return;
      }
      const stripe = stripeRef.current;
      if (!stripe || !cardNumberElementRef.current || !stripeElementReady) {
        setStripeElementError("Stripe is not ready");
        return;
      }

      setStripeProcessing(true);
      setStripeElementError(null);
      try {
        const intent = await onCreateStripeIntent();
        // Read after the intent call, not before it: a remount in between
        // leaves the earlier element destroyed, and Stripe then refuses a
        // card it can no longer read ("make sure the Element you are
        // attempting to use is mounted"). Nothing is charged either way.
        const cardNumber = cardNumberElementRef.current;
        if (!cardNumber) throw new Error("Stripe is not ready");
        const confirmation = await stripe.confirmCardPayment(
          intent.clientSecret,
          {
            payment_method: {
              card: cardNumber,
            },
          },
        );

        if (confirmation.error) {
          throw new Error(confirmation.error.message || "Payment failed");
        }

        const status = confirmation.paymentIntent?.status;
        if (status !== "succeeded" && status !== "processing") {
          throw new Error("Payment was not completed");
        }

        const paymentIntentId =
          confirmation.paymentIntent?.id || intent.paymentIntentId;
        await onProcess(
          "card_stripe",
          total,
          paymentIntentId,
          undefined,
          paymentIntentId,
        );
      } catch (error) {
        setStripeElementError(
          error instanceof Error ? error.message : "Stripe payment failed",
        );
      } finally {
        setStripeProcessing(false);
      }
      return;
    }

    // Tag the method with the card sub-method when applicable
    const methodToSend =
      selectedMethod === "card"
        ? cardSubMethod === "touch"
          ? "card_touch"
          : "card_stripe"
        : selectedMethod;
    await onProcess(
      methodToSend,
      selectedMethod === "cash" ? cash : total,
      reference.trim() || undefined,
    );
  };

  const isCurrentlyProcessing = isProcessing || stripeProcessing;
  const stripeConfigured = Boolean(
    settings.stripe?.enabled &&
    settings.stripe.configured &&
    settings.stripe.publishableKey,
  );
  const stripeDisabled =
    selectedMethod === "card" &&
    cardSubMethod === "stripe" &&
    (!stripeConfigured || !stripeElementReady);

  const confirmLabel = isCurrentlyProcessing
    ? "Processing…"
    : selectedMethod === "cash"
      ? "Accept cash"
      : selectedMethod === "card" && cardSubMethod === "touch"
        ? `Charge ${fp(total)} on reader`
        : `Charge ${fp(total)}`;

  // The prefix must track the store currency, so it is read back out of the
  // formatter rather than hardcoded.
  const currencySymbol = fp(0).replace(/[\d\s.,]/g, "") || "$";

  // One shared label style keeps every field heading on the same rhythm.
  const fieldLabel =
    "mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isCurrentlyProcessing) {
          onOpenChange(false);
        }
      }}
    >
      {/* Bottom sheet on phones, centred dialog from sm up. Height is capped so
          the body scrolls internally and the confirm button never drifts off
          screen. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Take payment"
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border bg-background shadow-2xl animate-in slide-in-from-bottom-4 duration-300 sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl sm:zoom-in-95"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">
              Take payment
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Draft · {itemCount} {itemCount === 1 ? "item" : "items"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-1 h-8 w-8 shrink-0 rounded-full"
            onClick={() => onOpenChange(false)}
            disabled={isCurrentlyProcessing}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-[240px_1fr]">
            {/* Methods — a two-up grid on phones, a rail from sm up */}
            <div className="border-b p-3 sm:border-b-0 sm:border-r sm:p-2">
              {/* Two-up needs ~380px before labels like "Bank Transfer" start
                  truncating, so the narrowest phones get one column. */}
              <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2 sm:grid-cols-1 sm:gap-1">
                {methods.map((m) => {
                  const active = selectedMethod === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelectedMethod(m.id)}
                      disabled={isCurrentlyProcessing}
                      aria-pressed={active}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2.5 text-left transition-colors sm:border-transparent sm:px-3",
                        active
                          ? "border-primary/40 bg-primary/5 sm:bg-muted"
                          : "border-border/60 hover:bg-muted/60",
                        isCurrentlyProcessing && "opacity-60",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                          active
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {m.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium leading-tight">
                          {m.label}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {m.description}
                        </span>
                      </span>
                      {active ? (
                        <CheckCircle2 className="hidden h-4 w-4 shrink-0 text-primary sm:block" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Amount + method details */}
            <div className="space-y-4 p-4 sm:p-6">
              {/* Total due */}
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Total due
                </span>
                <span className="text-2xl font-semibold tabular-nums tracking-tight">
                  {fp(total)}
                </span>
              </div>

              {/* Discount note */}
              {discount ? (
                <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                  <Tag className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {discount.type === "percent"
                      ? `${discount.value}% discount applied`
                      : `${fp(discount.value)} discount applied`}
                  </span>
                </div>
              ) : null}

              {/* Cash */}
              {selectedMethod === "cash" ? (
                <>
                  <div>
                    <label className={fieldLabel} htmlFor="pos-cash-given">
                      Cash given
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        {currencySymbol}
                      </span>
                      <Input
                        id="pos-cash-given"
                        type="number"
                        min={0}
                        step="0.01"
                        value={cashTendered}
                        onChange={(e) => setCashTendered(e.target.value)}
                        placeholder={total.toFixed(2)}
                        className="h-12 rounded-xl pl-9 pr-4 text-base font-semibold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        autoFocus
                      />
                    </div>
                  </div>

                  {/* Exact total + the next standard notes. Two-up on phones so
                      four-figure amounts stay readable. */}
                  {quickAmounts.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {quickAmounts.map((amt) => {
                        const isExact = Math.abs(amt - total) < 0.005;
                        return (
                          <button
                            key={amt}
                            type="button"
                            onClick={() => setCashTendered(amt.toFixed(2))}
                            className={cn(
                              "h-10 rounded-xl border text-sm font-medium tabular-nums transition-colors",
                              isExact
                                ? "border-primary/40 bg-primary/5 text-primary"
                                : "border-border/60 hover:bg-muted",
                            )}
                          >
                            {fp(amt)}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {/* Change / shortfall — neutral surface, the number alone
                      carries the state. */}
                  <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-3">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {cashShort ? "Still owed" : "Change due"}
                    </span>
                    <span
                      className={cn(
                        "text-base font-semibold tabular-nums",
                        cashShort ? "text-destructive" : "text-foreground",
                      )}
                    >
                      {fp(cashShort ? total - cash : change)}
                    </span>
                  </div>
                </>
              ) : null}

              {/* Card */}
              {selectedMethod === "card" ? (
                <>
                  <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                    {CARD_SUB_OPTIONS.map((opt) => {
                      const active = cardSubMethod === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setCardSubMethod(opt.id)}
                          disabled={isCurrentlyProcessing}
                          aria-pressed={active}
                          className={cn(
                            "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
                            active
                              ? "border-primary/40 bg-primary/5"
                              : "border-border/60 hover:bg-muted/60",
                            isCurrentlyProcessing && "opacity-60",
                          )}
                        >
                          <span
                            className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                              active
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {opt.icon}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium leading-tight">
                              {opt.label}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {opt.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {cardSubMethod === "touch" ? (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-dashed bg-muted/30 px-4 py-6 text-center">
                        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                          <Nfc className="h-5 w-5 animate-pulse text-muted-foreground" />
                        </span>
                        <p className="mt-3 text-sm font-medium">
                          Ready for tap or insert
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Customer taps or inserts their card on the reader.
                        </p>
                      </div>
                      <div>
                        <label className={fieldLabel} htmlFor="pos-card-ref">
                          Reference (optional)
                        </label>
                        <Input
                          id="pos-card-ref"
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                          placeholder="Transaction ID, auth code, etc."
                          className="h-11 rounded-xl text-sm"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <label className={fieldLabel}>Card number</label>
                        <div
                          className="relative cursor-text"
                          onClick={() => cardNumberElementRef.current?.focus()}
                        >
                          <div
                            ref={setCardNumberMountEl}
                            className="min-h-11 rounded-xl border bg-background px-4 py-3 text-sm transition-[color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className={fieldLabel}>Expiry</label>
                          <div
                            className="relative cursor-text"
                            onClick={() =>
                              cardExpiryElementRef.current?.focus()
                            }
                          >
                            <div
                              ref={setCardExpiryMountEl}
                              className="min-h-11 rounded-xl border bg-background px-4 py-3 text-sm transition-[color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
                            />
                          </div>
                        </div>
                        <div>
                          <label className={fieldLabel}>CVC</label>
                          <div
                            className="relative cursor-text"
                            onClick={() => cardCvcElementRef.current?.focus()}
                          >
                            <div
                              ref={setCardCvcMountEl}
                              className="min-h-11 rounded-xl border bg-background px-4 py-3 text-sm transition-[color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
                            />
                          </div>
                        </div>
                      </div>
                      {stripeElementError ? (
                        <p className="text-xs text-destructive">
                          {stripeElementError}
                        </p>
                      ) : !stripeConfigured ? (
                        <p className="text-xs text-destructive">
                          Stripe is not configured in payment settings.
                        </p>
                      ) : !stripeElementReady ? (
                        <p className="text-xs text-muted-foreground">
                          Loading secure card fields…
                        </p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        Secured by Stripe — card details are tokenized on
                        submit.
                      </p>
                    </div>
                  )}
                </>
              ) : null}

              {/* Bank / Manual */}
              {selectedMethod === "bank" || selectedMethod === "manual" ? (
                <div>
                  <label className={fieldLabel} htmlFor="pos-payment-ref">
                    Reference (optional)
                  </label>
                  <Input
                    id="pos-payment-ref"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Transaction ID, authorization code, etc."
                    className="h-11 rounded-xl text-sm"
                    autoFocus
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Footer — pinned so the charge action stays reachable while the body
            scrolls, and clear of the home indicator on phones. */}
        <div className="shrink-0 border-t bg-background px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3 sm:px-6 sm:pb-4">
          <Button
            onClick={handleConfirm}
            disabled={isCurrentlyProcessing || cashShort || stripeDisabled}
            className="h-12 w-full rounded-xl text-sm font-semibold"
          >
            {isCurrentlyProcessing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : selectedMethod === "card" && cardSubMethod === "touch" ? (
              <Nfc className="mr-2 h-4 w-4" />
            ) : null}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
