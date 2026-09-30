import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { processConversationEscalations } from "@/lib/conversations/escalation";
import { withCronRun } from "@/lib/cron/health";

export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = withCronRun("messaging-escalations", async () => {
  await connectDB();
  const result = await processConversationEscalations(50);
  return NextResponse.json({ success: true, data: result });
});
