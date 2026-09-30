import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import * as z from "zod";
import { validateOptionalBody } from "@/lib/api/validate";
import {
  listActiveSessions,
  revokeAllSessions,
  revokeOtherSessions,
  revokeSession,
} from "@/lib/auth/session-revocation";

/**
 * POST /api/auth/revoke-sessions
 * Revoke all sessions for the current user (log out everywhere)
 */
const RevokeSessionsSchema = z.object({
  revokeAll: z.boolean().default(true),
  sessionId: z.string().max(200).optional(),
  excludeCurrent: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, message: "Authentication required" },
        { status: 401 },
      );
    }

    const { revokeAll, sessionId, excludeCurrent } = await validateOptionalBody(
      request,
      RevokeSessionsSchema,
    );

    if (revokeAll) {
      const revokedCount = excludeCurrent
        ? await revokeOtherSessions(session.user.id, session.session.id)
        : await revokeAllSessions(session.user.id);

      return NextResponse.json({
        success: true,
        message: excludeCurrent
          ? `All other sessions have been revoked (${revokedCount} sessions)`
          : `All sessions have been revoked (${revokedCount} sessions)`,
        revokedCount,
      });
    } else if (sessionId) {
      // Only ever one of the caller's own sessions.
      const revoked = await revokeSession(session.user.id, sessionId);

      if (!revoked) {
        return NextResponse.json(
          { success: false, message: "Session not found or already revoked" },
          { status: 404 },
        );
      }

      return NextResponse.json({
        success: true,
        message: "Session has been revoked",
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          message: "Either revokeAll or sessionId is required",
        },
        { status: 400 },
      );
    }
  } catch (error) {
    console.error("Revoke sessions error:", error);
    return NextResponse.json(
      { success: false, message: "An error occurred" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/auth/revoke-sessions
 * Get all active sessions for the current user
 */
export async function GET() {
  try {
    // Get authenticated user
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, message: "Authentication required" },
        { status: 401 },
      );
    }

    const sessions = await listActiveSessions(session.user.id);

    // `_id` is the key this response has always used.
    const sessionsWithCurrent = sessions.map(({ id, ...rest }) => ({
      _id: id,
      ...rest,
      isCurrent: id === session.session.id,
    }));

    return NextResponse.json({
      success: true,
      sessions: sessionsWithCurrent,
    });
  } catch (error) {
    console.error("Get sessions error:", error);
    return NextResponse.json(
      { success: false, message: "An error occurred" },
      { status: 500 },
    );
  }
}
