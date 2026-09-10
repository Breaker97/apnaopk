import { NextResponse } from "next/server";
import { USER_ROLES } from "@/config/app.config";
import { AuthorizationError } from "@/lib/api/errors";
import { migrateBetterAuthUsers } from "@/lib/migrations/migrate-users";
import { withApi } from "@/lib/api/handler";

/**
 * POST /api/admin/migrate-users
 * Run user migration to sync roles and initialize 2FA fields
 * Admin only
 */
export const POST = withApi(
  { auth: "optional" },
  async ({ session }) => {
    if (!session) {
      return NextResponse.json(
        { success: false, message: "Authentication required" },
        { status: 401 },
      );
    }

    if (session.user.role !== USER_ROLES.ADMIN) {
      throw new AuthorizationError();
    }

    const result = await migrateBetterAuthUsers();

    return NextResponse.json({
      success: true,
      message: `Migration complete. ${result.synced} of ${result.total} users updated.`,
      data: result,
    });
  },
);
