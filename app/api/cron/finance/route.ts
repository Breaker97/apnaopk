import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { runRecurringExpenses } from "@/lib/finance/recurring-expenses";
import { withCronRun } from "@/lib/cron/health";

/**
 * Daily finance pass.
 *
 * One job today: create the copies recurring expense templates owe. Daily
 * rather than hourly because the smallest interval is a week — a rent row does
 * not need to appear within the hour, and a missed day is caught up by the next
 * run rather than lost.
 *
 * Guarded by CRON_SECRET, like every other cron here. On a store with no
 * recurring templates this is one indexed query and an exit.
 */
export const GET = withCronRun("finance", async (request) => {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  await connectDB();
  const recurring = await runRecurringExpenses();

  return NextResponse.json({ success: true, data: { recurring } });
});
