import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { reconcileOrangeMoneyPayments } from "@/lib/payments/orange-money-reconcile";
import { withCronRun } from "@/lib/cron/health";

/**
 * Recovers Orange Money payments that were collected but never confirmed.
 *
 * Orange's notification retry policy is undocumented, so unlike Pesapal there
 * is no guarantee a missed callback is ever re-presented. A shopper who closes
 * the tab right after entering their OTP would otherwise leave an order pending
 * forever with the money already gone. This asks Orange directly.
 *
 * Guarded by CRON_SECRET, mirroring /api/cron/vendor-subscriptions.
 */
export const GET = withCronRun("orange-money-reconcile", async () => {
  await connectDB();
  const reconciliation = await reconcileOrangeMoneyPayments(50);

  return NextResponse.json({ success: true, data: { reconciliation } });
});
