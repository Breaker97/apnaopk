/**
 * Retire the pending gateway orders nobody ever paid for, before a gateway is
 * moved onto checkout attempts.
 *
 * Every redirect and mobile-money checkout writes its order BEFORE the shopper
 * leaves to pay, and until the expiry sweep existed nothing ever tidied away
 * the ones who did not come back. A store that has been running for a year has
 * a year of them, and each is a row that the checkout-attempt migration would
 * have to keep a legacy lookup alive for. Retiring them first is what makes
 * that lookup a short-lived compatibility shim rather than a permanent one.
 *
 * **It asks every gateway before it writes anything.** That is not a nicety:
 * Paystack charges the card the moment the shopper confirms, Razorpay can hand
 * back a payment already captured, and ioTec and mobile money cannot refund
 * through an API at all. So an order whose gateway says "paid" is SETTLED by
 * this run, not written off; one the gateway is unsure about is left exactly
 * as it was, for ever if need be. Only a definite "never paid" is retired.
 *
 * All of that is `expireStalePaymentOrders` — the same function the half-hourly
 * cron runs. This script only points it somewhere else: further back in time,
 * at one gateway, and with the brakes on.
 *
 * Usage (from the repo root):
 *
 *   npx tsx --env-file=.env scripts/retire-stale-gateway-orders.ts
 *   npx tsx --env-file=.env scripts/retire-stale-gateway-orders.ts --method razorpay --days 7
 *   npx tsx --env-file=.env scripts/retire-stale-gateway-orders.ts --method razorpay --apply
 *
 * It rehearses by default. Nothing is written until `--apply`, and even then
 * `--limit` (50 by default) caps how many gateway calls one run makes: run it
 * again until it reports nothing left.
 */
import { expireStalePaymentOrders } from "@/lib/orders/checkout-expiry";
import { Order } from "@/models";
import { connectDB } from "@/lib/db";
import { PAYMENT_STATUS } from "@/config/app.config";

const DAY_MS = 24 * 60 * 60 * 1000;

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const inline = process.argv.find((value) => value.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : undefined;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const methods = (arg("method") || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const days = Number(arg("days") || "");
  const limit = Number(arg("limit") || 50);

  await connectDB();

  // What is out there, before anything is asked of any gateway.
  const backlog = await Order.aggregate<{ _id: string; count: number; oldest: Date }>([
    { $match: { paymentStatus: PAYMENT_STATUS.PENDING } },
    {
      $group: {
        _id: "$paymentMethod",
        count: { $sum: 1 },
        oldest: { $min: "$createdAt" },
      },
    },
    { $sort: { count: -1 } },
  ]);

  console.log("Pending orders by payment method (before this run)");
  for (const row of backlog) {
    const age = row.oldest
      ? Math.floor((Date.now() - new Date(row.oldest).getTime()) / DAY_MS)
      : 0;
    console.log(
      `  ${String(row._id || "(none)").padEnd(14)} ${String(row.count).padStart(5)}   oldest ${age}d`,
    );
  }
  console.log();

  console.log(
    apply
      ? "APPLYING — orders the gateway confirms were never paid will be expired."
      : "Rehearsal only. Nothing will be written. Add --apply to act.",
  );
  if (methods.length > 0) console.log(`  gateways: ${methods.join(", ")}`);
  if (Number.isFinite(days) && days > 0) console.log(`  older than: ${days} days`);
  console.log(`  limit: ${limit}`);
  console.log();

  const result = await expireStalePaymentOrders({
    limit: Number.isFinite(limit) && limit > 0 ? limit : 50,
    dryRun: !apply,
    ...(Number.isFinite(days) && days > 0 ? { olderThanMs: days * DAY_MS } : {}),
    ...(methods.length > 0 ? { paymentMethods: methods } : {}),
  });

  console.log("Asked the gateway about:", result.checked);
  console.log(
    apply ? "  settled (the money was there):" : "  WOULD settle (the money is there):",
    result.finalized,
  );
  console.log(
    apply ? "  expired:" : "  WOULD expire:",
    result.expired,
  );
  console.log(
    apply
      ? "    of which already bought another way (cancelled, not emailed):"
      : "    of which already bought another way (WOULD cancel, not email):",
    result.superseded,
  );
  console.log("  left alone (gateway unsure):", result.unknown);
  console.log("  gateway could not be reached:", result.failed);
  if (result.needingAttention.length > 0) {
    console.log();
    console.log(
      "Undecided for over a week — check these in the gateway's own dashboard:",
    );
    for (const order of result.needingAttention) {
      console.log(`  ${order.orderNumber} (${order.paymentMethod})`);
    }
  }
  if (result.checked === limit) {
    console.log();
    console.log("Hit the limit — run it again to work through the rest.");
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("retire-stale-gateway-orders failed:", error);
  process.exit(1);
});
