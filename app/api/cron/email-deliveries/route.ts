import { NextResponse } from "next/server";
import { processPendingEmailDeliveries } from "@/lib/email/email";
import { processPendingSmsDeliveries } from "@/lib/sms/sms";
import { processPushReceipts } from "@/lib/notifications/push-notifications";
import { withCronRun } from "@/lib/cron/health";

/**
 * Retries the notification outboxes: queued email, and SMS since text
 * messages were added. SMS rides this job rather than getting its own so an
 * existing store's schedule (vercel.json, or a crontab calling this URL)
 * retries texts without anyone adding a twelfth entry — and a store that never
 * uses SMS is not told by the cron-health check that a job it has no use for
 * has "stopped".
 *
 * The mobile app's push receipts ride it for the same reason: reading them is
 * how an uninstalled app's device stops being sent to, and a store without
 * the app pays one indexed read that finds nothing.
 */
export const GET = withCronRun("email-deliveries", async () => {
  const [email, sms, push] = await Promise.all([
    processPendingEmailDeliveries(25),
    processPendingSmsDeliveries(25),
    processPushReceipts(),
  ]);
  return NextResponse.json({ success: true, data: { ...email, sms, push } });
});
