"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowLeftRight,
  CreditCard,
  ExternalLink,
  Loader2,
  ReceiptText,
  RefreshCw,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { useCurrency } from "@/providers/currency-provider";
import { SubscriptionPaymentDialog } from "@/components/vendor/subscription-payment-dialog";
import {
  GATEWAY_LABELS,
  type PlatformGateway,
} from "@/components/vendor/payment-method-picker";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

interface BillingSubscription {
  status: string | null;
  provider: string | null;
  planName: string | null;
  price: number | null;
  billingInterval: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  gracePeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pendingChangeStatus: string | null;
  stripeTakeoverPending: boolean;
  stripeTakeoverAt: string | null;
  commissionRate: number | null;
}

/** Stripe-side plan changes that block a switch — mirrors the renew route. */
const IN_FLIGHT_CHANGE_STATUSES = [
  "awaiting_vendor",
  "awaiting_payment",
  "scheduled",
];

interface InvoiceRow {
  id: string;
  provider: string;
  status: string;
  amountPaid: number;
  amountDue: number;
  amountRefunded: number;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  failureMessage: string | null;
  createdAt: string;
}

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  trialing: "secondary",
  past_due: "destructive",
  incomplete: "outline",
  cancelled: "outline",
  expired: "destructive",
  paid: "default",
  open: "secondary",
  failed: "destructive",
  void: "outline",
  refunded: "outline",
};

/** `provider` also carries "manual" (an admin-recorded offline period), which
 *  is not a gateway the vendor could have picked. */
function providerLabel(provider: string | null | undefined) {
  if (!provider) return null;
  if (provider === "manual") return "Recorded by admin";
  return GATEWAY_LABELS[provider as PlatformGateway] ?? provider;
}

