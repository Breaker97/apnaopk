"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "@/components/ui/toast-notification";

export function VendorPaymentReturnVerifier({ locale }: { locale: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paymentReturn = searchParams.get("vendor_payment");
  const sessionId = searchParams.get("session_id");
  const platformPaymentId = searchParams.get("platform_payment");

  useEffect(() => {
    if (paymentReturn !== "success" || (!sessionId && !platformPaymentId))
      return;
    let active = true;

    const verifyQuery = sessionId
      ? `session_id=${encodeURIComponent(sessionId)}`
      : `platform_payment=${encodeURIComponent(platformPaymentId as string)}`;
    fetch(`/api/vendor/applications/verify?${verifyQuery}`)
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
  }, [locale, paymentReturn, platformPaymentId, router, sessionId]);

  return null;
}
