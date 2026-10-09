"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import {
  loadStripe,
  type Stripe,
  type StripeCardCvcElement,
  type StripeCardExpiryElement,
  type StripeCardNumberElement,
} from "@stripe/stripe-js";
import { Clock, CreditCard, Loader2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast-notification";
import { useCurrency } from "@/providers/currency-provider";
import { useAppTheme } from "@/providers/theme-provider";
import { createStripeElementStyle } from "@/components/checkout/checkout-helpers";
import { getPreorderBalanceDue } from "@/lib/orders/order-payment-status";

/**
 * Money owed on an order that already exists, and a way to pay it.
 *
 * Two flows share this one card, deliberately:
 *
 *  - `preorder_balance`, the deposit-mode pre-order it was written for —
 *    checkout took the deposit, the "payment due" notification asks for the
 *    rest, and this is where that request lands;
 *  - `order_pay`, the "pay now" link sent when an order's payment never
 *    arrived at all (`lib/payments/order-pay.ts`).
 *
 * They differ in which routes they call and what the figures are called; the
 * card form, the PayPal hand-off, the confirm-then-webhook race and the
 * "still clearing" state are identical, and a second implementation of those
 * would be a second place for a money bug to live.
 */

/** Which flow this card is collecting for — see the comment above. */
type BalanceCardMode = "preorder_balance" | "order_pay";

interface PreorderBalanceOrder {
  _id: string;
  status: string;
  paymentStatus: string;
  hasPreorder?: boolean;
  preorderStatus?: string;
  preorderPaymentMode?: string;
  preorderOutstandingAmount?: number;
  /**
   * What the order API worked out is still owed, net of any consignment a
   * vendor has cancelled.
   *
   * Preferred over recomputing here because the customer view of an order
   * deliberately strips sub-order items, so the browser cannot see which part
   * of the balance belongs to a consignment nobody is sending. The local
   * computation stays as the fallback for a caller that has not been updated.
   */
  preorderBalanceDue?: number;
  /**
   * What the shopper has paid and not had back, from the same source. The
   * fallback, `total` less the balance, counts a cancelled consignment's
   * balance as paid and misses the refund that went with it.
   */
  preorderPaidSoFar?: number;
  /** ISO day the unpaid balance is cancelled and refunded on. */
  preorderBalanceDeadline?: string;
  /**
   * The earliest moment the saved card may be charged automatically, once the
   * advance notice window has passed. Absent when no charge is scheduled.
   */
  preorderAutoChargeAt?: string;
  /** How the order was meant to be paid — the pay-link card offers its retry. */
  paymentMethod?: string;
  total: number;
}

/** The gateways where paying means approving a prompt, not typing a card. */
const PUSH_METHODS = ["iotec", "mtn_momo", "orange_money"];

const ELEMENT_BOX_CLASS =
  "rounded-md border border-input bg-background px-3 py-2.5 focus-within:ring-2 focus-within:ring-ring";

export function PreorderBalanceCard({
  order,
  locale,
  accessToken,
  mode = "preorder_balance",
  onPaid,
}: {
  order: PreorderBalanceOrder;
  locale: string;
  /** Defaults to the pre-order balance this card was written for. */
  mode?: BalanceCardMode;
  /**
   * The signed link from the shopper's "balance due" email, when this card is
   * rendered on the public balance page rather than inside their account.
   *
   * A guest order is backed by a cart rather than a user, so no session can
   * speak for it — the token is how the two routes below recognise the caller.
   * Absent in the account view, where the session already does.
   */
  accessToken?: string;
  onPaid: () => void;
}) {
  const t = useTranslations();
  const tf = useFallbackTranslator(t);
  const { formatPrice } = useCurrency();
  const { isDark } = useAppTheme();
  const elementStyle = useMemo(() => createStripeElementStyle(isDark), [isDark]);

  const balanceDue =
    typeof order.preorderBalanceDue === "number"
      ? Math.max(0, order.preorderBalanceDue)
      : getPreorderBalanceDue(order);
  const paidSoFar =
    typeof order.preorderPaidSoFar === "number"
      ? Math.max(0, order.preorderPaidSoFar)
      : Math.max(0, Number(order.total || 0) - balanceDue);
  const deadline = order.preorderBalanceDeadline
    ? new Date(order.preorderBalanceDeadline)
    : null;
  const deadlineLabel =
    deadline && !Number.isNaN(deadline.getTime())
      ? new Intl.DateTimeFormat(locale, {
          day: "numeric",
          month: "short",
          year: "numeric",
          // Counted from the release date, a UTC calendar day — see
          // `formatPreorderReleaseDate`.
          timeZone: "UTC",
        }).format(deadline)
      : null;

  const autoChargeAt = order.preorderAutoChargeAt
    ? new Date(order.preorderAutoChargeAt)
    : null;
  const autoChargeLabel =
    autoChargeAt && !Number.isNaN(autoChargeAt.getTime())
      ? new Intl.DateTimeFormat(locale, {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(autoChargeAt)
      : null;

  // Everything that differs between the two flows, in one place. The routes
  // are not interchangeable: each one checks a differently-signed link and
  // collects a different figure.
  const payingWholeOrder = mode === "order_pay";
  const intentUrl = payingWholeOrder
    ? `/api/orders/${order._id}/pay`
    : `/api/orders/${order._id}/preorder-balance`;
  const confirmUrl = payingWholeOrder
    ? `/api/orders/${order._id}/pay/confirm`
    : `/api/orders/${order._id}/preorder-balance/confirm`;
  const paypalUrl = payingWholeOrder
    ? `/api/orders/${order._id}/pay/paypal`
    : `/api/orders/${order._id}/preorder-balance/paypal`;
  // PayPal returns to the page it left, so each flow marks its own return
  // parameter — a balance return must not be mistaken for a pay-link one.
  const paypalReturnParam = payingWholeOrder
    ? "paypalOrderPay"
    : "paypalBalance";

  // A mobile-money order cannot be "paid again" with a card the shopper never
  // used: what it needs is the prompt resending to the same phone.
  const canResendPush =
    payingWholeOrder &&
    PUSH_METHODS.includes(String(order.paymentMethod || "").toLowerCase());
  const [resendingPush, setResendingPush] = useState(false);

  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [cardEnabled, setCardEnabled] = useState<boolean | null>(null);
  const [paypalEnabled, setPaypalEnabled] = useState(false);
  const [redirectingToPayPal, setRedirectingToPayPal] = useState(false);
  // PayPal sends the shopper back to this page to be captured. The return is
  // acted on once: a dev-mode double effect, or a re-render, must not ask the
  // capture route twice for the same approval.
  const paypalReturnHandled = useRef(false);
  const [open, setOpen] = useState(false);
  const [cardholder, setCardholder] = useState("");
  const [elementError, setElementError] = useState<string | null>(null);
  const [elementsReady, setElementsReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // The bank is still confirming a payment already made; nothing to pay now.
  const [processing, setProcessing] = useState(false);

  const stripeRef = useRef<Stripe | null>(null);
  const cardNumberRef = useRef<StripeCardNumberElement | null>(null);
  const cardExpiryRef = useRef<StripeCardExpiryElement | null>(null);
  const cardCvcRef = useRef<StripeCardCvcElement | null>(null);
  // Read by the mount effect without being a dependency of it. `t` is a new
  // function every time the layout re-sends its messages — which any
  // `router.refresh()` does, and the storefront refreshes on tab focus — and
  // re-running the effect destroys the card the shopper has already typed.
  // Mid-payment that was fatal: `confirmCardPayment` was handed an element
  // that no longer existed, which is Stripe's "make sure the Element you are
  // attempting to use is mounted" error.
  const tRef = useRef(t);
  const elementStyleRef = useRef(elementStyle);
  const [numberEl, setNumberEl] = useState<HTMLDivElement | null>(null);
  const [expiryEl, setExpiryEl] = useState<HTMLDivElement | null>(null);
  const [cvcEl, setCvcEl] = useState<HTMLDivElement | null>(null);

  // A pay link is shown for any order that still owes money; the balance card
  // only for a pre-order that has one.
  const showCard =
    (payingWholeOrder || Boolean(order.hasPreorder)) && balanceDue > 0;

  useEffect(() => {
    if (!showCard) return;
    let active = true;
    fetch("/api/settings/public")
      .then((res) => res.json())
      .then((json) => {
        if (!active) return;
        const payment = json?.data?.payment || {};
        const key = String(payment.stripePublishableKey || "");
        setPublishableKey(key || null);
        setCardEnabled(Boolean(payment.stripeEnabled && key));
        // `paypalConfigured`, not `paypalEnabled`: a switched-on gateway with
        // no credentials would send the shopper off to fail at PayPal.
        setPaypalEnabled(Boolean(payment.paypalConfigured));
      })
      .catch(() => {
        if (active) setCardEnabled(false);
      });
    return () => {
      active = false;
    };
  }, [showCard]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    elementStyleRef.current = elementStyle;
    // Restyled in place on a theme switch. Tearing the elements down and
    // building them again would clear the card number mid-form.
    cardNumberRef.current?.update({ style: elementStyle });
    cardExpiryRef.current?.update({ style: elementStyle });
    cardCvcRef.current?.update({ style: elementStyle });
  }, [elementStyle]);

  useEffect(() => {
    if (!open || !publishableKey || !numberEl || !expiryEl || !cvcEl) return;
    let active = true;
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        const stripe = await loadStripe(publishableKey);
        if (!active) return;
        if (!stripe) {
          setElementError("Stripe is not configured");
          return;
        }
        stripeRef.current = stripe;
        const style = elementStyleRef.current;
        const translate = tRef.current;
        const elements = stripe.elements();
        const cardNumber = elements.create("cardNumber", {
          style,
          showIcon: false,
          placeholder: translate("payment.cardNumber"),
        });
        const cardExpiry = elements.create("cardExpiry", {
          style,
          placeholder: translate("payment.expiryDate"),
        });
        const cardCvc = elements.create("cardCvc", {
          style,
          placeholder: translate("payment.cvv"),
        });
        cardNumber.on("change", (ev) => setElementError(ev.error?.message || null));
        cardExpiry.on("change", (ev) => setElementError(ev.error?.message || null));
        cardCvc.on("change", (ev) => setElementError(ev.error?.message || null));
        cardNumber.mount(numberEl);
        cardExpiry.mount(expiryEl);
        cardCvc.mount(cvcEl);
        cardNumberRef.current = cardNumber;
        cardExpiryRef.current = cardExpiry;
        cardCvcRef.current = cardCvc;
        cleanup = () => {
          cardNumber.destroy();
          cardExpiry.destroy();
          cardCvc.destroy();
          cardNumberRef.current = null;
          cardExpiryRef.current = null;
          cardCvcRef.current = null;
        };
        setElementsReady(true);
        setElementError(null);
      } catch (err) {
        if (!active) return;
        setElementError(
          err instanceof Error ? err.message : "Failed to load payment form",
        );
      }
    })();
    return () => {
      active = false;
      cleanup?.();
      setElementsReady(false);
    };
  }, [open, publishableKey, numberEl, expiryEl, cvcEl]);

  // Back from PayPal. Declared above the early return like every other hook,
  // and not gated on `showCard`: a reload after a successful capture finds the
  // balance already paid and must still clear PayPal's parameters off the URL.
  useEffect(() => {
    if (paypalReturnHandled.current) return;
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get(paypalReturnParam);
    if (!outcome) return;
    paypalReturnHandled.current = true;
    // PayPal appends its own order id as `token` — unrelated to the signed
    // balance link, which travels in the path, not the query.
    const paypalOrderId = url.searchParams.get("token");

    const clearParams = () => {
      url.searchParams.delete(paypalReturnParam);
      url.searchParams.delete("token");
      url.searchParams.delete("PayerID");
      window.history.replaceState(window.history.state, "", url.toString());
    };

    if (outcome !== "return" || !paypalOrderId) {
      clearParams();
      toast.info(
        tf(
          "orders.preorderBalance.paypalCancelled",
          "PayPal payment was cancelled. Nothing was charged.",
        ),
      );
      return;
    }

    (async () => {
      try {
        const res = await fetch("/api/payments/paypal/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: paypalOrderId }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.message || t("orders.preorderBalance.failed"));
        }
        const data = json.data || {};
        if (data.settled) {
          toast.success(t("orders.preorderBalance.success"));
        } else if (data.reason === "unrecordable" || data.reason === "claim_lost") {
          // Captured and could not be recorded, so the server refunded it and
          // told the admins. "Paid" here would be a lie.
          toast.error(t("orders.preorderBalance.reversed"));
        }
        onPaid();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("orders.preorderBalance.failed"),
        );
      } finally {
        clearParams();
      }
    })();
    // Runs once per landing; `t`, `tf` and `onPaid` changing identity on a
    // refresh must not replay a capture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!showCard) return null;

  const payWithPayPal = async () => {
    setRedirectingToPayPal(true);
    try {
      const res = await fetch(paypalUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale, accessToken }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || t("orders.preorderBalance.failed"));
      }
      if (json.data?.alreadyPaid) {
        toast.success(t("orders.preorderBalance.success"));
        setRedirectingToPayPal(false);
        onPaid();
        return;
      }
      // Left on the redirecting state: the page is about to be replaced.
      window.location.assign(String(json.data?.approvalUrl));
    } catch (err) {
      setRedirectingToPayPal(false);
      toast.error(
        err instanceof Error ? err.message : t("orders.preorderBalance.failed"),
      );
    }
  };

  const resendPush = async () => {
    setResendingPush(true);
    try {
      const res = await fetch(`/api/orders/${order._id}/pay/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale, accessToken }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || t("orders.preorderBalance.failed"));
      }
      if (json.data?.redirectUrl) {
        // Orange Money takes the payer to its own page rather than prompting.
        window.location.assign(String(json.data.redirectUrl));
        return;
      }
      toast.success(
        tf(
          "orders.payNow.pushSent",
          "Check your phone — we have sent the payment request again.",
        ),
      );
      setResendingPush(false);
    } catch (err) {
      setResendingPush(false);
      toast.error(
        err instanceof Error ? err.message : t("orders.preorderBalance.failed"),
      );
    }
  };

  const handlePay = async () => {
    const stripe = stripeRef.current;
    if (!stripe || !cardNumberRef.current || !elementsReady) return;
    setSubmitting(true);
    setElementError(null);
    try {
      const intentRes = await fetch(intentUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale, accessToken }),
      });
      const intentJson = await intentRes.json().catch(() => null);
      if (!intentRes.ok || !intentJson?.success) {
        throw new Error(intentJson?.message || t("orders.preorderBalance.failed"));
      }
      // The balance landed while this form was open (the webhook beat us).
      // That is a success, not the payment error it used to render as.
      if (intentJson.data?.alreadyPaid) {
        toast.success(t("orders.preorderBalance.success"));
        setOpen(false);
        onPaid();
        return;
      }

      const clientSecret = String(intentJson.data?.clientSecret || "");
      const paymentIntentId = String(intentJson.data?.paymentIntentId || "");
      if (!clientSecret || !paymentIntentId) {
        throw new Error(t("orders.preorderBalance.failed"));
      }

      // Read here rather than before the intent call: a remount during that
      // round trip leaves the earlier element destroyed, and Stripe refuses a
      // card it can no longer read. The intent is unconfirmed either way, so
      // nothing is charged.
      const cardNumber = cardNumberRef.current;
      if (!cardNumber) {
        throw new Error(t("orders.preorderBalance.failed"));
      }

      const confirm = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardNumber,
          billing_details: cardholder.trim() ? { name: cardholder.trim() } : undefined,
        },
      });
      if (confirm.error) {
        throw new Error(confirm.error.message || t("orders.preorderBalance.failed"));
      }
      const status = confirm.paymentIntent?.status;
      if (status !== "succeeded" && status !== "processing") {
        throw new Error(t("orders.preorderBalance.failed"));
      }

      // Record it now rather than waiting for the webhook; the call is
      // idempotent against it, so whichever lands first wins and the other
      // is a no-op.
      const confirmRes = await fetch(
        confirmUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentIntentId, accessToken }),
        },
      );
      const confirmJson = await confirmRes.json().catch(() => null);
      if (
        !confirmRes.ok ||
        !confirmJson?.success ||
        status === "processing" ||
        confirmJson.data?.pending
      ) {
        // The charge went through, or is still clearing; the webhook records
        // it either way. Held on the card until then, so nobody pays twice.
        setProcessing(true);
        setOpen(false);
        return;
      } else if (confirmJson.data?.settled === false) {
        // The money was captured and could not be recorded, so the server
        // refunded it and told the admins. Saying "paid" here would be a lie.
        throw new Error(t("orders.preorderBalance.reversed"));
      } else {
        toast.success(t("orders.preorderBalance.success"));
      }
      setOpen(false);
      onPaid();
    } catch (err) {
      setElementError(
        err instanceof Error ? err.message : t("orders.preorderBalance.failed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const hint = payingWholeOrder
    ? tf(
        "orders.payNow.hint",
        "This order has not been paid for yet. Pay below and we will get it on its way — nothing about the order changes.",
      )
    : order.preorderStatus === "payment_due"
      ? t("orders.preorderBalance.readyHint")
      : t("orders.preorderBalance.earlyHint");
  const title = payingWholeOrder
    ? tf("orders.payNow.title", "Payment due")
    : t("orders.preorderBalance.title");
  const dueLabel = payingWholeOrder
    ? tf("orders.payNow.amountDue", "Amount due")
    : t("orders.preorderBalance.balanceDue");

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="h-4 w-4" />
          {title}
        </CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm space-y-1">
          {/* Nothing has been paid on a "pay now" order, so a "paid so far: 0"
              line would only be a way of saying so twice. */}
          {payingWholeOrder ? null : (
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("orders.preorderBalance.paidSoFar")}
              </span>
              <span>{formatPrice(paidSoFar)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold">
            <span>{dueLabel}</span>
            <span>{formatPrice(balanceDue)}</span>
          </div>
          {/* The date the pre-order dies on if nothing arrives. The expiry job
              cancels and refunds after the store's grace period, and until this
              line the shopper was asked for money with no deadline attached to
              the request at all. */}
          {deadlineLabel ? (
            <p className="pt-1 text-xs text-muted-foreground">
              {tf(
                "orders.preorderBalance.deadline",
                "Pay by {date}, or we will cancel the pre-order and refund what you have paid.",
                { date: deadlineLabel },
              )}
            </p>
          ) : null}
          {/* The saved card is charged on or after the end of the notice the
              shopper was sent — the daily job may run later, never earlier. */}
          {autoChargeLabel && !payingWholeOrder ? (
            <p className="text-xs text-muted-foreground">
              {tf(
                "orders.preorderBalance.autoCharge",
                "As you authorised, we will charge your saved card on or after {date} unless you pay first.",
                { date: autoChargeLabel },
              )}
            </p>
          ) : null}
        </div>

        {processing ? (
          <div className="space-y-3">
            <Button disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {tf("orders.preorderBalance.processingButton", "Processing…")}
            </Button>
            <div
              role="status"
              className="flex gap-2 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2.5 text-sm text-foreground"
            >
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>
                {tf(
                  "orders.preorderBalance.processingNotice",
                  "Your bank is still confirming the {amount} payment. We'll email you as soon as it clears — there's no need to pay again.",
                  { amount: formatPrice(balanceDue) },
                )}
              </span>
            </div>
          </div>
        ) : cardEnabled === false && !paypalEnabled && !canResendPush ? (
          <p className="text-sm text-muted-foreground">
            {t("orders.preorderBalance.unavailable")}
          </p>
        ) : !open ? (
          <div className="flex flex-wrap gap-2">
            {cardEnabled !== false ? (
              <Button
                onClick={() => setOpen(true)}
                disabled={cardEnabled === null || redirectingToPayPal}
              >
                <CreditCard className="mr-2 h-4 w-4" />
                {payingWholeOrder
                  ? tf("orders.payNow.payButton", "Pay now")
                  : t("orders.preorderBalance.payButton")}
              </Button>
            ) : null}
            {canResendPush ? (
              <Button
                variant="outline"
                onClick={() => void resendPush()}
                disabled={resendingPush}
              >
                {resendingPush ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Smartphone className="mr-2 h-4 w-4" />
                )}
                {tf(
                  "orders.payNow.resendPush",
                  "Send the payment request to my phone again",
                )}
              </Button>
            ) : null}
            {paypalEnabled ? (
              <Button
                variant="outline"
                onClick={() => void payWithPayPal()}
                disabled={redirectingToPayPal}
              >
                {redirectingToPayPal ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {tf("orders.preorderBalance.payWithPayPal", "Pay with PayPal")}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div ref={setNumberEl} className={ELEMENT_BOX_CLASS} />
            <div className="grid grid-cols-2 gap-3">
              <div ref={setExpiryEl} className={ELEMENT_BOX_CLASS} />
              <div ref={setCvcEl} className={ELEMENT_BOX_CLASS} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="preorder-balance-cardholder">
                {t("payment.cardHolder")}
              </Label>
              <Input
                id="preorder-balance-cardholder"
                value={cardholder}
                onChange={(ev) => setCardholder(ev.target.value)}
                autoComplete="cc-name"
              />
            </div>
            {elementError ? (
              <p className="text-sm text-destructive">{elementError}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={handlePay} disabled={!elementsReady || submitting}>
                {submitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CreditCard className="mr-2 h-4 w-4" />
                )}
                {t("orders.preorderBalance.payAmount", {
                  amount: formatPrice(balanceDue),
                })}
              </Button>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
