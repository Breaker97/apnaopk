import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import {
  processShipmentJobs,
  sweepAutoShipCandidates,
} from "@/lib/shipping/carriers/shipment-worker";
import {
  processAddressHolds,
  sweepAddressChecks,
} from "@/lib/orders/address-hold";
import { withCronRun } from "@/lib/cron/health";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Drains the carrier work queue and sweeps for orders that should have
 * auto-shipped.
 *
 * The sweep is not redundant with the inline hooks: every payment finalizer
 * writes `PROCESSING` directly, and several do so inside a gateway webhook
 * whose latency budget is not ours to spend on a label purchase.
 */
export const GET = withCronRun("carrier-shipments", async () => {
  // A demo instance ships a publicly known admin login; it must never buy a
  // real label from whatever carrier account happens to be configured.
  if (isDemoModeEnabled()) {
    return NextResponse.json({ success: true, data: { skipped: "demo_mode" } });
  }

  await connectDB();

  // Address holds before shipping: an order whose address fails its check is
  // held here, so the auto-ship sweep that follows never tries it.
  const addressChecks = await sweepAddressChecks().catch((error) => {
    console.error("Address check sweep failed:", error);
    return { checked: 0, held: 0 };
  });
  const addressHolds = await processAddressHolds().catch((error) => {
    console.error("Address hold sweep failed:", error);
    return { reminders: 0, expired: 0, cancelled: 0 };
  });

  // Sweep first so anything newly eligible is drained in the same invocation.
  const swept = await sweepAutoShipCandidates();
  const drained = await processShipmentJobs(25);

  return NextResponse.json({
    success: true,
    data: { ...swept, ...drained, addressChecks, addressHolds },
  });
});
