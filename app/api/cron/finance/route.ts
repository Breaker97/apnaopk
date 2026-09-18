import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { runRecurringExpenses } from "@/lib/finance/recurring-expenses";
import {
  deepSweepWindow,
  reconcileRecentLedger,
} from "@/lib/finance/ledger-reconcile";
import { withCronRun } from "@/lib/cron/health";

/** How far back the daily pass re-posts money events — overlapping runs on purpose. */
const LEDGER_RECONCILE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * How long each half of the ledger pass may take.
 *
 * The recent window is what keeps the books current and goes first; the older
 * slice gets whatever is left. Neither may run the request out of time, and
 * whatever a run does not reach is reached by the next one — the pass decides
 * what to post by reading the ledger, not by remembering where it stopped.
 */
const RECENT_BUDGET_MS = 20_000;
const SWEEP_BUDGET_MS = 25_000;

/**
 * Daily finance pass.
 *
 * Two jobs. Re-post money events, so a ledger write that failed on its live
 * path heals on its own — the last few days every run, plus one older slice of
 * history per run, so a gap older than the window is repaired within the month
 * instead of waiting for an admin to run the backfill script by hand. See
 * `reconcileRecentLedger`. And create the copies recurring expense templates
 * owe. Daily
 * rather than hourly because the smallest interval is a week — a rent row does
 * not need to appear within the hour, and a missed day is caught up by the next
 * run rather than lost.
 *
 * Guarded by CRON_SECRET, like every other cron here. On a store with no
 * recurring templates this is one indexed query and an exit.
 */
export const runtime = "nodejs";
// The pass walks real collections; the platform default cuts it off mid-scan.
export const maxDuration = 60;

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
  const ledger = await reconcileRecentLedger({
    since: new Date(Date.now() - LEDGER_RECONCILE_WINDOW_MS),
    budgetMs: RECENT_BUDGET_MS,
  });
  // One older slice, a different one each day, on a budget of its own. Gated
  // on the recent pass finishing, a store whose last few days alone fill the
  // recent budget would never have its older history checked at all.
  const sweepWindow = deepSweepWindow();
  const sweep = await reconcileRecentLedger({
    ...sweepWindow,
    budgetMs: SWEEP_BUDGET_MS,
  });

  return NextResponse.json({
    success: true,
    data: {
      recurring,
      ledger,
      sweep: { ...sweep, since: sweepWindow.since, until: sweepWindow.until },
    },
  });
});
