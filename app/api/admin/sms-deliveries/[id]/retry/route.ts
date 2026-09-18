import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ValidationError } from "@/lib/api/errors";
import { isValidObjectId } from "@/lib/api/validate";
import { retrySmsDelivery } from "@/lib/sms/sms";

/**
 * POST /api/admin/sms-deliveries/[id]/retry — send one failed text again now.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "admin",
    demo: "block-mutations",
    rateLimit: { action: "admin:sms-deliveries:retry", preset: "moderate" },
  },
  async ({ params }) => {
    if (!isValidObjectId(params.id)) throw new ValidationError("Invalid message id");
    const result = await retrySmsDelivery(params.id);
    const sent = result.status === "sent";
    return NextResponse.json(
      {
        success: sent,
        message: sent
          ? "Text sent successfully"
          : result.error || "Retry failed; see the updated delivery log",
      },
      { status: sent ? 200 : 502 },
    );
  },
);
