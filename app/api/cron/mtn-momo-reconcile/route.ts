import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { reconcileMtnMomoPayments } from "@/lib/payments/mtn-momo-reconcile";
import { withCronRun } from "@/lib/cron/health";

/**
 * Recovers MTN MoMo payments that were collected but never confirmed.
 *
 * MTN's callback is delivered exactly once with no retries, so a missed
 * delivery is gone for good. A shopper who approves the PIN prompt and closes
 * the tab would otherwise leave an order pending forever with the money
 * already gone. This asks MTN directly.
 *
 * Guarded by CRON_SECRET, mirroring /api/cron/orange-money-reconcile.
 */
export const GET = withCronRun("mtn-momo-reconcile", async (request) => {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  await connectDB();
  const reconciliation = await reconcileMtnMomoPayments(50);

  return NextResponse.json({ success: true, data: { reconciliation } });
});
