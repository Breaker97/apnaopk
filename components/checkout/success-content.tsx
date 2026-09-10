"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Download,
  Loader2,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/toast-notification";
import { OrderDownloads } from "@/components/account/order-downloads";
import { useCart } from "@/hooks/use-cart";
import { useAuth } from "@/hooks/use-auth";
import { readGuestCheckoutEmail } from "@/lib/checkout/checkout-guest-contact";
import {
  analyticsPayloadFromOrder,
  clearCheckoutAnalyticsSnapshot,
  readCheckoutAnalyticsSnapshot,
  trackPurchase,
} from "@/lib/analytics/events";
import type { IOrder } from "@/types";

const PAYMENT_VERIFY_ATTEMPTS = 10;
const PAYMENT_VERIFY_DELAY_MS = 1500;
// ioTec mobile money waits on the payer entering a PIN prompt, which can take
// longer than a redirect flow — poll for longer before falling back to pending.
const IOTEC_VERIFY_ATTEMPTS = 30;
const IOTEC_VERIFY_DELAY_MS = 3000;
// Orange Money payers leave the site to validate with an OTP they generate over
// USSD, so give the same long window as ioTec's PIN prompt.
const ORANGE_MONEY_VERIFY_ATTEMPTS = 30;
const ORANGE_MONEY_VERIFY_DELAY_MS = 3000;
// MTN MoMo pushes a PIN prompt to the payer's phone. Finding the phone and
// typing the PIN takes minutes, and MTN's own request lives that long before
// expiring — so this polls the longest of any gateway (~160s).
const MTN_MOMO_VERIFY_ATTEMPTS = 40;
const MTN_MOMO_VERIFY_DELAY_MS = 4000;

// The user-facing MoMo failure codes, said in words the shopper can act on;
// anything unlisted falls back to the bare code.
const MTN_MOMO_FAILURE_MESSAGES: Record<string, string> = {
  APPROVAL_REJECTED: "The payment request was declined on your phone.",
  EXPIRED: "The payment request expired before it was approved.",
  NOT_ENOUGH_FUNDS: "The mobile money wallet does not have enough funds.",
  PAYER_NOT_FOUND: "That number is not a registered MTN MoMo account.",
  PAYER_LIMIT_REACHED: "This payment exceeds the wallet's transaction limit.",
};

type PaymentVerificationState =
  | "verifying"
  | "confirmed"
  | "pending"
  | "failed";

