"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DataTable,
  CurrencyCell,
  DateCell,
  StatusCell,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { apiClient } from "@/lib/api/client";
import { useCurrency } from "@/providers/currency-provider";
import type { VendorSubscriptionSummary } from "../vendor-detail-types";

interface PlanOption {
  _id: string;
  name: string;
  price: number;
  billingInterval: string;
  commissionRate: number;
  status: string;
}

interface SubscriptionTabProps {
  vendorId?: string;
  readOnly?: boolean;
  plansEnabled?: boolean;
  subscription?: VendorSubscriptionSummary | null;
  onSubscriptionChange?: () => void;
}

function formatInterval(interval?: string) {
  if (!interval || interval === "none") return "";
  return `/${interval}`;
}

/**
 * Billing states that cost the store money or access if nobody acts.
 *
 * These used to render as muted text in the detail grid alongside a dozen
 * other fields, which is where an unpaid vendor goes unnoticed. Anything that
 * needs a human is promoted to an alert instead.
 */
function billingDistress(subscription?: VendorSubscriptionSummary | null) {
  if (!subscription) return null;

  const status = String(subscription.status || "").toLowerCase();
  const providerStatus = String(
    subscription.providerStatus || "",
  ).toLowerCase();
  const lastPaymentStatus = String(
    subscription.lastPayment?.status || "",
  ).toLowerCase();

  if (subscription.lastReconcileError) {
    return {
      title: "Billing reconciliation failed",
      detail: subscription.lastReconcileError,
    };
  }
  if (status === "past_due" || providerStatus === "past_due") {
    return {
      title: "Subscription is past due",
      detail: subscription.gracePeriodEnd
        ? `Access ends ${new Date(subscription.gracePeriodEnd).toLocaleString()} unless payment succeeds.`
        : "Payment has not been collected for the current period.",
    };
  }
  if (status === "expired" || providerStatus === "canceled") {
    return {
      title: "Subscription is no longer active",
      detail: "The vendor has reverted to the store's default commission rate.",
    };
  }
  if (lastPaymentStatus === "failed") {
    return {
      title: "Last invoice failed",
      detail:
        "The most recent subscription charge did not go through. Stripe will retry within the grace window.",
    };
  }
  return null;
}

interface InvoiceRow {
  _id: string;
  providerInvoiceId: string;
  status: string;
  amountDue: number;
  amountPaid: number;
  amountRefunded: number;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  attemptCount: number;
  failureMessage: string | null;
  createdAt: string;
}