export function VendorBillingContent({
  locale,
  paymentMethods,
  subscription,
}: {
  locale: string;
  paymentMethods: PlatformGateway[];
  subscription: BillingSubscription | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { formatPrice } = useCurrency();
  const label = useFallbackTranslator(t);

  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  // "renew" pays the next period on the gateway already in use; "switch" does
  // the same but also ends the Stripe subscription behind it.
  const [payMode, setPayMode] = useState<"renew" | "switch" | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [stripeSwitchLoading, setStripeSwitchLoading] = useState(false);

  useEffect(() => {
    apiClient
      .get<{ data: InvoiceRow[] }>("/api/vendor/subscription/payments?limit=20")
      .then((res) => setInvoices(res.data ?? []))
      .catch(() => setInvoices([]));
  }, []);

  const openPortal = useCallback(async () => {
    setPortalLoading(true);
    try {
      const { url } = await apiClient.post<{ url: string }>(
        "/api/vendor/subscription/portal",
        { locale },
      );
      window.location.assign(url);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : label(
              "vendor.billing.portalFailed",
              "Could not open the billing portal.",
            ),
      );
      setPortalLoading(false);
    }
  }, [locale, label]);

  const startStripeSwitch = useCallback(async () => {
    setStripeSwitchLoading(true);
    try {
      const { url } = await apiClient.post<{ url: string }>(
        "/api/vendor/subscription/switch-to-stripe",
        { locale },
      );
      window.location.assign(url);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : label(
              "vendor.billing.switchToStripeFailed",
              "Could not start the switch to automatic renewal.",
            ),
      );
      setStripeSwitchLoading(false);
    }
  }, [locale, label]);

  // Returning from the takeover checkout. The webhook records the pending
  // subscription on its own schedule, so this only tells the vendor what
  // happened — there is nothing to verify, because nothing was charged.
  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get(
      "stripe_switch",
    );
    if (!outcome) return;
    if (outcome === "success") {
      toast.success(
        label(
          "vendor.billing.takeoverStarted",
          "Automatic renewal is set up. Your card is charged when this period ends.",
        ),
      );
    } else {
      toast.info(
        label(
          "vendor.billing.takeoverCancelled",
          "Switch cancelled. You are still paying period by period.",
        ),
      );
    }
    window.history.replaceState({}, "", window.location.pathname);
    router.refresh();
  }, [label, router]);

  const formatDate = (value: string | null) =>
    value ? new Date(value).toLocaleDateString(locale) : "—";

  const isStripe = subscription?.provider === "stripe";
  // A free trial on a paid plan: nothing has been charged and no payment method
  // was ever taken, so the dates and controls below read off `trialEnd` rather
  // than a billing period that does not exist yet.
  const isTrialing = subscription?.status === "trialing";
  // A plan with no recurring price has nothing to collect, so the pay controls
  // would open a dialog that the renew endpoint refuses anyway.
  const isPayable =
    Boolean(subscription) &&
    subscription?.billingInterval !== "none" &&
    Number(subscription?.price ?? 0) > 0;
  const inRenewableState =
    subscription?.status === "active" || subscription?.status === "past_due";
  const renewable = isPayable && !isStripe && inRenewableState;
  // Switching ends an auto-renewing subscription, so it is offered only when
  // the switch can actually complete: a Stripe plan-change staged as an invoice
  // or a subscription schedule has to be resolved first, and the renew route
  // refuses the same states.
  const changePending = IN_FLIGHT_CHANGE_STATUSES.includes(
    String(subscription?.pendingChangeStatus),
  );
  const switchable =
    isPayable &&
    isStripe &&
    inRenewableState &&
    !changePending &&
    paymentMethods.some((method) => method !== "stripe");
  // The reverse move. Only from a live, still-running period: the handover
  // works by trialing the Stripe subscription to the paid-through date, and a
  // lapsed or past-due row has no such date to hand over at.
  const canSwitchToStripe =
    isPayable &&
    !isStripe &&
    subscription?.status === "active" &&
    !changePending &&
    !subscription?.stripeTakeoverPending &&
    paymentMethods.includes("stripe");

  return (
    <div className="space-y-6">
      <div className="-mt-2">
        <h1 className="text-3xl font-bold">
          {label("vendor.billing.pageTitle", "Billing")}
        </h1>
        <p className="text-muted-foreground">
          {label(
            "vendor.billing.pageSubtitle",
            "Your plan, how you pay for it, and everything you have been charged.",
          )}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <CreditCard className="h-4 w-4" />
            {subscription?.planName ||
              label("vendor.billing.noPlanTitle", "No paid plan")}
            {subscription?.status ? (
              <Badge variant={STATUS_VARIANT[subscription.status] ?? "outline"}>
                {label(
                  `vendor.billing.status.${subscription.status}`,
                  subscription.status.replace(/_/g, " "),
                )}
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            {subscription
              ? label(
                  "vendor.billing.planSubtitle",
                  "Your current subscription with the marketplace.",
                )
              : label(
                  "vendor.billing.noPlanSubtitle",
                  "You are not on a paid plan. Contact the marketplace admin to be placed on one.",
                )}
          </CardDescription>
        </CardHeader>

        {subscription ? (
          <CardContent className="space-y-4">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">
                  {label("vendor.billing.price", "Price")}
                </dt>
                <dd className="font-medium tabular-nums">
                  {subscription.price != null
                    ? formatPrice(subscription.price)
                    : "—"}
                  {subscription.billingInterval &&
                  subscription.billingInterval !== "none" ? (
                    <span className="text-muted-foreground">
                      {" / "}
                      {label(
                        `vendor.billing.interval.${subscription.billingInterval}`,
                        subscription.billingInterval === "yearly"
                          ? "year"
                          : "month",
                      )}
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {isTrialing
                    ? label("vendor.billing.trialEnds", "Trial ends")
                    : isStripe
                      ? label("vendor.billing.renewsOn", "Renews on")
                      : label("vendor.billing.periodEnds", "Period ends")}
                </dt>
                <dd className="font-medium">
                  {formatDate(
                    isTrialing
                      ? subscription.trialEnd
                      : subscription.currentPeriodEnd,
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {label("vendor.billing.payingWith", "Paying with")}
                </dt>
                <dd className="font-medium">
                  {providerLabel(subscription.provider) || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {label("vendor.billing.commission", "Commission")}
                </dt>
                <dd className="font-medium tabular-nums">
                  {subscription.commissionRate != null
                    ? `${subscription.commissionRate}%`
                    : "—"}
                </dd>
              </div>
            </dl>

            {isTrialing ? (
              <p className="rounded-lg border bg-muted/40 p-3 text-sm">
                {subscription.trialEnd
                  ? label(
                      "vendor.billing.trialUntil",
                      "You are on a free trial — no payment method needed. Your first payment is due on {date}; your store stays closed until it is paid.",
                    ).replace("{date}", formatDate(subscription.trialEnd))
                  : label(
                      "vendor.billing.trial",
                      "You are on a free trial — no payment method needed yet.",
                    )}
              </p>
            ) : null}

            {subscription.status === "past_due" ? (
              <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                {subscription.gracePeriodEnd
                  ? label(
                      "vendor.billing.pastDueUntil",
                      "This subscription is past due. Settle it before {date} to keep your store active.",
                    ).replace("{date}", formatDate(subscription.gracePeriodEnd))
                  : label(
                      "vendor.billing.pastDue",
                      "This subscription is past due. Settle it to keep your store active.",
                    )}
              </p>
            ) : null}

            {subscription.stripeTakeoverPending ? (
              <p className="rounded-lg border bg-muted/40 p-3 text-sm">
                {subscription.stripeTakeoverAt
                  ? label(
                      "vendor.billing.takeoverPendingOn",
                      "Automatic renewal is set up. Your card is charged for the first time on {date}, when this period ends — until then nothing changes.",
                    ).replace(
                      "{date}",
                      formatDate(subscription.stripeTakeoverAt),
                    )
                  : label(
                      "vendor.billing.takeoverPending",
                      "Automatic renewal is set up and starts when this period ends.",
                    )}
              </p>
            ) : null}

            {subscription.cancelAtPeriodEnd ? (
              <p className="rounded-lg border bg-muted/40 p-3 text-sm">
                {label(
                  "vendor.billing.cancelScheduled",
                  "This plan is set to end when the current period does.",
                )}
              </p>
            ) : null}

            {isPayable ? (
              <>
                <Separator />
                <div className="flex flex-wrap items-center gap-3">
                  {isStripe ? (
                    <>
                      <Button onClick={openPortal} disabled={portalLoading}>
                        {portalLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ExternalLink className="h-4 w-4" />
                        )}
                        {label(
                          "vendor.billing.managePortal",
                          "Manage in billing portal",
                        )}
                      </Button>
                      {switchable ? (
                        <Button
                          variant="outline"
                          onClick={() => setPayMode("switch")}
                        >
                          <ArrowLeftRight className="h-4 w-4" />
                          {label(
                            "vendor.billing.switchMethod",
                            "Switch payment method",
                          )}
                        </Button>
                      ) : null}
                      <p className="w-full text-sm text-muted-foreground">
                        {changePending
                          ? label(
                              "vendor.billing.switchBlockedByChange",
                              "Finish or cancel the pending plan change before switching payment method.",
                            )
                          : switchable
                            ? label(
                                "vendor.billing.stripeAutoRenewsSwitchable",
                                "This plan renews automatically. Change your card or cancel in the portal — or switch to another payment method, which pays your next period and stops the automatic renewal.",
                              )
                            : label(
                                "vendor.billing.stripeAutoRenews",
                                "This plan renews automatically. Change your card or cancel in the portal.",
                              )}
                      </p>
                    </>
                  ) : (
                    <>
                      <Button
                        onClick={() => setPayMode("renew")}
                        disabled={!renewable || paymentMethods.length === 0}
                      >
                        {label("vendor.billing.payPeriod", "Pay next period")}
                      </Button>
                      {canSwitchToStripe ? (
                        <Button
                          variant="outline"
                          onClick={startStripeSwitch}
                          disabled={stripeSwitchLoading}
                        >
                          {stripeSwitchLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          {label(
                            "vendor.billing.switchToStripe",
                            "Set up automatic renewal",
                          )}
                        </Button>
                      ) : null}
                      <p className="w-full text-sm text-muted-foreground">
                        {paymentMethods.length === 0
                          ? label(
                              "vendor.billing.noMethods",
                              "No payment method is available. Contact the marketplace admin.",
                            )
                          : renewable
                            ? label(
                                "vendor.billing.switchHint",
                                "You can pay with a different method each period — pick one at checkout.",
                              )
                            : label(
                                "vendor.billing.notRenewable",
                                "This subscription is not in a state that can be renewed right now.",
                              )}
                      </p>
                      {canSwitchToStripe ? (
                        <p className="w-full text-sm text-muted-foreground">
                          {label(
                            "vendor.billing.switchToStripeHint",
                            "Automatic renewal charges your card when this period ends, so you never have to come back and pay. Nothing is charged today.",
                          )}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              </>
            ) : null}
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ReceiptText className="h-4 w-4" />
            {label("vendor.billing.historyTitle", "Billing history")}
          </CardTitle>
          <CardDescription>
            {label(
              "vendor.billing.historySubtitle",
              "Every period you have been charged for, across all payment methods.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invoices === null ? (
            <Skeleton className="h-32 w-full rounded-lg" />
          ) : invoices.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {label(
                "vendor.billing.historyEmpty",
                "Nothing has been charged yet.",
              )}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {label("vendor.billing.colDate", "Date")}
                    </TableHead>
                    <TableHead>
                      {label("vendor.billing.colPeriod", "Period")}
                    </TableHead>
                    <TableHead>
                      {label("vendor.billing.colMethod", "Method")}
                    </TableHead>
                    <TableHead>
                      {label("vendor.billing.colStatus", "Status")}
                    </TableHead>
                    <TableHead className="text-right">
                      {label("vendor.billing.colAmount", "Amount")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(invoice.paidAt ?? invoice.createdAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {invoice.periodStart && invoice.periodEnd
                          ? `${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}`
                          : "—"}
                      </TableCell>
                      <TableCell>{providerLabel(invoice.provider)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={STATUS_VARIANT[invoice.status] ?? "outline"}
                        >
                          {label(
                            `vendor.billing.invoiceStatus.${invoice.status}`,
                            invoice.status,
                          )}
                        </Badge>
                        {invoice.failureMessage ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {invoice.failureMessage}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPrice(
                          invoice.status === "paid"
                            ? invoice.amountPaid
                            : invoice.amountDue,
                        )}
                        {invoice.amountRefunded > 0 ? (
                          <p className="text-xs text-muted-foreground">
                            {label("vendor.billing.refunded", "Refunded")}{" "}
                            {formatPrice(invoice.amountRefunded)}
                          </p>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <SubscriptionPaymentDialog
        open={payMode !== null}
        onOpenChange={(open) => setPayMode(open ? payMode : null)}
        locale={locale}
        endpoint="/api/vendor/subscription/renew"
        excludeStripe
        body={payMode === "switch" ? { switchFromStripe: true } : undefined}
        title={
          payMode === "switch"
            ? label("vendor.billing.switchTitle", "Switch payment method")
            : label("vendor.billing.renewTitle", "Renew your plan")
        }
        description={
          payMode === "switch"
            ? label(
                "vendor.billing.switchDescription",
                "This pays your next period through the method you pick and stops the automatic Stripe renewal. Days you have already paid for are kept.",
              )
            : label(
                "vendor.billing.renewDescription",
                "Pay for the next billing period to keep your store active.",
              )
        }
      />
    </div>
  );
}
