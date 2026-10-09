import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withCronRun } from "@/lib/cron/health";
import {
  countOverdueReleases,
  expireUnpaidPreorders,
  preorderWorkflowCounts,
  preparePreorderCollections,
  sendPreorderBalanceReminders,
} from "@/lib/orders/preorder-cron";
import { runPreorderFrequentPasses } from "@/lib/orders/preorder-jobs";

/**
 * The daily pre-order sweep.
 *
 * In the order section 11 of docs/PREORDER_RELIABILITY_SPEC.md sets out —
 * which reduces races but is not what prevents them; every pass re-checks its
 * own guards:
 *
 *  1–2. the frequent passes first (lifecycle operations, date propagation,
 *       notices, matured charges, paid-release recovery), so the day starts
 *       from a settled state even where the frequent job is not scheduled;
 *  3.   prepare what is due — the automatic release (if switched on), orders
 *       whose consignments all became ready, and legacy requests adopted into
 *       a request with an advance notice. Nothing here charges a card;
 *  4.   reminders on requests the shopper has been told about, then expiry of
 *       the ones whose deadline passed — durable cancellations, refunded in
 *       full by the operation worker;
 *  5.   waitlist invitations and the overdue count.
 *
 * Guarded by CRON_SECRET, like every other cron here.
 */
export const GET = withCronRun("preorders", async () => {
  await connectDB();

  const frequent = await runPreorderFrequentPasses({ budgetMs: 25_000 });
  const preparation = await preparePreorderCollections();
  const reminders = await sendPreorderBalanceReminders();
  const expiries = await expireUnpaidPreorders();
  // Invitations for spots still open.
  const { sweepPreorderWaitlists } = await import("@/lib/orders/preorder-waitlist");
  const waitlists = await sweepPreorderWaitlists();
  const overdueReleases = await countOverdueReleases();
  const workflow = await preorderWorkflowCounts();

  return NextResponse.json({
    success: true,
    frequent,
    preparation,
    reminders,
    expiries,
    waitlists,
    // Nothing is done about these — a new release date is the vendor's to give.
    overdueReleases,
    // Durable state, not attempts: what is waiting on whom right now.
    workflow,
  });
});