interface InvoicesResponse {
  data: InvoiceRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const INVOICE_STATUS_MAP = {
  paid: { label: "Paid", variant: "default" as const },
  open: { label: "Open", variant: "outline" as const },
  failed: { label: "Failed", variant: "destructive" as const },
  void: { label: "Void", variant: "secondary" as const },
  refunded: { label: "Refunded", variant: "destructive" as const },
};

/**
 * Billing history for the vendor's subscription.
 *
 * Split out because the panel above shows only the latest invoice, which
 * cannot distinguish "never billed" from "failed three months running" — and
 * it is the evidence behind the subscription figure in the Payouts tab.
 */
function InvoiceHistory({ vendorId }: { vendorId: string }) {
  const { formatPrice } = useCurrency();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<{
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  } | null>(null);

  useEffect(() => {
    let active = true;

    apiClient
      .get<InvoicesResponse>(
        `/api/admin/vendors/${vendorId}/subscription/payments?page=${page}&limit=10`,
      )
      .then((res) => {
        if (!active) return;
        setRows(res.data || []);
        setPagination({
          page: res.pagination.page,
          pageSize: res.pagination.limit,
          total: res.pagination.total,
          totalPages: res.pagination.totalPages,
        });
      })
      .catch((error) => {
        if (!active) return;
        console.error("Failed to load subscription invoices:", error);
        toast.error("Failed to load billing history");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [vendorId, page]);

  const columns: DataTableColumn<InvoiceRow>[] = [
    {
      id: "invoice",
      header: "Invoice",
      cell: (row) => (
        <span className="font-mono text-xs">{row.providerInvoiceId}</span>
      ),
      className: "w-[200px]",
    },
    {
      id: "date",
      header: "Date",
      cell: (row) => <DateCell date={row.createdAt} format="medium" />,
      className: "w-[130px]",
    },
    {
      id: "period",
      header: "Period",
      cell: (row) =>
        row.periodStart && row.periodEnd ? (
          <span className="text-xs text-muted-foreground">
            {new Date(row.periodStart).toLocaleDateString()} –{" "}
            {new Date(row.periodEnd).toLocaleDateString()}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <div className="min-w-0">
          <StatusCell status={row.status} statusMap={INVOICE_STATUS_MAP} />
          {row.failureMessage && (
            <p className="mt-0.5 line-clamp-2 text-xs text-destructive">
              {row.failureMessage}
            </p>
          )}
          {!row.failureMessage && row.attemptCount > 1 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {row.attemptCount} attempts
            </p>
          )}
        </div>
      ),
      className: "w-[190px]",
    },
    {
      id: "amount",
      header: "Amount",
      cell: (row) => (
        <div className="min-w-0">
          <CurrencyCell value={row.amountPaid || row.amountDue} />
          {row.amountRefunded > 0 && (
            <p className="truncate text-xs text-muted-foreground">
              refunded {formatPrice(row.amountRefunded)}
            </p>
          )}
        </div>
      ),
      className: "w-[140px]",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing history</CardTitle>
        <CardDescription>
          Every subscription invoice for this vendor, newest first
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          data={rows}
          columns={columns}
          keyField="_id"
          isLoading={isLoading}
          loadingMode="rows"
          pagination={pagination ?? undefined}
          onPageChange={setPage}
          emptyMessage="This vendor has never been invoiced"
        />
      </CardContent>
    </Card>
  );
}

export function SubscriptionTab({
  vendorId,
  readOnly,
  plansEnabled,
  subscription,
  onSubscriptionChange,
}: SubscriptionTabProps) {
  const { formatPrice } = useCurrency();
  const { confirm } = useConfirmation();
  const showPlans = Boolean(plansEnabled && vendorId);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [selectedPlan, setSelectedPlan] = useState("");
  const [isLoadingPlans, setIsLoadingPlans] = useState(showPlans);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isReversingCancellation, setIsReversingCancellation] = useState(false);
  const [isCancellingChange, setIsCancellingChange] = useState(false);
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);

  // A downgrade to a free plan is staged as a period-end cancellation, so
  // `cancelAtPeriodEnd` on its own cannot tell "the vendor is leaving" from
  // "the vendor is moving to a cheaper plan". The pending change decides which
  // undo is the honest one to offer — offering "Keep subscription" against a
  // scheduled downgrade is what sent admins into a raw Stripe error.
  const hasScheduledDowngrade = Boolean(
    subscription?.pendingChangeType === "downgrade" &&
      subscription?.pendingChangeStatus === "scheduled",
  );
  const hasPendingCancellation = Boolean(
    subscription?.cancelAtPeriodEnd && !hasScheduledDowngrade,
  );

  // Is there a real Stripe subscription behind this row? `provider` alone is
  // not the answer: buildSubscriptionForPlan stamps "stripe" on EVERY paid
  // incomplete row as a placeholder, and the real rail is only written once a
  // period is actually collected. The provider ref is what distinguishes a
  // live Stripe subscription from a not-yet-paid placeholder.
  const hasLiveStripeBilling = Boolean(
    subscription?.provider === "stripe" && subscription?.paymentProviderRef,
  );

  // Mirrors the DELETE route: only a live Stripe subscription cancels at
  // period end; everything else is cancelled immediately.
  const cancelsAtPeriodEnd = hasLiveStripeBilling;

  // Offline payment / comp-extend covers every paid plan Stripe is not
  // already billing — one-shot gateways, manual rows, and a vendor whose
  // first period is being settled by bank transfer.
  const canRecordPayment = Boolean(
    subscription &&
    !hasLiveStripeBilling &&
    subscription.billingInterval &&
    subscription.billingInterval !== "none",
  );

  const handleRecordPayment = async () => {
    if (!vendorId) return;
    const confirmed = await confirm({
      title: "Record offline payment",
      description:
        "Extends the subscription by one full billing period, exactly as a gateway payment would. Use for payments collected outside the gateways (bank transfer, cash) or to comp the vendor.",
      confirmText: "Record payment",
      cancelText: "Cancel",
    });
    if (!confirmed) return;
    setIsRecordingPayment(true);
    try {
      await apiClient.patch(`/api/admin/vendors/${vendorId}/subscription`, {
        action: "record_payment",
      });
      toast.success("Payment recorded — the period was extended");
      onSubscriptionChange?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to record payment",
      );
    } finally {
      setIsRecordingPayment(false);
    }
  };

  const distress = billingDistress(subscription);

  useEffect(() => {
    if (!showPlans) return;
    let active = true;

    apiClient
      .get<{ data: PlanOption[] }>(
        "/api/admin/vendors/plans?limit=100&status=active",
      )
      .then((res) => {
        if (active) setPlans(res.data || []);
      })
      .catch((error) => {
        if (!active) return;
        console.error("Failed to load plans:", error);
      })
      .finally(() => {
        if (active) setIsLoadingPlans(false);
      });

    return () => {
      active = false;
    };
  }, [showPlans]);

  const handleAssign = async () => {
    if (!vendorId || !selectedPlan) return;
    setIsAssigning(true);
    try {
      await apiClient.post(`/api/admin/vendors/${vendorId}/subscription`, {
        planId: selectedPlan,
      });
      toast.success(
        subscription?.planName ? "Plan change staged" : "Plan assigned",
      );
      setSelectedPlan("");
      onSubscriptionChange?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to assign plan",
      );
    } finally {
      setIsAssigning(false);
    }
  };

