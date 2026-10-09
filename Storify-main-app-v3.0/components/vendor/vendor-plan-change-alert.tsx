"use client";

import { useState } from "react";
import { ArrowUpCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";

export function VendorPlanChangeAlert({
  locale,
  planName,
  status,
}: {
  locale: string;
  planName?: string | null;
  status: "awaiting_vendor" | "awaiting_payment";
}) {
  const [loading, setLoading] = useState(false);

  async function act() {
    setLoading(true);
    try {
      const endpoint =
        status === "awaiting_vendor"
          ? "/api/vendor/subscription/change/confirm"
          : "/api/vendor/subscription/portal";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:
          status === "awaiting_vendor"
            ? undefined
            : JSON.stringify({ locale }),
      });
      const body = await response.json().catch(() => null);
      const url =
        body?.data?.paymentUrl ||
        body?.data?.url;
      if (!response.ok) {
        toast.error(body?.message || "Could not continue the plan change");
        return;
      }
      if (url) {
        window.location.assign(url);
        return;
      }
      toast.success(
        body?.data?.status === "applied"
          ? "Upgrade activated"
          : "Upgrade confirmed; Stripe is processing payment",
      );
      window.location.reload();
    } catch {
      toast.error("Could not continue the plan change");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Alert>
      <ArrowUpCircle className="h-4 w-4" />
      <AlertTitle>Paid plan upgrade</AlertTitle>
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>
          {status === "awaiting_vendor"
            ? `Confirm the${planName ? ` ${planName}` : ""} upgrade. Your current plan remains active until Stripe confirms payment.`
            : "The upgrade payment is pending. Complete or review it in Stripe billing."}
        </span>
        <Button
          type="button"
          size="sm"
          onClick={act}
          disabled={loading}
          className="shrink-0"
        >
          {loading
            ? "Opening..."
            : status === "awaiting_vendor"
              ? "Confirm upgrade"
              : "Review payment"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
