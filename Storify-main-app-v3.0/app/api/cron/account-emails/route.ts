import { NextResponse } from "next/server";
import { processAccountEmailJobs } from "@/lib/auth/account-email-queue";
import { withCronRun } from "@/lib/cron/health";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Sends the queued account emails — the password resets and invitations an
 * admin sent to many customers at once — 20 a minute, so a store's mail
 * server is not asked for thousands at a time.
 */
export const GET = withCronRun("account-emails", async () => {
  const data = await processAccountEmailJobs();
  return NextResponse.json({ success: true, data });
});
