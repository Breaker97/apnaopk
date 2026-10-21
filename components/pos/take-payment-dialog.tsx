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
  Gift,
  Plus,
  Trash2,
  CalendarClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createStripeElementStyle } from "@/components/checkout/checkout-helpers";
import { cn } from "@/lib/utils";
import type { POSSettings } from "@/lib/pos/build-pos-settings";
import type { POSDiscount } from "@/components/pos/discount-dialog";
import { quantizeToCurrency, roundMoney } from "@/lib/intl/money";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import {
  remainingAfterTenders,
  sumTenders,
  type POSTenderInput,
} from "@/lib/pos/tenders";

type PaymentMethodId = "cash" | "card" | "bank" | "manual" | "store_credit";
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
  /**
   * Take the sale with these tenders. `deposit` asks for part of it now and
   * the rest later. Resolves true when the sale went through (or was queued).
   */
  onComplete: (
    tenders: POSTenderInput[],
    options: { deposit: boolean },
  ) => Promise<boolean>;
  /** An intent for what the card pays: the rest of the sale. */
  onCreateStripeIntent: (amount: number) => Promise<{
    paymentIntentId: string;
    clientSecret: string;
  }>;
  isProcessing: boolean;
  settings: POSSettings;
  /**
   * Whether the register has lost its connection.
   *
   * Stripe and store credit care: both need the server at the moment of
   * payment, so offering either offline would strand the cashier mid-sale.
   * Cash is local, and a "Touch" card payment is settled by the reader on its
   * own line — the register is merely recording that it happened.
   */
  isOffline?: boolean;
  fp: (amount: number) => string;
  /** Store credit the sale's customer account can spend; 0 or absent: none. */
  storeCreditAvailable?: number;
  /**
   * An exchange's refund, already counted out of the drawer, paying toward
   * this sale: it opens as a cash tender carrying the return's reference.
   */
  exchangeCredit?: { amount: number; reference: string } | null;
  /** A customer is on the sale — a deposit needs someone to owe the rest. */
  hasCustomer: boolean;
  /**
   * "sale" rings a sale up. "balance" takes a payment toward a deposit sale's
   * balance: part of it is always allowed (the rest stays owed), and neither
   * the Stripe form nor store credit is offered — see lib/pos/collect-balance.ts.
   */
  mode?: "sale" | "balance";
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
  onComplete,
  onCreateStripeIntent,
  isProcessing,
  settings,
  isOffline = false,
  fp,
  storeCreditAvailable = 0,
  exchangeCredit = null,
  hasCustomer,
  mode = "sale",
}: POSTakePaymentDialogProps) {
  const isBalance = mode === "balance";
  const t = useTranslations("pos.pay");
  const tRoot = useTranslations();
  const currency = settings.currency;
  const money = React.useCallback(
    (value: number) => quantizeToCurrency(value, currency),
    [currency],
  );

  /** Tenders taken so far on this sale, in order. */
  const [tenders, setTenders] = React.useState<POSTenderInput[]>([]);
  const [selectedMethod, setSelectedMethod] =
    React.useState<PaymentMethodId>("cash");
  const [cardSubMethod, setCardSubMethod] =
    React.useState<CardSubMethod>("touch");
  /** Cash given, or the amount of a non-cash tender. */
  const [amountText, setAmountText] = React.useState("");
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

  const remaining = remainingAfterTenders(total, tenders, currency);
  const paidSoFar = sumTenders(tenders, currency);
  const creditInTenders = sumTenders(
    tenders.filter((tender) => tender.method === "store_credit"),
    currency,
  );
  const creditLeft = Math.max(0, money(storeCreditAvailable - creditInTenders));

  const prefillFor = React.useCallback(
    (method: PaymentMethodId, left: number) => {
      const value = method === "store_credit" ? Math.min(creditLeft, left) : left;
      return value > 0 ? String(value) : "";
    },
    [creditLeft],
  );

  const CARD_SUB_OPTIONS: CardSubOption[] = React.useMemo(
    () => [
      {
        id: "touch",
        label: t("touch"),
        description: t("touchDesc"),
        icon: <Nfc className="h-4 w-4" />,
      },
      // Dropped entirely rather than shown disabled: a greyed-out button at the
      // counter is a question the cashier has to stop and answer while somebody
      // waits. The reader-based option next to it still takes cards.
      ...(isOffline || isBalance
        ? []
        : [
            {
              id: "stripe" as const,
              label: t("stripe"),
              description: t("stripeDesc"),
              icon: <Wallet className="h-4 w-4" />,
            },
          ]),
    ],
    [isOffline, isBalance, t],
  );

  // A connection lost while the dialog is already open, with Stripe selected,
  // would otherwise leave the sale pointed at a method that no longer exists.
  useApplyOnChange([isOffline, cardSubMethod], () => {
    if (isOffline && cardSubMethod === "stripe") setCardSubMethod("touch");
  });

  // A fresh sale opens empty, on the first method, asking for all of it.
  useApplyOnChange([open, total], () => {
    if (!open) return;
    // An exchange's refund pays first: the money never left the counter.
    const exchange =
      !isBalance && exchangeCredit && exchangeCredit.amount > 0 && settings.paymentMethods.includes("cash")
        ? money(Math.min(exchangeCredit.amount, total))
        : 0;
    const opening: POSTenderInput[] =
      exchange > 0
        ? [{ method: "cash", amount: exchange, tendered: exchange, reference: exchangeCredit?.reference }]
        : [];
    setTenders(opening);
    setSelectedMethod("cash");
    setCardSubMethod("touch");
    // Prefill the exact total — paying to the cent is the common case, and an
    // empty field left the confirm button disabled for no visible reason.
    const left = money(total - exchange);
    setAmountText(left > 0 ? String(left) : "");
    setReference("");
    setStripeElementError(null);
  });

  // Available payment methods based on settings
  const methods: PaymentMethodOption[] = React.useMemo(() => {
    const list: PaymentMethodOption[] = [];
    if (settings.paymentMethods.includes("cash")) {
      list.push({
        id: "cash",
        label: tRoot("pos.cash"),
        description: t("cashDesc"),
        icon: <Banknote className="h-4 w-4" />,
      });
    }
    if (settings.paymentMethods.includes("card")) {
      list.push({
        id: "card",
        label: tRoot("pos.card"),
        // Offline the Stripe form is gone, so promising it here would send the
        // cashier looking for a button that is not on the screen.
        description: isOffline
          ? tRoot("pos.offline.readerOnly")
          : tRoot("pos.offline.touchOrStripe"),
        icon: <CreditCard className="h-4 w-4" />,
      });
    }
    if (settings.paymentMethods.includes("bank")) {
      list.push({
        id: "bank",
        label: t("bank"),
        description: t("bankDesc"),
        icon: <Building2 className="h-4 w-4" />,
      });
    }
    if (settings.paymentMethods.includes("manual")) {
      list.push({
        id: "manual",
        label: tRoot("pos.manual"),
        description: t("manualDesc"),
        icon: <Tag className="h-4 w-4" />,
      });
    }
    // Store credit is held on the server at the moment of sale, so it needs
    // the connection — and an account that has some.
    if (!isOffline && !isBalance && storeCreditAvailable > 0) {
      list.push({
        id: "store_credit",
        label: t("storeCredit"),
        description: t("storeCreditDesc", { amount: fp(creditLeft) }),
        icon: <Gift className="h-4 w-4" />,
      });
    }
    return list;
  }, [settings.paymentMethods, isOffline, isBalance, storeCreditAvailable, creditLeft, fp, t, tRoot]);

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

  // Dynamic quick-amount suggestions based on what is left to pay
  const quickAmounts = React.useMemo(() => getQuickCashAmounts(remaining), [remaining]);

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

  const isStripe = selectedMethod === "card" && cardSubMethod === "stripe";
  const entered = money(Number.parseFloat(amountText) || 0);
  // What this entry pays of the sale. Cash may be more (the rest is change);
  // anything else is held to what is left, and store credit to what is held.
  const applied = isStripe
    ? remaining
    : selectedMethod === "cash"
      ? Math.min(entered, remaining)
      : selectedMethod === "store_credit"
        ? Math.min(entered, remaining, creditLeft)
        : Math.min(entered, remaining);
  const tooMuch =
    !isStripe && selectedMethod !== "cash" && entered > remaining + 0.000001;
  const tooMuchCredit =
    selectedMethod === "store_credit" && entered > creditLeft + 0.000001;
  const change = selectedMethod === "cash" ? Math.max(0, money(entered - remaining)) : 0;
  const coversRest = applied > 0 && applied >= remaining - 0.000001;
  // Paid in full by what is already on the list — an exchange's credit that
  // covers the whole of the new sale.
  const fullyTendered = tenders.length > 0 && remaining <= 0.000001;
  const entryValid = applied > 0 && !tooMuch && !tooMuchCredit;

  const entryTender = (): POSTenderInput => {
    const base: POSTenderInput = {
      method: selectedMethod,
      amount: money(applied),
      reference: reference.trim() || undefined,
    };
    if (selectedMethod === "cash") base.tendered = entered;
    if (selectedMethod === "card") base.cardSubMethod = "card_touch";
    return base;
  };

  const resetEntry = (left: number, method: PaymentMethodId = selectedMethod) => {
    setAmountText(prefillFor(method, left));
    setReference("");
  };

  const choose = (method: PaymentMethodId) => {
    setSelectedMethod(method);
    resetEntry(remaining, method);
  };

  const addTender = () => {
    if (!entryValid || coversRest) return;
    const next = [...tenders, entryTender()];
    setTenders(next);
    resetEntry(remainingAfterTenders(total, next, currency));
  };

  const complete = async (deposit: boolean) => {
    const list = applied > 0 && entryValid ? [...tenders, entryTender()] : tenders;
    await onComplete(list, { deposit });
  };

  const handleStripe = async () => {
    if (!settings.stripe?.enabled || !settings.stripe.configured) {
      setStripeElementError(t("stripeNotConfigured"));
      return;
    }
    const stripe = stripeRef.current;
    if (!stripe || !cardNumberElementRef.current || !stripeElementReady) {
      setStripeElementError(t("stripeLoading"));
      return;
    }
    setStripeProcessing(true);
    setStripeElementError(null);
    try {
      // The card pays the rest — and only the rest — so a sale abandoned after
      // it is charged cannot exist: the charge completes it.
      const intent = await onCreateStripeIntent(remaining);
      // Read after the intent call, not before it: a remount in between
      // leaves the earlier element destroyed, and Stripe then refuses a
      // card it can no longer read ("make sure the Element you are
      // attempting to use is mounted"). Nothing is charged either way.
      const cardNumber = cardNumberElementRef.current;
      if (!cardNumber) throw new Error(t("stripeLoading"));
      const confirmation = await stripe.confirmCardPayment(intent.clientSecret, {
        payment_method: { card: cardNumber },
      });
      if (confirmation.error) {
        throw new Error(confirmation.error.message || t("stripeFailed"));
      }
      const status = confirmation.paymentIntent?.status;
      if (status !== "succeeded" && status !== "processing") {
        throw new Error(t("stripeFailed"));
      }
      const paymentIntentId = confirmation.paymentIntent?.id || intent.paymentIntentId;
      await onComplete(
        [
          ...tenders,
          {
            method: "card",
            amount: remaining,
            cardSubMethod: "card_stripe",
            stripePaymentIntentId: paymentIntentId,
          },
        ],
        { deposit: false },
      );
    } catch (error) {
      setStripeElementError(error instanceof Error ? error.message : t("stripeFailed"));
    } finally {
      setStripeProcessing(false);
    }
  };

  const handlePrimary = async () => {
    if (fullyTendered) return complete(false);
    if (isStripe) return handleStripe();
    if (!entryValid) return;
    if (coversRest) return complete(false);
    addTender();
  };

  const isCurrentlyProcessing = isProcessing || stripeProcessing;
  const stripeConfigured = Boolean(
    settings.stripe?.enabled &&
    settings.stripe.configured &&
    settings.stripe.publishableKey,
  );
  const stripeDisabled = isStripe && (!stripeConfigured || !stripeElementReady);

  const methodLabel = (id: PaymentMethodId) =>
    methods.find((method) => method.id === id)?.label ?? id;

  const confirmLabel = isCurrentlyProcessing
    ? t("processing")
    : fullyTendered
      ? t("completeSale")
      : isStripe
      ? t("charge", { amount: fp(remaining) })
      : !coversRest
        ? t("addPayment", { method: methodLabel(selectedMethod), amount: fp(applied) })
        : selectedMethod === "cash"
          ? t("acceptCash")
          : selectedMethod === "store_credit"
            ? t("useCredit", { amount: fp(applied) })
            : selectedMethod === "card"
              ? t("chargeOnReader", { amount: fp(applied) })
              : t("charge", { amount: fp(applied) });

  // A deposit: something paid, something left, a customer to owe it, and a
  // store that takes deposits. Never on the Stripe form, which pays the rest.
  const depositPaid = money(paidSoFar + (entryValid ? applied : 0));
  // Toward a balance, part of it is always fine: the rest simply stays owed.
  const canDeposit = isBalance
    ? depositPaid > 0 && depositPaid < total
    : settings.allowDeposits === true &&
      hasCustomer &&
      !isStripe &&
      depositPaid > 0 &&
      depositPaid < total;
  const depositNeedsCustomer =
    !isBalance &&
    settings.allowDeposits === true &&
    !hasCustomer &&
    depositPaid > 0 &&
    depositPaid < total;

  // The prefix must track the store currency, so it is read back out of the
  // formatter rather than hardcoded.
  const currencySymbol = fp(0).replace(/[\d\s.,]/g, "") || "$";

  // One shared label style keeps every field heading on the same rhythm.
  const fieldLabel =
    "mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground";

  const amountField = (id: string, label: string, autoFocus: boolean) => (
    <div>
      <label className={fieldLabel} htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          {currencySymbol}
        </span>
        <Input
          id={id}
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          placeholder={String(remaining)}
          className="h-12 rounded-xl pl-9 pr-4 text-base font-semibold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          autoFocus={autoFocus}
        />
      </div>
      {tooMuch ? (
        <p className="mt-1.5 text-xs text-destructive">{t("tooMuch", { amount: fp(remaining) })}</p>
      ) : tooMuchCredit ? (
        <p className="mt-1.5 text-xs text-destructive">{t("tooMuchCredit", { amount: fp(creditLeft) })}</p>
      ) : null}
    </div>
  );

  const referenceField = (id: string, autoFocus = false) => (
    <div>
      <label className={fieldLabel} htmlFor={id}>
        {t("referenceOptional")}
      </label>
      <Input
        id={id}
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        placeholder={t("referencePlaceholder")}
        className="h-11 rounded-xl text-sm"
        autoFocus={autoFocus}
      />
    </div>
  );

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
        aria-label={isBalance ? t("balanceTitle") : t("title")}
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border bg-background shadow-2xl animate-in slide-in-from-bottom-4 duration-300 sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl sm:zoom-in-95"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">
              {isBalance ? t("balanceTitle") : t("title")}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("draftItems", { count: itemCount })}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-1 h-8 w-8 shrink-0 rounded-full"
            onClick={() => onOpenChange(false)}
            disabled={isCurrentlyProcessing}
            aria-label={t("close")}
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
                      onClick={() => choose(m.id)}
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
              {/* Total, and what is left once some has been paid */}
              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {tenders.length > 0 ? t("remaining") : t("totalDue")}
                  </span>
                  <span className="text-2xl font-semibold tabular-nums tracking-tight">
                    {fp(remaining)}
                  </span>
                </div>
                {tenders.length > 0 ? (
                  <p className="text-right text-xs text-muted-foreground tabular-nums">
                    {t("ofTotal", { paid: fp(paidSoFar), total: fp(total) })}
                  </p>
                ) : null}
              </div>

              {/* The tenders taken so far, each removable until the sale is done */}
              {tenders.length > 0 ? (
                <div className="rounded-xl border">
                  <p className="border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("payments")}
                  </p>
                  <ul className="divide-y">
                    {tenders.map((tender, index) => (
                      <li key={index} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">
                          {methodLabel(tender.method)}
                          {tender.reference ? (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {tender.reference}
                            </span>
                          ) : null}
                        </span>
                        <span className="font-medium tabular-nums">{fp(tender.amount)}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 rounded-full"
                          aria-label={t("remove")}
                          disabled={isCurrentlyProcessing}
                          onClick={() => {
                            const next = tenders.filter((_, at) => at !== index);
                            setTenders(next);
                            resetEntry(remainingAfterTenders(total, next, currency));
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Discount note */}
              {discount ? (
                <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                  <Tag className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {discount.type === "percent"
                      ? t("discountPercent", { value: discount.value })
                      : t("discountAmount", { amount: fp(discount.value) })}
                  </span>
                </div>
              ) : null}

              {/* Cash */}
              {selectedMethod === "cash" ? (
                <>
                  {amountField("pos-cash-given", t("cashGiven"), true)}

                  {/* What is left + the next standard notes. Two-up on phones so
                      four-figure amounts stay readable. */}
                  {quickAmounts.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {quickAmounts.map((amt) => {
                        const isExact = Math.abs(amt - remaining) < 0.005;
                        return (
                          <button
                            key={amt}
                            type="button"
                            onClick={() => setAmountText(String(amt))}
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

                  {/* Change, or what this cash leaves to pay another way. */}
                  <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-3">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {coversRest ? t("changeDue") : t("stillOwed")}
                    </span>
                    <span
                      className={cn(
                        "text-base font-semibold tabular-nums",
                        coversRest ? "text-foreground" : "text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {fp(coversRest ? change : money(remaining - applied))}
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
                      {amountField("pos-card-amount", t("amount"), false)}
                      <div className="rounded-xl border border-dashed bg-muted/30 px-4 py-5 text-center">
                        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                          <Nfc className="h-5 w-5 animate-pulse text-muted-foreground" />
                        </span>
                        <p className="mt-3 text-sm font-medium">{t("readyForTap")}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{t("readyForTapNote")}</p>
                      </div>
                      {referenceField("pos-card-ref")}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                        {t("stripePaysRest", { amount: fp(remaining) })}
                      </p>
                      <div>
                        <label className={fieldLabel}>{t("cardNumber")}</label>
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
                          <label className={fieldLabel}>{t("expiry")}</label>
                          <div
                            className="relative cursor-text"
                            onClick={() => cardExpiryElementRef.current?.focus()}
                          >
                            <div
                              ref={setCardExpiryMountEl}
                              className="min-h-11 rounded-xl border bg-background px-4 py-3 text-sm transition-[color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
                            />
                          </div>
                        </div>
                        <div>
                          <label className={fieldLabel}>{t("cvc")}</label>
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
                        <p className="text-xs text-destructive">{stripeElementError}</p>
                      ) : !stripeConfigured ? (
                        <p className="text-xs text-destructive">{t("stripeNotConfigured")}</p>
                      ) : !stripeElementReady ? (
                        <p className="text-xs text-muted-foreground">{t("stripeLoading")}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">{t("stripeSecured")}</p>
                    </div>
                  )}
                </>
              ) : null}

              {/* Bank / Manual / Store credit */}
              {selectedMethod === "bank" || selectedMethod === "manual" ? (
                <div className="space-y-3">
                  {amountField(`pos-${selectedMethod}-amount`, t("amount"), true)}
                  {referenceField("pos-payment-ref")}
                </div>
              ) : null}
              {selectedMethod === "store_credit" ? (
                <div className="space-y-3">
                  {amountField("pos-credit-amount", t("amount"), true)}
                  <p className="text-xs text-muted-foreground">
                    {t("storeCreditDesc", { amount: fp(creditLeft) })}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Footer — pinned so the charge action stays reachable while the body
            scrolls, and clear of the home indicator on phones. */}
        <div className="shrink-0 space-y-2 border-t bg-background px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3 sm:px-6 sm:pb-4">
          <Button
            onClick={() => void handlePrimary()}
            disabled={
              isCurrentlyProcessing ||
              (!fullyTendered && (stripeDisabled || (!isStripe && !entryValid)))
            }
            className="h-12 w-full rounded-xl text-sm font-semibold"
          >
            {isCurrentlyProcessing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : !isStripe && !coversRest ? (
              <Plus className="mr-2 h-4 w-4" />
            ) : selectedMethod === "card" && cardSubMethod === "touch" ? (
              <Nfc className="mr-2 h-4 w-4" />
            ) : null}
            {confirmLabel}
          </Button>
          {canDeposit ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void complete(true)}
              disabled={isCurrentlyProcessing || (applied > 0 && !entryValid)}
              className="h-11 w-full rounded-xl text-sm"
            >
              <CalendarClock className="mr-2 h-4 w-4" />
              {t(isBalance ? "takePart" : "takeDeposit", {
                amount: fp(depositPaid),
                due: fp(roundMoney(total - depositPaid)),
              })}
            </Button>
          ) : depositNeedsCustomer ? (
            <p className="text-center text-xs text-muted-foreground">
              {t("depositNeedsCustomer")}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
