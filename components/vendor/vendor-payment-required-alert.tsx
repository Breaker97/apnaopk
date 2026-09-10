"use client";

import { useState } from "react";
import { CreditCard } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SubscriptionPaymentDialog } from "@/components/vendor/subscription-payment-dialog";

export function VendorPaymentRequiredAlert({
  locale,
  paymentDueAt,
}: {
  locale: string;
  paymentDueAt?: string | null;
}) {
  const [payOpen, setPayOpen] = useState(false);

  return (
    <>
      <Alert className="border-amber-300 bg-amber-50 text-amber-950">
        <CreditCard className="h-4 w-4 text-amber-700" />
        <AlertTitle>Subscription payment required</AlertTitle>
        <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>
            You can prepare your store until{" "}
            {paymentDueAt
              ? new Date(paymentDueAt).toLocaleString()
              : "the end of your setup period"}
            . Selling, orders, POS, payouts, and all financial transactions
            remain locked until your payment is confirmed.
          </span>
          <Button
            type="button"
            size="sm"
            onClick={() => setPayOpen(true)}
            className="shrink-0"
          >
            Complete payment
          </Button>
        </AlertDescription>
      </Alert>
      <SubscriptionPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        locale={locale}
        endpoint="/api/vendor/applications/checkout"
        title="Complete your subscription payment"
        description="Choose how to pay for your vendor plan."
      />
    </>
  );
}
