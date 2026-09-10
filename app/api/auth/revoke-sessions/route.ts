import { NextRequest, NextResponse } from "next/server";
import { connectDB, mongoose } from "@/lib/db";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { validateOptionalBody } from "@/lib/api/validate";

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

    await connectDB();

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Database not connected");
    }

    if (revokeAll) {
      // Revoke sessions for the user
      const query: Record<string, unknown> = { userId: session.user.id };

      // If excludeCurrent is true, exclude the current session from deletion
      if (excludeCurrent) {
        query._id = { $ne: new ObjectId(session.session.id) };
      }

      const result = await db.collection("session").deleteMany(query);

      return NextResponse.json({
        success: true,
        message: excludeCurrent
          ? `All other sessions have been revoked (${result.deletedCount} sessions)`
          : `All sessions have been revoked (${result.deletedCount} sessions)`,
        revokedCount: result.deletedCount,
      });
    } else if (sessionId) {
      // Revoke a specific session
      const result = await db.collection("session").deleteOne({
        _id: new ObjectId(sessionId),
        userId: session.user.id, // Ensure user can only delete their own sessions
      });

      if (result.deletedCount === 0) {
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

    await connectDB();

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Database not connected");
    }

    // Get all sessions for the user
    const sessions = await db
      .collection("session")
      .find({ userId: session.user.id })
      .project({
        _id: 1,
        createdAt: 1,
        expiresAt: 1,
        userAgent: 1,
        ipAddress: 1,
      })
      .toArray();

    // Mark current session
    const sessionsWithCurrent = sessions.map((s) => ({
      ...s,
      isCurrent: s._id.toString() === session.session.id,
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
