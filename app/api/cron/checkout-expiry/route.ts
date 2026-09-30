import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withCronRun } from "@/lib/cron/health";
import {
  expireStaleCheckoutAttempts,
  expireStalePaymentOrders,
} from "@/lib/orders/checkout-expiry";
import { releaseExpiredStockHolds } from "@/lib/checkout/attempt-stock-hold";
import { reportGatewayOutages } from "@/lib/payments/gateway-health";
import { notifyAdminsPaymentAnomaly } from "@/lib/notifications/notifications";

/**
 * Closes out checkouts that went to a gateway and never came back.
 *
 * Every redirect gateway writes its order before the shopper leaves, and
 * nothing ever tidied up the ones who did not return: those rows sat
 * `pending / pending` for ever, in the admin's lists, in the vendor's, and in
 * the shopper's own order history. See `lib/orders/checkout-expiry.ts` for why
 * each one is put to its gateway before anything is written off, and why an
 * unanswered probe expires nothing.
 *
 * Every half hour, rather than every fifteen minutes like the mobile-money
 * reconcilers: nothing here is time-critical — the youngest candidate is an
 * hour old — and each candidate costs a call to somebody's payment API.
 *
 * Guarded by CRON_SECRET, like every other cron here.
 */
export const GET = withCronRun("checkout-expiry", async () => {
  await connectDB();
  const expiry = await expireStalePaymentOrders({ limit: 50 });
  // And the same question asked of checkout attempts, which is where a
  // switched-over gateway keeps its unfinished payments.
  const attempts = await expireStaleCheckoutAttempts({ limit: 50 });
  // Goods held for a payment window that has closed. A local clock, not a
  // gateway question, so it never waits behind the rate-limited sweeps above —
  // and the attempts themselves stay open, because a shopper who comes back
  // late may still pay. See `lib/checkout/attempt-stock-hold.ts`.
  const stockHolds = await releaseExpiredStockHolds({ limit: 200 }).catch(
    (err) => {
      console.error("Failed to release expired checkout stock holds:", err);
      return { released: 0 };
    },
  );

  // Orders no gateway will answer for, a week on. Nothing automatic can
  // safely decide these — an ioTec or MoMo payment cannot be refunded through
  // an API — so a person is told instead of a job guessing.
  // While we are looking at the payment log anyway: is any gateway refusing
  // almost everything? A shop otherwise learns that from the shoppers who
  // give up. See `lib/payments/gateway-health.ts`.
  const gateways = await reportGatewayOutages().catch((err) => {
    console.error("Failed to check gateway health:", err);
    return [];
  });

  const undecided = [...expiry.needingAttention, ...attempts.needingAttention];
  if (undecided.length > 0) {
    const numbers = undecided.map((order) => order.orderNumber).join(", ");
    await notifyAdminsPaymentAnomaly({
      title: "Payments still unresolved after a week",
      message: `The gateway has not said whether these were paid: ${numbers}. Check them in the gateway's own dashboard before cancelling or refunding.`,
      // One notice per day's worth of stragglers, not one per sweep.
      dedupeKey: `checkout-expiry:${new Date().toISOString().slice(0, 10)}`,
      link: "/admin/orders?paymentStatus=pending",
    });
  }

  return NextResponse.json({
    success: true,
    data: { expiry, attempts, stockHolds, gateways },
  });
});
