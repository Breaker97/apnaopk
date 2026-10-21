import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withCronRun } from "@/lib/cron/health";
import { runScheduledPayouts } from "@/lib/finance/scheduled-payouts";

/**
 * Draws payouts up on each seller's own schedule — weekly, every two weeks or
 * monthly — see lib/finance/scheduled-payouts.ts. Daily; a seller whose day it
 * is not is skipped, and a second run the same day creates nothing.
 *
 * Guarded by CRON_SECRET, like every other cron here.
 */
export const maxDuration = 60;

export const GET = withCronRun("vendor-payouts", async (request) => {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  await connectDB();
  const outcome = await runScheduledPayouts({ budgetMs: 45_000 });
  if (outcome.skipped.length > 0) {
    // Skips are routine (nothing payable, below a minimum); logged so an
    // unexpected one — a quote that failed — can be found.
    console.info("Scheduled payouts skipped:", JSON.stringify(outcome.skipped.slice(0, 50)));
  }
  return NextResponse.json({
    success: true,
    data: { created: outcome.created.length, skipped: outcome.skipped.length, stoppedEarly: outcome.stoppedEarly },
  });
});