  const handleCancel = async () => {
    if (!vendorId) return;
    const ok = await confirm({
      title: "Cancel subscription",
      description: cancelsAtPeriodEnd
        ? `Stripe will cancel at the end of the current paid period. Access and commission remain unchanged until then.${
            hasScheduledDowngrade
              ? " The scheduled downgrade is dropped — the subscription ends instead of moving to the cheaper plan."
              : ""
          }`
        : "The subscription is cancelled immediately and the plan benefit ends now — any remaining prepaid time is forfeited.",
      confirmText: cancelsAtPeriodEnd ? "Schedule cancellation" : "Cancel now",
      cancelText: "Keep plan",
      variant: "destructive",
    });
    if (!ok) return;

    setIsCancelling(true);
    try {
      await apiClient.delete(`/api/admin/vendors/${vendorId}/subscription`);
      toast.success(
        cancelsAtPeriodEnd
          ? "Cancellation scheduled for the current period end"
          : "Subscription cancelled",
      );
      onSubscriptionChange?.();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to cancel subscription",
      );
    } finally {
      setIsCancelling(false);
    }
  };

  const handleReverseCancellation = async () => {
    if (!vendorId) return;
    setIsReversingCancellation(true);
    try {
      await apiClient.patch(`/api/admin/vendors/${vendorId}/subscription`, {});
      toast.success("Scheduled cancellation reversed");
      onSubscriptionChange?.();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to reverse cancellation",
      );
    } finally {
      setIsReversingCancellation(false);
    }
  };

  const handleCancelScheduledChange = async () => {
    if (!vendorId) return;
    const ok = await confirm({
      title: "Cancel scheduled downgrade",
      description: `The vendor stays on ${
        subscription?.planName || "their current plan"
      } and keeps being billed for it. The staged change is dropped at the gateway as well.`,
      confirmText: "Cancel downgrade",
      cancelText: "Keep downgrade",
    });
    if (!ok) return;

    setIsCancellingChange(true);
    try {
      await apiClient.patch(`/api/admin/vendors/${vendorId}/subscription`, {
        action: "cancel_scheduled_change",
      });
      toast.success("Scheduled downgrade cancelled");
      onSubscriptionChange?.();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to cancel the scheduled downgrade",
      );
    } finally {
      setIsCancellingChange(false);
    }
  };

  if (!showPlans) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Subscription Plan</CardTitle>
          <CardDescription>
            Vendor subscription plans are not enabled for this store.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Subscription Plan</CardTitle>
          <CardDescription>
            Assign or cancel this vendor&apos;s subscription plan. The
            plan&apos;s commission rate is projected onto the vendor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {distress && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{distress.title}</AlertTitle>
              <AlertDescription>{distress.detail}</AlertDescription>
            </Alert>
          )}

          {subscription?.planName ? (
            <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{subscription.planName}</p>
                  {subscription.status && (
                    <Badge variant="secondary" className="capitalize">
                      {subscription.status}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {formatPrice(subscription.price ?? 0)}
                  {formatInterval(subscription.billingInterval)}
                  {typeof subscription.commissionRateSnapshot === "number"
                    ? ` · ${subscription.commissionRateSnapshot}% commission`
                    : ""}
                </p>
                {subscription.pendingChangeStatus ? (
                  <p className="text-xs text-muted-foreground">
                    Pending {subscription.pendingChangeType}:{" "}
                    {subscription.pendingPlanName || "current plan"} (
                    {subscription.pendingChangeStatus.replaceAll("_", " ")})
                    {subscription.pendingChangeEffectiveAt
                      ? ` · ${new Date(
                          subscription.pendingChangeEffectiveAt,
                        ).toLocaleString()}`
                      : ""}
                  </p>
                ) : null}
                <div className="grid gap-x-6 gap-y-1 pt-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <span>
                    Provider: {subscription.providerStatus || "not started"}
                  </span>
                  <span>
                    Price: {subscription.stripePriceId || "not linked"}
                  </span>
                  <span>
                    Latest invoice:{" "}
                    {subscription.lastPayment?.providerInvoiceId ||
                      subscription.stripeLatestInvoiceId ||
                      "none"}
                  </span>
                  <span>
                    Invoice status:{" "}
                    {subscription.lastPayment?.status || "unknown"}
                  </span>
                  <span>
                    Period:{" "}
                    {subscription.currentPeriodStart
                      ? new Date(
                          subscription.currentPeriodStart,
                        ).toLocaleDateString()
                      : "—"}{" "}
                    –{" "}
                    {subscription.currentPeriodEnd
                      ? new Date(
                          subscription.currentPeriodEnd,
                        ).toLocaleDateString()
                      : "—"}
                  </span>
                  <span>
                    Grace deadline:{" "}
                    {subscription.gracePeriodEnd
                      ? new Date(subscription.gracePeriodEnd).toLocaleString()
                      : "none"}
                  </span>
                  <span>
                    Last reconciled:{" "}
                    {subscription.lastReconciledAt
                      ? new Date(subscription.lastReconciledAt).toLocaleString()
                      : "never"}
                  </span>
                  {subscription.lastReconcileError ? (
                    <span className="text-destructive sm:col-span-2">
                      Reconciliation error: {subscription.lastReconcileError}
                    </span>
                  ) : null}
                </div>
              </div>
              {!readOnly && (
                <div className="flex flex-col items-end gap-2">
                  {hasScheduledDowngrade && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCancelScheduledChange}
                      disabled={isCancellingChange}
                    >
                      {isCancellingChange && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Cancel scheduled downgrade
                    </Button>
                  )}
                  {hasPendingCancellation ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleReverseCancellation}
                      disabled={isReversingCancellation}
                    >
                      {isReversingCancellation && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Keep subscription
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCancel}
                      disabled={isCancelling}
                    >
                      {isCancelling && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {cancelsAtPeriodEnd
                        ? "Cancel at period end"
                        : "Cancel subscription"}
                    </Button>
                  )}
                  {canRecordPayment ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleRecordPayment}
                      disabled={isRecordingPayment}
                    >
                      {isRecordingPayment && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Record payment / extend
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This vendor is not on a subscription plan.
            </p>
          )}

          {!readOnly && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <Label>
                  {subscription?.planName ? "Change plan" : "Assign plan"}
                </Label>
                <Select
                  value={selectedPlan}
                  onValueChange={setSelectedPlan}
                  disabled={isLoadingPlans || plans.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        isLoadingPlans
                          ? "Loading plans…"
                          : plans.length === 0
                            ? "No active plans"
                            : "Select a plan"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {plans.map((plan) => (
                      <SelectItem key={plan._id} value={plan._id}>
                        {plan.name} — {formatPrice(plan.price)}
                        {formatInterval(plan.billingInterval)} ·{" "}
                        {plan.commissionRate}%
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                onClick={handleAssign}
                disabled={!selectedPlan || isAssigning}
              >
                {isAssigning && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Assign
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {vendorId && <InvoiceHistory vendorId={vendorId} />}
    </div>
  );
}
