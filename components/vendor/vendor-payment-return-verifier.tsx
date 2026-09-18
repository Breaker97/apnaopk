"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "@/components/ui/toast-notification";
import { RAZORPAY_RETURN_PARAM } from "@/lib/payments/razorpay-callback";

export function VendorPaymentReturnVerifier({ locale }: { locale: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paymentReturn = searchParams.get("vendor_payment");
  const sessionId = searchParams.get("session_id");
  const platformPaymentId = searchParams.get("platform_payment");
  const razorpayPaymentId = searchParams.get(RAZORPAY_RETURN_PARAM.paymentId);
  const razorpaySignature = searchParams.get(RAZORPAY_RETURN_PARAM.signature);

  useEffect(() => {
    if (paymentReturn !== "success" || (!sessionId && !platformPaymentId))
      return;
    let active = true;

    const verifyQuery = new URLSearchParams(
      sessionId
        ? { session_id: sessionId }
        : { platform_payment: platformPaymentId as string },
    );
    // A Razorpay return carries the signed payment; the route cannot ask
    // Razorpay about this attempt without it.
    if (!sessionId && razorpayPaymentId && razorpaySignature) {
      verifyQuery.set(RAZORPAY_RETURN_PARAM.paymentId, razorpayPaymentId);
      verifyQuery.set(RAZORPAY_RETURN_PARAM.signature, razorpaySignature);
    }
    fetch(`/api/vendor/applications/verify?${verifyQuery.toString()}`)
      .then(async (response) => ({
        ok: response.ok,
        body: await response.json().catch(() => null),
      }))
      .then(({ ok, body }) => {
        if (!active) return;
        if (ok && body?.data?.paymentStatus === "paid") {
          toast.success("Payment confirmed. Your vendor store is active.");
        } else {
          toast.error(
            body?.message ||
              "The payment was received, but synchronization is still pending.",
          );
        }
        router.replace(`/${locale}/vendor/dashboard`);
        router.refresh();
      })
      .catch(() => {
        if (active) {
          toast.error("Could not synchronize the payment yet.");
        }
      });

    return () => {
      active = false;
    };
  }, [
    locale,
    paymentReturn,
    platformPaymentId,
    razorpayPaymentId,
    razorpaySignature,
    router,
    sessionId,
  ]);

  return null;
}
