import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { syncGatewayDisputes } from "@/lib/payments/gateway-disputes";
import { withCronRun } from "@/lib/cron/health";

/**
 * Hourly: ask every gateway with credentials about its disputes.
 *
 * The webhooks are the fast path; this is the one that cannot be missed. A
 * gateway whose webhook was never set up, is not subscribed to its dispute
 * events, or dropped a delivery still has its chargebacks recorded, its won
 * disputes given back and its fees booked within the hour. A gateway with no
 * credentials yet is reported as not configured, and synced from the first run
 * after they are added.
 *
 * Refunds ride the same run, for the same reason: a refund made in a
 * gateway's own dashboard, or one that failed days after it went, reaches the
 * books only through a webhook — see `syncGatewayRefunds`.
 *
 * Guarded by CRON_SECRET, like every other cron here.
 */
export const GET = withCronRun("gateway-disputes", async () => {
  await connectDB();
  const disputes = await syncGatewayDisputes();
  const { syncGatewayRefunds } = await import("@/lib/payments/gateway-refund-sync");
  const refunds = await syncGatewayRefunds();

  return NextResponse.json({ success: true, data: { disputes, refunds } });
});
