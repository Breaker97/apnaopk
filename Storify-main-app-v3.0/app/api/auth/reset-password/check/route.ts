import { NextRequest, NextResponse } from "next/server";
import * as z from "zod";
import { inspectAccountAccessToken } from "@/lib/auth/account-access-token";

const CheckSchema = z.object({ token: z.string().min(1).max(200) });

/**
 * POST /api/auth/reset-password/check
 *
 * Whether an emailed link still works, and what it is for ("reset" or
 * "invite"), so the page can say "Set your password" to someone who never had
 * one. In the body rather than the query string: the token is a password for
 * the account until it is spent, and a URL is written to every access log on
 * its way.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = CheckSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, valid: false, message: "Token is required" },
        { status: 400 },
      );
    }
    const check = await inspectAccountAccessToken(parsed.data.token);
    return NextResponse.json({ success: true, ...check });
  } catch (error) {
    console.error("Verify reset token error:", error);
    return NextResponse.json(
      { success: false, valid: false, message: "An error occurred" },
      { status: 500 },
    );
  }
}
