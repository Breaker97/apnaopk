import { NextResponse } from "next/server";
import { processPendingEmailDeliveries } from "@/lib/email/email";
import { withCronRun } from "@/lib/cron/health";

export const GET = withCronRun("email-deliveries", async (request) => {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const result = await processPendingEmailDeliveries(25);
  return NextResponse.json({ success: true, data: result });
});
