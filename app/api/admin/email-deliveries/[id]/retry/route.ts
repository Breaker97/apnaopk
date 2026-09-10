import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { USER_ROLES } from "@/config/app.config";
import { retryEmailDelivery } from "@/lib/email/email";
import { getDemoModeMutationResponse } from "@/lib/demo-mode";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });
  }
  if (session.user.role !== USER_ROLES.ADMIN) {
    return NextResponse.json({ success: false, message: "Admin access required" }, { status: 403 });
  }
  const demoBlock = getDemoModeMutationResponse();
  if (demoBlock) return demoBlock;

  const { id } = await context.params;
  const sent = await retryEmailDelivery(id);
  return NextResponse.json(
    {
      success: sent,
      message: sent ? "Email sent successfully" : "Retry failed; see the updated delivery log",
    },
    { status: sent ? 200 : 502 },
  );
}
