import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { processConversationEscalations } from "@/lib/conversations/escalation";
import { withCronRun } from "@/lib/cron/health";

export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = withCronRun("messaging-escalations", async (request) => {
  const secret = process.env.CRON_SECRET;
  if (
    !secret ||
    request.headers.get("authorization") !== `Bearer ${secret}`
  ) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }
  await connectDB();
  const result = await processConversationEscalations(50);
  return NextResponse.json({ success: true, data: result });
});
