"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { VENDOR_STATUS } from "@/config/app.config";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import { SubscriptionPaymentDialog } from "@/components/vendor/subscription-payment-dialog";
import { formatCurrency } from "@/lib/intl/money";
import { resolveCurrency } from "@/lib/intl/currencies";

/**
 * The pending charge is quoted in the currency the plan was priced in, which is
 * frozen on the application — so it is formatted with that code rather than the
 * store default (which an admin may have changed since).
 */
function formatPlanCharge(price: number, currencyCode?: string | null) {
  const currency = resolveCurrency(currencyCode);
  return formatCurrency(price, currency.code, currency.locale);
}

interface VendorApplicationStatusProps {
  status?: string;
  storeName?: string;
  locale?: string;
  payment?: {
    status?: string | null;
    dueAt?: string | null;
    planName?: string | null;
    price?: number | null;
    currency?: string | null;
    billingInterval?: string | null;
  } | null;
  canContinueToDashboard?: boolean;
  setupAccessExpired?: boolean;
  /** The paid plan's free trial ran out unpaid. A different situation from an
   * expired setup window: the vendor has been selling, and is being asked for
   * the first payment now rather than for the one they never made. */
  trialEnded?: boolean;
}

export function VendorApplicationStatus({
  status,
  storeName,
  locale = "en",
  payment,
  canContinueToDashboard = false,
  setupAccessExpired = false,
  trialEnded = false,
}: VendorApplicationStatusProps) {
  const router = useRouter();
  const [payOpen, setPayOpen] = useState(false);
  const [isContinuing, setIsContinuing] = useState(false);
  const isPending = status === VENDOR_STATUS.PENDING;
  const isPaymentRequired = status === VENDOR_STATUS.PAYMENT_REQUIRED;
  const isRejected = status === VENDOR_STATUS.REJECTED;
  const isSuspended = status === VENDOR_STATUS.SUSPENDED;

  async function continueToDashboard() {
    setIsContinuing(true);
    try {
      const response = await fetch("/api/vendor/applications/continue", {
        method: "POST",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(body?.message || "Could not open the setup dashboard");
        return;
      }
      router.replace(`/${locale}/vendor/dashboard`);
      router.refresh();
    } catch {
      toast.error("Could not open the setup dashboard");
    } finally {
      setIsContinuing(false);
    }
  }

  const Icon = isPending
    ? Clock
    : isPaymentRequired
      ? Clock
      : isRejected
        ? XCircle
        : isSuspended
          ? AlertTriangle
          : CheckCircle2;

  const title = isPending
    ? "Application under review"
    : isPaymentRequired
      ? trialEnded
        ? "Your free trial has ended"
        : "Complete subscription payment"
      : isRejected
        ? "Application rejected"
        : isSuspended
          ? "Vendor account suspended"
          : "Vendor application status";

  const description = isPending
    ? "Your vendor profile exists, but it is waiting for admin approval. Until then, vendor tools, public store visibility, products, orders, payments, and payouts are locked."
    : isPaymentRequired
      ? trialEnded
        ? "Your trial period is over and your store is no longer visible to shoppers. Pay for your first billing period to bring it back — your plan, products and orders are all still here."
        : setupAccessExpired
          ? "Your seven-day setup access has ended. Complete payment to reactivate your vendor dashboard and activate selling."
          : "Your application passed admin review. You can continue to a restricted setup dashboard, but selling and financial transactions stay locked until your payment is confirmed."
      : isRejected
        ? "Your vendor application was not approved. Your normal user account remains active. Review the reason you were sent, update your details, and apply again."
        : isSuspended
          ? "Your vendor selling access is suspended. Products, orders, payments, and payouts are locked until an admin restores access."
          : "Your vendor access is not active yet.";

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-10">
      <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center">
        <Card className="w-full border-border bg-card shadow-sm">
          <CardContent className="p-8 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <Icon className="h-7 w-7 text-muted-foreground" />
            </div>
            <Badge variant="outline" className="mb-4 capitalize">
              {(status || "pending").replaceAll("_", " ")}
            </Badge>
            <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
            {storeName ? (
              <p className="mt-2 text-sm font-medium text-muted-foreground">
                {storeName}
              </p>
            ) : null}
            <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
              {description}
            </p>
            {isPaymentRequired && payment ? (
              <div className="mx-auto mt-6 max-w-md border-y py-4 text-left text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Plan</span>
                  <span className="font-medium">{payment.planName || "-"}</span>
                </div>
                <div className="mt-2 flex justify-between gap-4">
                  <span className="text-muted-foreground">Price</span>
                  <span className="font-medium">
                    {formatPlanCharge(
                      Number(payment.price || 0),
                      payment.currency,
                    )}{" "}
                    / {payment.billingInterval || "period"}
                  </span>
                </div>
                {trialEnded ? null : (
                  <div className="mt-2 flex justify-between gap-4">
                    <span className="text-muted-foreground">
                      Setup access until
                    </span>
                    <span className="text-right font-medium">
                      {payment.dueAt
                        ? `${new Date(payment.dueAt).toLocaleString()}`
                        : "-"}
                    </span>
                  </div>
                )}
              </div>
            ) : null}
            {isPaymentRequired ? (
              <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                <Button
                  onClick={() => setPayOpen(true)}
                  disabled={isContinuing}
                >
                  {trialEnded ? "Pay and reopen my store" : "Complete payment"}
                </Button>
                {canContinueToDashboard && !setupAccessExpired ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={continueToDashboard}
                    disabled={isContinuing}
                  >
                    {isContinuing
                      ? "Opening dashboard..."
                      : "Continue to dashboard"}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {isRejected ? (
              <div className="mt-6 flex justify-center">
                <Button asChild>
                  <a href={`/${locale}/become-vendor`}>Update and apply again</a>
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <SubscriptionPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        locale={locale}
        endpoint="/api/vendor/applications/checkout"
        title="Complete your subscription payment"
        description={
          payment?.planName
            ? `Choose how to pay for the ${payment.planName} plan.`
            : "Choose how to pay for your vendor plan."
        }
      />
    </div>
  );
}
