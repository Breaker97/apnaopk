import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withCronRun } from "@/lib/cron/health";
import {
  autoReleaseDuePreorders,
  countOverdueReleases,
  expireUnpaidPreorders,
  retryPreorderBalanceCharges,
  sendPreorderBalanceReminders,
} from "@/lib/orders/preorder-cron";

/**
 * The daily pre-order sweep: remind, expire, report.
 *
 * Pre-orders were the one part of the order lifecycle with no clock at all —
 * every transition waited on a person, so a shopper who stopped replying held
 * their quota for ever and `expired` was a state nothing could write. See
 * `lib/orders/preorder-cron.ts` for what each pass does and why its
 * idempotency is per order rather than per run.
 *
 * Reminders run before expiries on purpose: an order reaching its grace cutoff
 * in the same run has already had both nudges, so nobody is expired without
 * having been asked. The saved-card retries run before both, so a balance the
 * store can collect itself is never chased — or cancelled — as if it could not
 * be.
 *
 * The auto-release pass runs last and is off unless the store switched it on;
 * see `autoReleaseDuePreorders` for why it sits at the end.
 *
 * Guarded by CRON_SECRET, like every other cron here.
 */
export const GET = withCronRun("preorders", async (request) => {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  await connectDB();

  // Before the reminders, and well before the expiries: a shopper who left a
  // card and authorised it should have the balance simply taken, not be asked
  // for money the store can already collect — and certainly not be reminded
  // about it in the same run that would have charged it.
  const charges = await retryPreorderBalanceCharges();
  const reminders = await sendPreorderBalanceReminders();
  const expiries = await expireUnpaidPreorders();
  // Last on purpose. A reservation this pass moves to `payment_due` becomes
  // eligible for the reminder and expiry passes the moment it does, and both
  // would fire on it in this same run — a shopper asked for money and reminded
  // about it in the same minute. A run later they read as what they are.
  const autoReleases = await autoReleaseDuePreorders();
  // Invitations for spots still open. A place an invited shopper never took,
  // or a limit an admin raised, frees nothing again — without this pass the
  // next shopper on the list would never hear of it.
  const { sweepPreorderWaitlists } = await import("@/lib/orders/preorder-waitlist");
  const waitlists = await sweepPreorderWaitlists();
  const overdueReleases = await countOverdueReleases();

  return NextResponse.json({
    success: true,
    charges,
    reminders,
    autoReleases,
    waitlists,
    expiries,
    // Nothing is done about these — a new release date is the vendor's to give.
    // Reported so a store that is quietly slipping is visible in the cron log.
    overdueReleases,
  });
});
