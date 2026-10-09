import { PaymentTransaction } from "@/models";
import { connectDB } from "@/lib/db";
import { PAYMENT_FAILURE_CODE } from "@/lib/payments/failure-codes";
import { notifyAdminsPaymentAnomaly } from "@/lib/notifications/notifications";

/**
 * Tell the store when a gateway stops working.
 *
 * A shop finds out its payment provider is broken from the shoppers who give
 * up, which is to say hours later and by way of lost sales. The signal is
 * already in the payment log: when almost everything a gateway touches within
 * an hour comes back refused, the fault is with the gateway, not with forty
 * shoppers' cards.
 *
 * Deliberately narrow, because a false alarm teaches people to ignore the
 * real one:
 *
 *  - a minimum number of attempts, so three bad minutes on a quiet shop is
 *    not an outage;
 *  - a high failure share, so a normal decline rate never trips it;
 *  - and the failures counted are the ones a BROKEN gateway produces —
 *    processing errors and refused requests — never `card_declined`, which is
 *    what a card-testing run produces and what the guard beside this handles.
 *
 * One notice per gateway per day: an outage that lasts all afternoon is one
 * piece of news, not fifty.
 */

const WINDOW_MS = 60 * 60 * 1000;

/** Below this many attempts, a run of failures is just a quiet hour. */
const MIN_ATTEMPTS = 8;

/** The share of attempts that must have failed for this to be an outage. */
const FAILURE_SHARE = 0.8;

/** The failures a broken gateway produces, as opposed to a refused card. */
const OUTAGE_FAILURE_CODES: string[] = [
  PAYMENT_FAILURE_CODE.PROCESSING_ERROR,
  PAYMENT_FAILURE_CODE.GATEWAY_REFUSED_REQUEST,
  PAYMENT_FAILURE_CODE.UNKNOWN,
];

type GatewayHealthReport = {
  provider: string;
  attempts: number;
  failures: number;
  /** Failures of the kind a broken gateway produces. */
  outageFailures: number;
};

/**
 * Which gateways look broken right now, and tell the admins about them.
 *
 * Returns what it found either way, so the cron's answer says what was
 * checked rather than only what went wrong.
 */
export async function reportGatewayOutages(): Promise<GatewayHealthReport[]> {
  await connectDB();
  const since = new Date(Date.now() - WINDOW_MS);

  const rows = await PaymentTransaction.aggregate<{
    _id: string;
    attempts: number;
    failures: number;
    outageFailures: number;
  }>([
    { $match: { type: "charge", createdAt: { $gte: since } } },
    {
      $group: {
        _id: "$provider",
        attempts: { $sum: 1 },
        failures: {
          $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
        },
        outageFailures: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", "failed"] },
                  { $in: ["$failureCode", OUTAGE_FAILURE_CODES] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  const reports = rows.map((row) => ({
    provider: String(row._id || "unknown"),
    attempts: row.attempts,
    failures: row.failures,
    outageFailures: row.outageFailures,
  }));

  const broken = reports.filter(
    (report) =>
      report.attempts >= MIN_ATTEMPTS &&
      report.failures / report.attempts >= FAILURE_SHARE &&
      // The deciding line: a gateway refusing cards is not a gateway that is
      // down, and telling a merchant it is would send them chasing their
      // provider while a card-testing run carries on.
      report.outageFailures > report.failures / 2,
  );

  for (const report of broken) {
    await notifyAdminsPaymentAnomaly({
      title: `${report.provider} is refusing almost every payment`,
      message: `${report.failures} of the last ${report.attempts} payments through ${report.provider} failed in the past hour, most of them with provider errors rather than declined cards. Check ${report.provider}'s status page — shoppers cannot pay this way right now.`,
      // One piece of news per gateway per day.
      dedupeKey: `gateway-outage:${report.provider}:${new Date()
        .toISOString()
        .slice(0, 10)}`,
      link: "/admin/payments/transactions?status=failed",
    });
  }

  return reports;
}
