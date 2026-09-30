import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withCronRun } from "@/lib/cron/health";
import { getSettings } from "@/models/settings.model";
import { sweepAbandonedCheckouts } from "@/lib/orders/abandoned-checkouts";

/**
 * The abandoned-checkout sweep: mark idle checkouts abandoned and, when the
 * checkout settings switch automatic recovery on, send each one its recovery
 * email after the configured delay. With tracking switched off it does
 * nothing. See `sweepAbandonedCheckouts` for the once-only guarantee.
 *
 * Guarded by CRON_SECRET, like every other cron here.
 */
export const GET = withCronRun("abandoned-checkouts", async () => {
  await connectDB();
  const settings = await getSettings();
  const result = await sweepAbandonedCheckouts({ settings });

  return NextResponse.json({ success: true, ...result });
});
