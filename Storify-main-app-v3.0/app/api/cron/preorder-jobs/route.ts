import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withCronRun } from "@/lib/cron/health";
import { runPreorderFrequentPasses } from "@/lib/orders/preorder-jobs";

/**
 * The frequent pre-order worker (every 15 minutes in vercel.json).
 *
 * Resumes durable lifecycle operations, carries moved release dates to the
 * orders waiting on them, sends and confirms balance notices, charges saved
 * cards whose notice window has passed, and recovers paid releases that were
 * waiting on stock. Each pass is bounded and keeps its own continuation
 * state, so a run cut short by its time budget simply continues next time.
 */
export const GET = withCronRun("preorder-jobs", async () => {
  await connectDB();
  const result = await runPreorderFrequentPasses({ budgetMs: 45_000 });
  return NextResponse.json({ success: true, ...result });
});
