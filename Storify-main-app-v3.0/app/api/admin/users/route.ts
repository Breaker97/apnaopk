import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models";
import { paginatedResponse } from "@/lib/api/response";
import {
  handleApiError,
  AuthenticationError,
  AuthorizationError,
} from "@/lib/api/errors";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { USER_ACCOUNT_STATUS, USER_ROLES } from "@/config/app.config";
import { validateQuery } from "@/lib/api/validate";
import { AdminListQuerySchema } from "@/lib/validations";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";

/**
 * GET /api/admin/users
 * Get all users with search and filter
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new AuthenticationError();
    if (session.user.role !== USER_ROLES.ADMIN) throw new AuthorizationError();

    // Rate limiting
    await rateLimitByUser(
      request,
      session.user.id,
      "admin:users:list",
      "lenient",
      session.user.role
    );

    // Validate query params (search is auto-sanitized for regex safety)
    const { page, limit, search, sortOrder } = validateQuery(
      request,
      AdminListQuerySchema
    );

    const roleParam = request.nextUrl.searchParams.get("role");
    const statusParam = request.nextUrl.searchParams.get("status");

    await connectDB();

    const skip = (page - 1) * limit;

    const andConditions: Record<string, unknown>[] = [];

    // Search is now sanitized by the schema
    if (search) {
      andConditions.push({
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      });
    }

    if (roleParam && roleParam !== "all") {
      andConditions.push({ role: roleParam });
    } else if (
      statusParam &&
      statusParam !== "all" &&
      Object.values(USER_ROLES).includes(
        statusParam as (typeof USER_ROLES)[keyof typeof USER_ROLES]
      )
    ) {
      // Backward compatibility with older clients using `status` as role.
      andConditions.push({ role: statusParam });
    }

    if (
      statusParam &&
      statusParam !== "all" &&
      Object.values(USER_ACCOUNT_STATUS).includes(
        statusParam as (typeof USER_ACCOUNT_STATUS)[keyof typeof USER_ACCOUNT_STATUS]
      )
    ) {
      if (statusParam === USER_ACCOUNT_STATUS.ACTIVE) {
        andConditions.push({
          $or: [
            { status: USER_ACCOUNT_STATUS.ACTIVE },
            { status: { $exists: false } },
            { status: null },
          ],
        });
      } else {
        andConditions.push({ status: statusParam });
      }
    }

    const query: Record<string, unknown> =
      andConditions.length === 0
        ? {}
        : andConditions.length === 1
          ? andConditions[0]
          : { $and: andConditions };

    const [users, total] = await Promise.all([
      User.find(query)
        .select("-password")
        .sort({ createdAt: sortOrder === "asc" ? 1 : -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query),
    ]);

    return paginatedResponse(users, page, limit, total);
  } catch (error) {
    return handleApiError(error);
  }
}
