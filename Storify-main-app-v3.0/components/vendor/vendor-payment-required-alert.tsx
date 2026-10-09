"use client";

import { useState } from "react";
import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WarningBanner } from "@/components/ui/warning-banner";
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
      <WarningBanner
        role="alert"
        icon={CreditCard}
        title="Subscription payment required"
        action={
          <Button
            type="button"
            size="sm"
            onClick={() => setPayOpen(true)}
            className="shrink-0"
          >
            Complete payment
          </Button>
        }
      >
        You can prepare your store until{" "}
        {paymentDueAt
          ? new Date(paymentDueAt).toLocaleString()
          : "the end of your setup period"}
        . Selling, orders, POS, payouts, and all financial transactions remain
        locked until your payment is confirmed.
      </WarningBanner>
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
