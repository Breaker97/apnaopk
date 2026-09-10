import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import {
  processShipmentJobs,
  sweepTrackingCandidates,
} from "@/lib/shipping/carriers/shipment-worker";
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
export const GET = withCronRun("carrier-tracking", async (request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  if (isDemoModeEnabled()) {
    return NextResponse.json({ success: true, data: { skipped: "demo_mode" } });
  }

  await connectDB();

  const swept = await sweepTrackingCandidates();
  const drained = await processShipmentJobs(25);

  return NextResponse.json({ success: true, data: { ...swept, ...drained } });
});
