"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { loadStripe, type Stripe, type StripeCardNumberElement } from "@stripe/stripe-js";
import { CreditCard, Loader2 } from "lucide-react";
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
 * The shopper's side of a deposit-mode pre-order: what they have paid, what is
 * still owed, and — the part that did not exist before — a way to pay it.
 *
 * Checkout takes the deposit and the "payment due" notification asks for the
 * rest, so this card is where that request lands. It charges exactly the
 * balance through the same inline card form checkout uses; the order record is
 * updated by the confirm call (and, independently, by the Stripe webhook).
 */

interface PreorderBalanceOrder {
  _id: string;
  status: string;
  paymentStatus: string;
  hasPreorder?: boolean;
  preorderStatus?: string;
  preorderPaymentMode?: string;
  preorderOutstandingAmount?: number;
  total: number;
}

const ELEMENT_BOX_CLASS =
  "rounded-md border border-input bg-background px-3 py-2.5 focus-within:ring-2 focus-within:ring-ring";

export function PreorderBalanceCard({
  order,
  locale,
  onPaid,
}: {
  order: PreorderBalanceOrder;
  locale: string;
  onPaid: () => void;
}) {
  const t = useTranslations();
  const { formatPrice } = useCurrency();
  const { isDark } = useAppTheme();
  const elementStyle = useMemo(() => createStripeElementStyle(isDark), [isDark]);

  const balanceDue = getPreorderBalanceDue(order);
  const paidSoFar = Math.max(0, Number(order.total || 0) - balanceDue);

  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [cardEnabled, setCardEnabled] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [cardholder, setCardholder] = useState("");
  const [elementError, setElementError] = useState<string | null>(null);
  const [elementsReady, setElementsReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const stripeRef = useRef<Stripe | null>(null);
  const cardNumberRef = useRef<StripeCardNumberElement | null>(null);
  const [numberEl, setNumberEl] = useState<HTMLDivElement | null>(null);
  const [expiryEl, setExpiryEl] = useState<HTMLDivElement | null>(null);
  const [cvcEl, setCvcEl] = useState<HTMLDivElement | null>(null);

  const showCard = Boolean(order.hasPreorder) && balanceDue > 0;

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
      })
      .catch(() => {
        if (active) setCardEnabled(false);
      });
    return () => {
      active = false;
    };
  }, [showCard]);

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
        const elements = stripe.elements();
        const cardNumber = elements.create("cardNumber", {
          style: elementStyle,
          showIcon: false,
          placeholder: t("payment.cardNumber"),
        });
        const cardExpiry = elements.create("cardExpiry", {
          style: elementStyle,
          placeholder: t("payment.expiryDate"),
        });
        const cardCvc = elements.create("cardCvc", {
          style: elementStyle,
          placeholder: t("payment.cvv"),
        });
        cardNumber.on("change", (ev) => setElementError(ev.error?.message || null));
        cardExpiry.on("change", (ev) => setElementError(ev.error?.message || null));
        cardCvc.on("change", (ev) => setElementError(ev.error?.message || null));
        cardNumber.mount(numberEl);
        cardExpiry.mount(expiryEl);
        cardCvc.mount(cvcEl);
        cardNumberRef.current = cardNumber;
        cleanup = () => {
          cardNumber.destroy();
          cardExpiry.destroy();
          cardCvc.destroy();
          cardNumberRef.current = null;
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
  }, [open, publishableKey, numberEl, expiryEl, cvcEl, elementStyle, t]);

  if (!showCard) return null;

  const handlePay = async () => {
    const stripe = stripeRef.current;
    const cardNumber = cardNumberRef.current;
    if (!stripe || !cardNumber || !elementsReady) return;
    setSubmitting(true);
    setElementError(null);
    try {
      const intentRes = await fetch(`/api/orders/${order._id}/preorder-balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
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
        `/api/orders/${order._id}/preorder-balance/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentIntentId }),
        },
      );
      const confirmJson = await confirmRes.json().catch(() => null);
      if (!confirmRes.ok || !confirmJson?.success) {
        // The charge went through; the webhook will still record it.
        toast.success(t("orders.preorderBalance.processing"));
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

  const hint =
    order.preorderStatus === "payment_due"
      ? t("orders.preorderBalance.readyHint")
      : t("orders.preorderBalance.earlyHint");

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="h-4 w-4" />
          {t("orders.preorderBalance.title")}
        </CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {t("orders.preorderBalance.paidSoFar")}
            </span>
            <span>{formatPrice(paidSoFar)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>{t("orders.preorderBalance.balanceDue")}</span>
            <span>{formatPrice(balanceDue)}</span>
          </div>
        </div>

        {cardEnabled === false ? (
          <p className="text-sm text-muted-foreground">
            {t("orders.preorderBalance.unavailable")}
          </p>
        ) : !open ? (
          <Button onClick={() => setOpen(true)} disabled={cardEnabled === null}>
            <CreditCard className="mr-2 h-4 w-4" />
            {t("orders.preorderBalance.payButton")}
          </Button>
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
