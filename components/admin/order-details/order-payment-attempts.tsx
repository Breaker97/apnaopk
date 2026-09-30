import "server-only";
import { PaymentTransaction } from "@/models";
import { connectDB } from "@/lib/db";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/intl/money";

/**
 * Every payment tried for this order, including the ones that failed.
 *
 * The order page used to show a payment status and nothing else, so "the
 * customer says their card kept being refused" could only be answered from the
 * gateway's own dashboard — if the merchant had an account there, and if they
 * knew which of forty transactions was this one.
 *
 * Shown only where there is something to say: an order paid first time has one
 * succeeded row and no story, so the card stays hidden rather than adding a
 * section that repeats the badge above it.
 *
 * Rendered on the server and streamed with the rest of the page — the order
 * itself never waits on this.
 */

type AttemptRow = {
  _id: unknown;
  status?: string;
  provider?: string;
  grossAmount?: number;
  currency?: string;
  failureCode?: string;
  gatewayCode?: string;
  gatewayMessage?: string;
  source?: string;
  createdAt?: Date;
};

const STATUS_STYLES: Record<string, string> = {
  succeeded: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  failed: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  cancelled: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
};

export async function OrderPaymentAttempts({
  orderId,
  checkoutAttemptId,
}: {
  orderId: string;
  /** Set once the order came from a checkout attempt — see the model. */
  checkoutAttemptId?: string;
}) {
  await connectDB();
  const t = await getTranslations();
  const label = (key: string, fallback: string) =>
    t.has(key) ? t(key as never) : fallback;

  // Both: the tries that failed before this order existed are tied to the
  // attempt, not to the order, and they are exactly the ones worth showing.
  const or: Record<string, unknown>[] = [{ orderId }];
  if (checkoutAttemptId) or.push({ checkoutAttemptId });

  const rows = await PaymentTransaction.find({ type: "charge", $or: or })
    .sort({ createdAt: 1 })
    .select("status provider grossAmount currency failureCode gatewayCode gatewayMessage source createdAt")
    .lean<AttemptRow[]>();

  const failures = rows.filter((row) => row.status !== "succeeded");
  if (rows.length < 2 && failures.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {label(
            "admin.orderDetails.paymentAttempts.title",
            "Payment attempts",
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row) => (
          <div
            key={String(row._id)}
            className="flex flex-wrap items-start gap-3 border-b pb-3 last:border-0 last:pb-0"
          >
            <span
              className={`rounded-sm px-2 py-1 text-[12px] font-medium ${
                STATUS_STYLES[String(row.status)] || STATUS_STYLES.pending
              }`}
            >
              {label(
                `admin.paymentTransactionsPage.transactionStatuses.${row.status}`,
                String(row.status || ""),
              )}
            </span>

            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {row.provider}
                {row.grossAmount ? (
                  <span className="ml-2 font-normal text-muted-foreground">
                    {formatCurrency(row.grossAmount, row.currency || "USD")}
                  </span>
                ) : null}
              </div>
              {row.failureCode ? (
                <div className="mt-1 text-xs">
                  <span className="font-mono text-rose-600 dark:text-rose-400">
                    {label(
                      `admin.paymentTransactionsPage.failureCodes.${row.failureCode}`,
                      row.failureCode.replace(/_/g, " "),
                    )}
                  </span>
                  {row.gatewayMessage ? (
                    <span className="ml-2 text-muted-foreground">
                      {row.gatewayMessage}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <time
              className="text-xs text-muted-foreground"
              dateTime={row.createdAt ? new Date(row.createdAt).toISOString() : undefined}
            >
              {row.createdAt
                ? new Date(row.createdAt).toLocaleString()
                : ""}
            </time>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
