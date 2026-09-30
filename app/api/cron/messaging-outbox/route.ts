import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { processMessageOutbox } from "@/lib/conversations/providers/outbox";
import { withCronRun } from "@/lib/cron/health";

export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = withCronRun("messaging-outbox", async () => {
  await connectDB();
  const result = await processMessageOutbox(25);
  return NextResponse.json({ success: true, data: result });
});
