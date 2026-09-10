"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { loadRazorpayCheckoutScript } from "@/components/checkout/checkout-helpers";
import {
  PaymentMethodPicker,
  type PlatformGateway,
} from "@/components/vendor/payment-method-picker";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface InitiationResponse {
  paymentId: string;
  provider: PlatformGateway;
  type: "redirect" | "razorpay" | "polling";
  url?: string;
  keyId?: string;
  razorpayOrderId?: string;
  amount?: number;
  currency?: string;
  name?: string;
  description?: string;
  prefill?: { email?: string; name?: string; contact?: string };
}

const POLL_INTERVAL_MS = 4000;
const POLL_MAX_ATTEMPTS = 45;

/**
 * Subscription payment launcher, shared by the application payment gate,
 * the payment-required alert, and the renew flow. Loads the effective
 * gateway list, initiates through the given endpoint, and handles the three
 * response shapes (redirect / Razorpay modal / ioTec polling).
 *
 * Stripe keeps its native subscription Checkout — picking it simply POSTs
 * the endpoint without a paymentMethod override, preserving the old flow.
 */
export function SubscriptionPaymentDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: string;
  /** POST target: applications/checkout (initial) or subscription/renew. */
  endpoint: string;
  /** Renewals never offer Stripe (Stripe rows renew themselves). */
  excludeStripe?: boolean;
  /** Extra fields merged into the POST body — e.g. `switchFromStripe`. */
  body?: Record<string, unknown>;
  title: string;
  description?: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const label = useFallbackTranslator(t);

  const [methods, setMethods] = useState<PlatformGateway[] | null>(null);
  const [method, setMethod] = useState<PlatformGateway | null>(null);
  const [iotecChannel, setIotecChannel] = useState<"mobile_money" | "card">(
    "mobile_money",
  );
  const [iotecPhone, setIotecPhone] = useState("");
  const [mtnMomoPhone, setMtnMomoPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);

  useApplyOnChange([props.open], () => {
    if (!props.open) return;
    setMethod(null);
    setIsPolling(false);
    setIsSubmitting(false);
  });

  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    apiClient
      .get<{ paymentMethods: PlatformGateway[] }>(
        "/api/vendor/subscription/payment-methods",
      )
      .then((data) => {
        if (cancelled) return;
        const available = props.excludeStripe
          ? data.paymentMethods.filter((m) => m !== "stripe")
          : data.paymentMethods;
        setMethods(available);
        if (available.length === 1) setMethod(available[0]);
      })
      .catch(() => {
        if (!cancelled) setMethods([]);
      });
    return () => {
      cancelled = true;
    };
  }, [props.open, props.excludeStripe]);

  const pollVerify = useCallback(
    async (paymentId: string) => {
      setIsPolling(true);
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        try {
          const res = await fetch(
            `/api/vendor/applications/verify?platform_payment=${encodeURIComponent(paymentId)}`,
          );
          const json = await res.json().catch(() => null);
          if (json?.data?.paid) {
            setIsPolling(false);
            toast.success(
              label(
                "vendor.billing.paymentConfirmed",
                "Payment confirmed. Your plan is active.",
              ),
            );
            props.onOpenChange(false);
            router.refresh();
            return;
          }
        } catch {
          // Transient poll errors are expected while the payer approves.
        }
      }
      setIsPolling(false);
      toast.error(
        label(
          "vendor.billing.pollTimeout",
          "We could not confirm the payment yet. Your plan activates automatically once it is confirmed.",
        ),
      );
      props.onOpenChange(false);
      router.refresh();
    },
    [label, props, router],
  );

  const handlePay = useCallback(async () => {
    if (!method) return;
    setIsSubmitting(true);
    try {
      const response = await apiClient.post<InitiationResponse | { url?: string }>(
        props.endpoint,
        {
          locale: props.locale,
          paymentMethod: method,
          ...props.body,
          ...(method === "iotec"
            ? { iotecChannel, iotecPhone: iotecPhone || undefined }
            : {}),
          ...(method === "mtn_momo"
            ? { mtnMomoPhone: mtnMomoPhone || undefined }
            : {}),
        },
      );

      // Stripe's native flow (and every redirect gateway) hands back a URL.
      if ("url" in response && response.url) {
        window.location.assign(response.url);
        return;
      }

      const initiation = response as InitiationResponse;
      if (initiation.type === "razorpay" && initiation.razorpayOrderId) {
        await loadRazorpayCheckoutScript();
        const Razorpay = (
          window as unknown as {
            Razorpay?: new (options: Record<string, unknown>) => {
              open: () => void;
              on: (event: string, cb: (r: unknown) => void) => void;
            };
          }
        ).Razorpay;
        if (!Razorpay) throw new Error("Razorpay checkout is unavailable");
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const razorpay = new Razorpay({
            key: initiation.keyId,
            amount: initiation.amount,
            currency: initiation.currency,
            name: initiation.name,
            description: initiation.description,
            order_id: initiation.razorpayOrderId,
            prefill: initiation.prefill,
            handler: async (result: unknown) => {
              settled = true;
              try {
                const payload = result as {
                  razorpay_payment_id: string;
                  razorpay_signature: string;
                };
                await fetch("/api/payments/razorpay/verify", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    razorpay_order_id: initiation.razorpayOrderId,
                    razorpay_payment_id: payload.razorpay_payment_id,
                    razorpay_signature: payload.razorpay_signature,
                  }),
                });
                resolve();
              } catch (error) {
                reject(error);
              }
            },
            modal: {
              ondismiss: () => {
                if (!settled) {
                  reject(
                    new Error(
                      label(
                        "vendor.billing.paymentCanceled",
                        "Payment was canceled. Please try again.",
                      ),
                    ),
                  );
                }
              },
            },
          });
          razorpay.on("payment.failed", (result: unknown) => {
            settled = true;
            const failure = result as {
              error?: { description?: string; reason?: string };
            };
            reject(
              new Error(
                failure.error?.description ||
                  failure.error?.reason ||
                  "Razorpay payment failed",
              ),
            );
          });
          razorpay.open();
        });
        toast.success(
          label(
            "vendor.billing.paymentConfirmed",
            "Payment confirmed. Your plan is active.",
          ),
        );
        props.onOpenChange(false);
        router.refresh();
        return;
      }

      if (initiation.type === "polling") {
        toast.info(
          label(
            "vendor.billing.checkPhone",
            "Check your phone and approve the payment request.",
          ),
        );
        await pollVerify(initiation.paymentId);
        return;
      }

      throw new Error(
        label("vendor.billing.paymentFailed", "Failed to start the payment"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : label("vendor.billing.paymentFailed", "Failed to start the payment"),
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [method, props, iotecChannel, iotecPhone, mtnMomoPhone, label, pollVerify, router]);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (isPolling || isSubmitting) return;
        props.onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            {props.title}
          </DialogTitle>
          {props.description ? (
            <DialogDescription>{props.description}</DialogDescription>
          ) : null}
        </DialogHeader>

        {isPolling ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {label(
                "vendor.billing.checkPhone",
                "Check your phone and approve the payment request.",
              )}
            </p>
          </div>
        ) : methods === null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            <PaymentMethodPicker
              methods={methods}
              value={method}
              onChange={setMethod}
              iotecChannel={iotecChannel}
              onIotecChannelChange={setIotecChannel}
              iotecPhone={iotecPhone}
              onIotecPhoneChange={setIotecPhone}
              mtnMomoPhone={mtnMomoPhone}
              onMtnMomoPhoneChange={setMtnMomoPhone}
            />
            <div className="flex justify-end pt-2">
              <Button
                disabled={
                  !method ||
                  isSubmitting ||
                  (method === "iotec" &&
                    iotecChannel === "mobile_money" &&
                    !iotecPhone.trim()) ||
                  (method === "mtn_momo" && !mtnMomoPhone.trim())
                }
                onClick={handlePay}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {label("vendor.billing.payNow", "Continue to payment")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
