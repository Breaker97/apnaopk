import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { reconcileBoostCampaigns } from "@/lib/boosts/boosts";
import { withCronRun } from "@/lib/cron/health";

/**
 * Periodic boost reconciliation, **every 5 minutes** (`vercel.json`).
 *
 * Eight passes: activate scheduled bookings, expire lapsed ones, release
 * lapsed checkout holds, sweep orphaned slot-days, sample delivery, cancel
 * campaigns whose product is gone, and send the expiring-soon and
 * starts-tomorrow reminders.
 *
 * The cadence is set by the HOLD, not by the day boundary. A booking opens and
 * closes at UTC midnight with no cron tick involved — the storefront reads the
 * campaign's own window — but a 45-minute hold checked every 30 minutes can
 * survive 75, which is a free half-hour park on Position 1. Five minutes is
 * also the delivery-sampling bucket, so a tick that runs twice counts once.
 *
 * Guarded by CRON_SECRET, mirroring /api/cron/vendor-subscriptions. On an
 * install that never enables boosting this scans a handful of empty indexed
 * queries and exits.
 */
export const GET = withCronRun("boosts", async (request) => {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  await connectDB();
  const summary = await reconcileBoostCampaigns(100);

  return NextResponse.json({ success: true, data: summary });
});
