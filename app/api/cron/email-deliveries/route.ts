import { NextResponse } from "next/server";
import { processPendingEmailDeliveries } from "@/lib/email/email";
import { processPendingSmsDeliveries } from "@/lib/sms/sms";
import { withCronRun } from "@/lib/cron/health";

/**
 * Retries the notification outboxes: queued email, and SMS since text
 * messages were added. SMS rides this job rather than getting its own so an
 * existing store's schedule (vercel.json, or a crontab calling this URL)
 * retries texts without anyone adding a twelfth entry — and a store that never
 * uses SMS is not told by the cron-health check that a job it has no use for
 * has "stopped".
 */
export const GET = withCronRun("email-deliveries", async (request) => {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const [email, sms] = await Promise.all([
    processPendingEmailDeliveries(25),
    processPendingSmsDeliveries(25),
  ]);
  return NextResponse.json({ success: true, data: { ...email, sms } });
});
