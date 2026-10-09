"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SubscriptionPaymentDialog } from "@/components/vendor/subscription-payment-dialog";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

/**
 * Renewal-due banner for one-shot (non-Stripe) plans, shown while the period is
 * still running.
 *
 * The reminder email tells the vendor to renew from their dashboard, but the
 * only renew control used to live inside the PAST-DUE alert — i.e. it appeared
 * after the lapse the reminder exists to prevent. This is the non-destructive
 * counterpart: informational styling, same one-shot payment dialog, shown for
 * the same window the cron reminds on.
 */
export function VendorRenewalDueAlert({
  locale,
  currentPeriodEnd,
}: {
  locale: string;
  currentPeriodEnd?: string | null;
}) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);
  const [renewOpen, setRenewOpen] = useState(false);

  const endsLabel = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <>
      <Alert>
        <CalendarClock className="h-4 w-4" />
        <AlertTitle>
          {label("vendor.billing.renewalDueTitle", "Subscription renewal due soon")}
        </AlertTitle>
        <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {endsLabel
              ? label(
                  "vendor.billing.renewalDueOn",
                  "Your plan period ends on {date}. Renew now to keep your store active without interruption.",
                ).replace("{date}", endsLabel)
              : label(
                  "vendor.billing.renewalDueSoon",
                  "Your plan period ends soon. Renew now to keep your store active without interruption.",
                )}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setRenewOpen(true)}
            className="shrink-0"
          >
            {label("vendor.billing.renewNow", "Renew now")}
          </Button>
        </AlertDescription>
      </Alert>

      <SubscriptionPaymentDialog
        open={renewOpen}
        onOpenChange={setRenewOpen}
        locale={locale}
        endpoint="/api/vendor/subscription/renew"
        excludeStripe
        title={label("vendor.billing.renewTitle", "Renew your plan")}
        description={label(
          "vendor.billing.renewDescription",
          "Pay for the next billing period to keep your store active.",
        )}
      />
    </>
  );
}
