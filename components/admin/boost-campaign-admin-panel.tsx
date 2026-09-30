"use client";

import { useTranslations } from "next-intl";
import Link from "@/components/language/link";
import { AlertTriangle, Ban, Pause, Play, Receipt, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrencyFormatter } from "@/providers/currency-provider";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { useBoostCampaignActions } from "@/components/admin/boost-campaign-actions";
import type { BoostCampaignListRow } from "@/lib/boosts/boost-campaign-list";

export interface BoostPaymentAttemptRow {
  _id: string;
  provider: string;
  status: string;
  amount: number;
  refundedAmount: number;
  currency: string;
  reference: string;
  /** What the admin wrote down for an offline payment. */
  note?: string | null;
  paidAt: string | null;
  createdAt: string;
}

const ATTEMPT_TONE: Record<string, string> = {
  paid: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  reversed: "bg-destructive/10 text-destructive",
};

/**
 * Everything the admin's copy of the booking screen adds: the verbs, what is
 * owed, and which attempts paid for it.
 *
 * It sits above the vendor-facing delivery record rather than beside it,
 * because a support conversation runs in that order — "what did you charge me
 * for", then "which days ran".
 */
export function BoostCampaignAdminPanel({
  campaign,
  attempts,
  vendorHref,
  releasedDays,
  unservedShare,
}: {
  campaign: BoostCampaignListRow;
  attempts: BoostPaymentAttemptRow[];
  vendorHref: string | null;
  /** Days handed back by pause, cancel, truncation or a partial refund. */
  releasedDays: number;
  /** Fractional days the storefront could not render, summed. */
  unservedShare: number;
}) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);
  const formatPrice = useCurrencyFormatter(campaign.currency);
  const { actioningId, runAction } = useBoostCampaignActions();

  const busy = actioningId === campaign._id;
  const perDay = campaign.positionSnapshot.pricePerDay;
  const settled = attempts.reduce((sum, row) => sum + row.refundedAmount, 0);
  const owed = campaign.refundableAmount;
  // Money was taken but the booking never ran: `paidAt` is only stamped by a
  // successful grant, so a PAID attempt beside an empty `paidAt` is the
  // refused-fulfilment case the credit exists for.
  const paidButNotFulfilled =
    !campaign.paidAt && attempts.some((row) => row.status === "paid");

  return (
    <div className="space-y-4">
      {paidButNotFulfilled ? (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex gap-3 py-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="text-sm">
              {label(
                "boosts.admin.paidNotFulfilled",
                "This booking was paid for and never ran — the days were gone, or its terms no longer held, by the time the payment landed. The whole charge is owed back.",
              )}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base">
              {label("boosts.admin.creditLedger", "Credit ledger")}
            </CardTitle>
            {owed > 0 ? (
              <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300">
                {formatPrice(owed)}
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row
              label={label("boosts.admin.charged", "Charged")}
              value={formatPrice(campaign.amount)}
              hint={`${formatPrice(perDay)} × ${campaign.billedDays}`}
            />
            {releasedDays > 0 ? (
              <Row
                label={label(
                  "boosts.admin.releasedDays",
                  "Released days",
                )}
                value={formatPrice(perDay * releasedDays)}
                hint={`${releasedDays} × ${formatPrice(perDay)}`}
              />
            ) : null}
            {unservedShare > 0 ? (
              <Row
                label={label(
                  "boosts.admin.undeliveredDays",
                  "Undelivered days",
                )}
                value={formatPrice(perDay * unservedShare)}
                hint={`${unservedShare.toFixed(2)} × ${formatPrice(perDay)}`}
              />
            ) : null}
            {settled > 0 ? (
              <Row
                label={label("boosts.admin.settled", "Already settled")}
                value={`− ${formatPrice(settled)}`}
              />
            ) : null}
            <div className="flex items-center justify-between border-t pt-3 font-semibold">
              <span>{label("boosts.admin.outstanding", "Outstanding")}</span>
              <span className={owed > 0 ? "text-amber-700 dark:text-amber-300" : ""}>
                {formatPrice(owed)}
              </span>
            </div>
            {owed > 0 ? (
              <>
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={() => runAction(campaign, "mark_refunded")}
                >
                  <Receipt className="size-4" />
                  {label("boosts.admin.markRefunded", "Mark refunded")}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {label(
                    "boosts.admin.markRefundedHint",
                    "Send the money at the payment provider first. This records the ledger; it moves nothing on its own.",
                  )}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {label(
                  "boosts.admin.nothingOwed",
                  "Nothing outstanding on this booking.",
                )}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base">
              {label("boosts.admin.paymentAttempts", "Payment attempts")}
            </CardTitle>
            {vendorHref ? (
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link href={vendorHref}>
                  <Store className="size-3.5" />
                  {campaign.vendor?.storeName ||
                    label("boosts.table.vendor", "Vendor")}
                </Link>
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            {attempts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {label(
                  "boosts.admin.noAttempts",
                  "No payment attempt was ever created for this booking.",
                )}
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {attempts.map((attempt) => (
                  <li
                    key={attempt._id}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium capitalize">
                        {attempt.provider}
                        {attempt.refundedAmount > 0 ? (
                          <span className="ms-2 text-xs font-normal text-muted-foreground">
                            −{formatPrice(attempt.refundedAmount)}{" "}
                            {label("boosts.admin.refunded", "refunded")}
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {attempt.reference || attempt._id}
                      </p>
                      {attempt.note ? (
                        <p
                          className="truncate text-xs text-muted-foreground"
                          title={attempt.note}
                        >
                          {label("boosts.booking.note", "Note")}: {attempt.note}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm">
                        {formatPrice(attempt.amount)}
                      </span>
                      <Badge
                        variant="secondary"
                        className={ATTEMPT_TONE[attempt.status] || ""}
                      >
                        {attempt.status}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({
  label: rowLabel,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">
        {rowLabel}
        {hint ? (
          <span className="ms-2 text-xs opacity-80">{hint}</span>
        ) : null}
      </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

/**
 * The moderation verbs, for the booking screen's header. Same hook, same
 * warnings and same state rules as the list's row menu.
 */
export function BoostCampaignAdminActions({
  campaign,
}: {
  campaign: BoostCampaignListRow;
}) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);
  const { actioningId, runAction } = useBoostCampaignActions();
  const busy = actioningId === campaign._id;

  return (
    <>
      {campaign.status === "active" ? (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={busy}
          onClick={() => runAction(campaign, "pause")}
        >
          <Pause className="size-3.5" />
          {label("boosts.admin.pause", "Pause")}
        </Button>
      ) : null}
      {campaign.status === "paused" ? (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={busy}
          onClick={() => runAction(campaign, "resume")}
        >
          <Play className="size-3.5" />
          {label("boosts.admin.resume", "Resume")}
        </Button>
      ) : null}
      {["scheduled", "active", "paused", "pending_payment"].includes(
        campaign.status,
      ) ? (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-destructive hover:text-destructive"
          disabled={busy}
          onClick={() => runAction(campaign, "cancel")}
        >
          <Ban className="size-3.5" />
          {label("boosts.admin.cancel", "Cancel")}
        </Button>
      ) : null}
    </>
  );
}
