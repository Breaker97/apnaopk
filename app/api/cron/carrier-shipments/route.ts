import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import {
  processShipmentJobs,
  sweepAutoShipCandidates,
} from "@/lib/shipping/carriers/shipment-worker";
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
export const GET = withCronRun("carrier-shipments", async (request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  // A demo instance ships a publicly known admin login; it must never buy a
  // real label from whatever carrier account happens to be configured.
  if (isDemoModeEnabled()) {
    return NextResponse.json({ success: true, data: { skipped: "demo_mode" } });
  }

  await connectDB();

  // Sweep first so anything newly eligible is drained in the same invocation.
  const swept = await sweepAutoShipCandidates();
  const drained = await processShipmentJobs(25);

  return NextResponse.json({ success: true, data: { ...swept, ...drained } });
});
