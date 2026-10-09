import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import {
  processShipmentJobs,
  sweepTrackingCandidates,
} from "@/lib/shipping/carriers/shipment-worker";
import { settlePendingRefunds } from "@/lib/shipping/carriers/fulfillment";
import { withCronRun } from "@/lib/cron/health";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Polling fallback for carrier tracking.
 *
 * Webhooks are the primary path; this exists because Shippo retries a failed
 * delivery only twice, after which a parcel would silently stop updating. The
 * poll interval widens with parcel age so the carrier's rate limit is spent on
 * the shipments most likely to have moved.
 */
export const GET = withCronRun("carrier-tracking", async () => {
  if (isDemoModeEnabled()) {
    return NextResponse.json({ success: true, data: { skipped: "demo_mode" } });
  }

  await connectDB();

  const swept = await sweepTrackingCandidates();
  const drained = await processShipmentJobs(25);
  // Refunds a carrier left undecided when a label was voided. Their cost stays
  // on the books until the carrier confirms, and this is where it does.
  const refunds = await settlePendingRefunds({ limit: 25 });

  return NextResponse.json({
    success: true,
    data: { ...swept, ...drained, refunds },
  });
});