type PaymentVerificationData = {
  status?: string;
  orderCreated?: boolean;
  orderId?: string;
  orderNumber?: string;
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A throttled or briefly unavailable verify endpoint says nothing about the
 * payment itself — keep polling instead of telling the shopper it failed.
 */
function isTransientVerifyStatus(status: number) {
  return status === 429 || status >= 500;
}

function isFinalPaymentIntentStatus(status: string) {
  return status === "succeeded";
}

function isPendingPaymentIntentStatus(status: string) {
  return status === "processing" || status === "requires_capture";
}

function isFailedPaymentIntentStatus(status: string) {
  return (
    status === "canceled" ||
    status === "requires_payment_method" ||
    status === "requires_action" ||
    status === "requires_confirmation"
  );
}

function isFinalCheckoutSessionStatus(status: string) {
  return status === "paid" || status === "no_payment_required";
}

function isFailedCheckoutSessionStatus(status: string) {
  return status === "unpaid";
}

export function CheckoutSuccessContent() {
  const t = useTranslations();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = params.locale as string;
  const { clearCart } = useCart();
  const { isAuthenticated } = useAuth();

  const sessionId = searchParams.get("session_id");
  const orderNumber = searchParams.get("order");
  const paymentIntentId = searchParams.get("payment_intent");
  const paypalOrderId = searchParams.get("paypal_order_id") || searchParams.get("token");
  const paystackReference =
    searchParams.get("paystack_reference") ||
    searchParams.get("reference") ||
    searchParams.get("trxref");
  const pesapalOrderTrackingId =
    searchParams.get("OrderTrackingId") ||
    searchParams.get("orderTrackingId");
  const pesapalMerchantReference =
    searchParams.get("OrderMerchantReference") ||
    searchParams.get("pesapal_reference");
  const iotecTransactionId = searchParams.get("iotec_transaction_id");
  const iotecExternalId = searchParams.get("iotec_external_id");
  const orangeMoneyOrderId = searchParams.get("orange_money_order_id");
  const mtnMomoReferenceId = searchParams.get("mtn_momo_reference_id");
  const needsPaymentVerification =
    !!sessionId ||
    !!paypalOrderId ||
    !!paymentIntentId ||
    !!paystackReference ||
    !!pesapalOrderTrackingId ||
    !!pesapalMerchantReference ||
    !!iotecTransactionId ||
    !!iotecExternalId ||
    !!orangeMoneyOrderId ||
    !!mtnMomoReferenceId;

  const [verificationState, setVerificationState] =
    useState<PaymentVerificationState>(
      needsPaymentVerification ? "verifying" : "confirmed",
    );
  const [verificationMessage, setVerificationMessage] = useState<string | null>(
    null,
  );
  const [verifiedOrder, setVerifiedOrder] = useState<string | null>(
    orderNumber,
  );
  const [orderId, setOrderId] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (verificationState !== "confirmed") return;

    const transactionId = orderId || verifiedOrder;
    if (!transactionId) return;

    let active = true;

    async function trackConfirmedPurchase() {
      const snapshot = readCheckoutAnalyticsSnapshot();

      if (orderId) {
        try {
          const res = await fetch(`/api/orders/${orderId}`);
          const json = await res.json().catch(() => null);
          if (active && res.ok && json?.success && json.data) {
            const order = json.data as Partial<IOrder>;
            trackPurchase({
              ...analyticsPayloadFromOrder(order),
              orderId: order.orderNumber || verifiedOrder || orderId,
              currency: snapshot?.currency,
            });
            clearCheckoutAnalyticsSnapshot();
            return;
          }
        } catch {
          // Fall through to the checkout snapshot below.
        }
      }

      if (!active) return;

      trackPurchase({
        ...(snapshot || { currency: "USD", value: 0, items: [] }),
        orderId: verifiedOrder || orderId || String(transactionId),
      });
      clearCheckoutAnalyticsSnapshot();
    }

    void trackConfirmedPurchase();

    return () => {
      active = false;
    };
  }, [orderId, verificationState, verifiedOrder]);

  useEffect(() => {
    async function verifyStripePayment() {
      if (!sessionId && !paymentIntentId) return;

      const isPaymentIntent = Boolean(paymentIntentId);
      const query = isPaymentIntent
        ? `payment_intent_id=${encodeURIComponent(paymentIntentId as string)}`
        : `session_id=${encodeURIComponent(sessionId as string)}`;

      try {
        for (let attempt = 0; attempt < PAYMENT_VERIFY_ATTEMPTS; attempt++) {
          if (cancelled) return;

          const res = await fetch(`/api/payments/verify?${query}`);
          const data = await res.json().catch(() => null);

          if (!res.ok || !data?.success) {
            throw new Error(
              data?.message || data?.error || "Payment verification failed",
            );
          }

          const details = (data.data || {}) as PaymentVerificationData;
          const status = String(details.status || "").toLowerCase();
          const isFinalPayment = isPaymentIntent
            ? isFinalPaymentIntentStatus(status)
            : isFinalCheckoutSessionStatus(status);
          const isPendingPayment = isPaymentIntent
            ? isPendingPaymentIntentStatus(status)
            : !isFailedCheckoutSessionStatus(status);
          const isFailedPayment = isPaymentIntent
            ? isFailedPaymentIntentStatus(status)
            : isFailedCheckoutSessionStatus(status);

          if (details.orderCreated && details.orderNumber) {
            setVerifiedOrder(details.orderNumber);
            if (details.orderId) setOrderId(details.orderId);
            await clearCart();
            if (!cancelled) {
              setVerificationMessage(null);
              setVerificationState("confirmed");
            }
            return;
          }

          if (isFailedPayment) {
            throw new Error("Payment was not completed");
          }

          if (attempt < PAYMENT_VERIFY_ATTEMPTS - 1) {
            await wait(PAYMENT_VERIFY_DELAY_MS);
            continue;
          }

          if (isFinalPayment || isPendingPayment) {
            setVerificationMessage(
              isFinalPayment
                ? "Stripe confirmed the payment, but the order is still being finalized. Refresh this page in a moment or check My Orders."
                : "Stripe is still processing the payment. We'll confirm the order once processing is complete.",
            );
            setVerificationState("pending");
            return;
          }
        }
      } catch (error) {
        console.error("Failed to verify Stripe payment:", error);
        if (!cancelled) {
          setVerificationMessage(
            error instanceof Error
              ? error.message
              : "Payment verification failed",
          );
          setVerificationState("failed");
        }
      }
    }

    let cancelled = false;
    verifyStripePayment();

    return () => {
      cancelled = true;
    };
  }, [sessionId, paymentIntentId, clearCart]);

  useEffect(() => {
    async function capturePayPal() {
      if (!paypalOrderId) return;

      try {
        const res = await fetch("/api/payments/paypal/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: paypalOrderId }),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.success && data.data?.orderNumber) {
          setVerifiedOrder(data.data.orderNumber);
          if (data.data.orderId) {
            setOrderId(data.data.orderId);
          }
          await clearCart();
          setVerificationMessage(null);
          setVerificationState("confirmed");
          return;
        }

        throw new Error(
          data?.message || data?.error || "PayPal payment capture failed",
        );
      } catch (error) {
        console.error("Failed to capture PayPal order:", error);
        setVerificationMessage(
          error instanceof Error ? error.message : "PayPal payment capture failed",
        );
        setVerificationState("failed");
      }
    }

    capturePayPal();
  }, [paypalOrderId, clearCart]);

  useEffect(() => {
    async function verifyPaystack() {
      if (!paystackReference) return;

      try {
        const res = await fetch("/api/payments/paystack/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference: paystackReference }),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.success && data.data?.orderNumber) {
          setVerifiedOrder(data.data.orderNumber);
          if (data.data.orderId) {
            setOrderId(data.data.orderId);
          }
          await clearCart();
          setVerificationMessage(null);
          setVerificationState("confirmed");
          return;
        }

        throw new Error(
          data?.message || data?.error || "Paystack payment verification failed",
        );
      } catch (error) {
        console.error("Failed to verify Paystack transaction:", error);
        setVerificationMessage(
          error instanceof Error
            ? error.message
            : "Paystack payment verification failed",
        );
        setVerificationState("failed");
      }
    }

    verifyPaystack();
  }, [paystackReference, clearCart]);

  useEffect(() => {
    async function verifyPesapal() {
      // Pesapal appends OrderTrackingId to the callback, but our own callback
      // URL carries only the merchant reference — either one must verify.
      if (!pesapalOrderTrackingId && !pesapalMerchantReference) return;

      try {
        for (let attempt = 0; attempt < PAYMENT_VERIFY_ATTEMPTS; attempt++) {
          if (cancelled) return;

          const res = await fetch("/api/payments/pesapal/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orderTrackingId: pesapalOrderTrackingId || undefined,
              merchantReference: pesapalMerchantReference || undefined,
            }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok && isTransientVerifyStatus(res.status)) {
            if (attempt < PAYMENT_VERIFY_ATTEMPTS - 1) {
              await wait(PAYMENT_VERIFY_DELAY_MS);
              continue;
            }
            if (!cancelled) {
              setVerificationMessage(
                "Pesapal is still processing the payment. We'll confirm the order when the payment status changes.",
              );
              setVerificationState("pending");
            }
            return;
          }
          if (!res.ok || !data?.success) {
            throw new Error(
              data?.message || data?.error || "Pesapal payment verification failed",
            );
          }

          const status = String(data.data?.status || "").toLowerCase();
          if (status === "completed" && data.data?.orderNumber) {
            setVerifiedOrder(data.data.orderNumber);
            if (data.data.orderId) setOrderId(data.data.orderId);
            await clearCart();
            if (!cancelled) {
              setVerificationMessage(null);
              setVerificationState("confirmed");
            }
            return;
          }

          if (["failed", "reversed", "invalid"].includes(status)) {
            throw new Error(`Pesapal payment status: ${status}`);
          }

          if (attempt < PAYMENT_VERIFY_ATTEMPTS - 1) {
            await wait(PAYMENT_VERIFY_DELAY_MS);
            continue;
          }

          if (!cancelled) {
            setVerificationMessage(
              "Pesapal is still processing the payment. We'll confirm the order when the payment status changes.",
            );
            setVerificationState("pending");
          }
        }
      } catch (error) {
        console.error("Failed to verify Pesapal transaction:", error);
        if (!cancelled) {
          setVerificationMessage(
            error instanceof Error
              ? error.message
              : "Pesapal payment verification failed",
          );
          setVerificationState("failed");
        }
      }
    }

    let cancelled = false;
    void verifyPesapal();

    return () => {
      cancelled = true;
    };
  }, [pesapalOrderTrackingId, pesapalMerchantReference, clearCart]);

  useEffect(() => {
    async function verifyIotec() {
      // Mobile money lands here with the transaction id; card payments come
      // back from ioTec's hosted page with only the external reference.
      if (!iotecTransactionId && !iotecExternalId) return;

      try {
        for (let attempt = 0; attempt < IOTEC_VERIFY_ATTEMPTS; attempt++) {
          if (cancelled) return;

          const res = await fetch("/api/payments/iotec/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transactionId: iotecTransactionId || undefined,
              externalId: iotecExternalId || undefined,
            }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok && isTransientVerifyStatus(res.status)) {
            if (attempt < IOTEC_VERIFY_ATTEMPTS - 1) {
              await wait(IOTEC_VERIFY_DELAY_MS);
              continue;
            }
            if (!cancelled) {
              setVerificationMessage(
                "We're still waiting for your payment confirmation. We'll confirm the order as soon as the payment goes through.",
              );
              setVerificationState("pending");
            }
            return;
          }
          if (!res.ok || !data?.success) {
            throw new Error(
              data?.message || data?.error || "ioTec payment verification failed",
            );
          }

          const status = String(data.data?.status || "").toLowerCase();
          if (status === "completed" && data.data?.orderNumber) {
            setVerifiedOrder(data.data.orderNumber);
            if (data.data.orderId) setOrderId(data.data.orderId);
            await clearCart();
            if (!cancelled) {
              setVerificationMessage(null);
              setVerificationState("confirmed");
            }
            return;
          }

          if (["failed", "invalid"].includes(status)) {
            throw new Error(`ioTec payment status: ${status}`);
          }

          if (attempt < IOTEC_VERIFY_ATTEMPTS - 1) {
            await wait(IOTEC_VERIFY_DELAY_MS);
            continue;
          }

          if (!cancelled) {
            setVerificationMessage(
              "We're still waiting for your payment confirmation. We'll confirm the order as soon as the payment goes through.",
            );
            setVerificationState("pending");
          }
        }
      } catch (error) {
        console.error("Failed to verify ioTec transaction:", error);
        if (!cancelled) {
          setVerificationMessage(
            error instanceof Error
              ? error.message
              : "ioTec payment verification failed",
          );
          setVerificationState("failed");
        }
      }
    }

    let cancelled = false;
    void verifyIotec();

    return () => {
      cancelled = true;
    };
  }, [iotecTransactionId, iotecExternalId, clearCart]);

  useEffect(() => {
    async function verifyOrangeMoney() {
      if (!orangeMoneyOrderId) return;

      try {
        for (
          let attempt = 0;
          attempt < ORANGE_MONEY_VERIFY_ATTEMPTS;
          attempt++
        ) {
          if (cancelled) return;

          const res = await fetch("/api/payments/orange-money/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: orangeMoneyOrderId }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok && isTransientVerifyStatus(res.status)) {
            if (attempt < ORANGE_MONEY_VERIFY_ATTEMPTS - 1) {
              await wait(ORANGE_MONEY_VERIFY_DELAY_MS);
              continue;
            }
            if (!cancelled) {
              setVerificationMessage(
                "We're still waiting for your payment confirmation. We'll confirm the order as soon as the payment goes through.",
              );
              setVerificationState("pending");
            }
            return;
          }
          if (!res.ok || !data?.success) {
            throw new Error(
              data?.message ||
                data?.error ||
                "Orange Money payment verification failed",
            );
          }

          const status = String(data.data?.status || "").toLowerCase();
          if (status === "completed" && data.data?.orderNumber) {
            setVerifiedOrder(data.data.orderNumber);
            if (data.data.orderId) setOrderId(data.data.orderId);
            await clearCart();
            if (!cancelled) {
              setVerificationMessage(null);
              setVerificationState("confirmed");
            }
            return;
          }

          if (["failed", "invalid"].includes(status)) {
            throw new Error(`Orange Money payment status: ${status}`);
          }

          if (attempt < ORANGE_MONEY_VERIFY_ATTEMPTS - 1) {
            await wait(ORANGE_MONEY_VERIFY_DELAY_MS);
            continue;
          }

          if (!cancelled) {
            setVerificationMessage(
              "We're still waiting for your payment confirmation. We'll confirm the order as soon as the payment goes through.",
            );
            setVerificationState("pending");
          }
        }
      } catch (error) {
        console.error("Failed to verify Orange Money transaction:", error);
        if (!cancelled) {
          setVerificationMessage(
            error instanceof Error
              ? error.message
              : "Orange Money payment verification failed",
          );
          setVerificationState("failed");
        }
      }
    }

    let cancelled = false;
    void verifyOrangeMoney();

    return () => {
      cancelled = true;
    };
  }, [orangeMoneyOrderId, clearCart]);

  useEffect(() => {
    async function verifyMtnMomo() {
      if (!mtnMomoReferenceId) return;

      try {
        for (let attempt = 0; attempt < MTN_MOMO_VERIFY_ATTEMPTS; attempt++) {
          if (cancelled) return;

          const res = await fetch("/api/payments/mtn-momo/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ referenceId: mtnMomoReferenceId }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok && isTransientVerifyStatus(res.status)) {
            if (attempt < MTN_MOMO_VERIFY_ATTEMPTS - 1) {
              await wait(MTN_MOMO_VERIFY_DELAY_MS);
              continue;
            }
            if (!cancelled) {
              setVerificationMessage(
                "We're still waiting for your payment confirmation. We'll confirm the order as soon as the payment goes through.",
              );
              setVerificationState("pending");
            }
            return;
          }
          if (!res.ok || !data?.success) {
            throw new Error(
              data?.message ||
                data?.error ||
                "MTN MoMo payment verification failed",
            );
          }

          const status = String(data.data?.status || "").toLowerCase();
          if (status === "completed" && data.data?.orderNumber) {
            setVerifiedOrder(data.data.orderNumber);
            if (data.data.orderId) setOrderId(data.data.orderId);
            await clearCart();
            if (!cancelled) {
              setVerificationMessage(null);
              setVerificationState("confirmed");
            }
            return;
          }

          if (status === "failed") {
            const reason = String(data.data?.reason || "").toUpperCase();
            throw new Error(
              MTN_MOMO_FAILURE_MESSAGES[reason] ||
                (reason
                  ? `MTN MoMo payment failed: ${reason}`
                  : "MTN MoMo payment failed"),
            );
          }

          if (attempt < MTN_MOMO_VERIFY_ATTEMPTS - 1) {
            await wait(MTN_MOMO_VERIFY_DELAY_MS);
            continue;
          }

          if (!cancelled) {
            setVerificationMessage(
              "We're still waiting for your payment confirmation. We'll confirm the order as soon as the payment goes through.",
            );
            setVerificationState("pending");
          }
        }
      } catch (error) {
        console.error("Failed to verify MTN MoMo transaction:", error);
        if (!cancelled) {
          setVerificationMessage(
            error instanceof Error
              ? error.message
              : "MTN MoMo payment verification failed",
          );
          setVerificationState("failed");
        }
      }
    }

    let cancelled = false;
    void verifyMtnMomo();

    return () => {
      cancelled = true;
    };
  }, [mtnMomoReferenceId, clearCart]);

  const handleDownloadInvoice = async () => {
    const invoiceId = orderId || verifiedOrder;
    if (!invoiceId) return;

    setIsDownloading(true);
    try {
      // The session-authenticated route only serves the signed-in shopper
      // their own order, so a guest goes through the public tracking endpoint
      // instead, proving ownership with the order number plus the email the
      // checkout stashed for this tab before redirecting to payment. When the
      // stash is missing — or the auth state simply hasn't resolved yet — the
      // session route is still the right attempt: the cookie, if any, rides
      // along regardless of what the client-side auth hook has loaded.
      const guestEmail = isAuthenticated ? null : readGuestCheckoutEmail();
      const res =
        !isAuthenticated && guestEmail && verifiedOrder
          ? await fetch("/api/orders/track/invoice", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                orderNumber: verifiedOrder,
                identifier: guestEmail,
              }),
            })
          : await fetch(`/api/orders/${invoiceId}/invoice`);
      if (!res.ok) throw new Error("Failed to download invoice");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${verifiedOrder || invoiceId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      // Both routes only serve the shopper their own order, so a stale
      // session, a cleared guest-email stash (new tab, tab closed) or someone
      // else's order number lands here. Without a toast the click looked like
      // a no-op.
      console.error("Failed to download invoice:", error);
      toast.error(t("orders.invoiceDownloadFailed"));
    } finally {
      setIsDownloading(false);
    }
  };

  if (verificationState === "verifying") {
    return (
      <div className="container mx-auto px-4 py-16">
        <Card className="max-w-lg mx-auto text-center">
          <CardContent className="pt-8 pb-8">
            <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin mb-4" />
            <h1 className="text-xl font-bold mb-2">
              {t("checkout.verifyingPayment")}
            </h1>
            <p className="text-muted-foreground">
              {t("checkout.pleaseWait")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (verificationState === "pending") {
    return (
      <div className="container mx-auto px-4 py-16">
        <Card className="max-w-lg mx-auto text-center">
          <CardContent className="pt-8 pb-8">
            <Clock3 className="h-16 w-16 mx-auto text-primary mb-4" />
            <h1 className="text-xl font-bold mb-2">
              Payment confirmation pending
            </h1>
            <p className="text-muted-foreground mb-6">
              {verificationMessage ||
                "We're still confirming your order. Please check back shortly."}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild>
                <Link href={`/${locale}/account/orders`}>
                  {t("orders.viewOrders")}
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/${locale}/products`}>
                  {t("cart.continueShopping")}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (verificationState === "failed") {
    return (
      <div className="container mx-auto px-4 py-16">
        <Card className="max-w-lg mx-auto text-center">
          <CardContent className="pt-8 pb-8">
            <CircleAlert className="h-16 w-16 mx-auto text-destructive mb-4" />
            <h1 className="text-xl font-bold mb-2">
              Payment could not be confirmed
            </h1>
            <p className="text-muted-foreground mb-6">
              {verificationMessage ||
                "We could not confirm this payment. Please try again."}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild>
                <Link href={`/${locale}/checkout`}>
                  {t("common.tryAgain")}
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/${locale}/products`}>
                  {t("cart.continueShopping")}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-16">
      <Card className="max-w-lg mx-auto text-center">
        <CardContent className="pt-8 pb-8">
          <div className="mb-6">
            <CheckCircle2 className="h-20 w-20 mx-auto text-green-500" />
          </div>

          <h1 className="text-2xl font-bold mb-2">
            {t("checkout.orderSuccess")}
          </h1>
          <p className="text-muted-foreground mb-6">
            {t("checkout.orderSuccessDescription")}
          </p>

          {verifiedOrder && (
            <div className="bg-muted/50 rounded-lg p-4 mb-6">
              <div className="flex items-center justify-center gap-2 text-sm">
                <Package className="h-4 w-4" />
                <span>
                  {t("checkout.orderNumber")}
                  : <strong>{verifiedOrder}</strong>
                </span>
              </div>
            </div>
          )}

          {(orderId || verifiedOrder) && (
            <Button
              variant="outline"
              className="mb-4 w-full sm:w-auto"
              onClick={handleDownloadInvoice}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {t("checkout.downloadInvoice")}
            </Button>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild>
              <Link href={`/${locale}/account/orders`}>
                {t("orders.viewOrders")}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/${locale}/products`}>
                {t("cart.continueShopping")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Digital files bought with this order — downloadable right away.
          Renders nothing for orders without digital items. */}
      {(orderId || verifiedOrder) && (
        <div className="max-w-lg mx-auto mt-6 text-left">
          <OrderDownloads orderId={orderId || verifiedOrder!} />
        </div>
      )}
    </div>
  );
}
