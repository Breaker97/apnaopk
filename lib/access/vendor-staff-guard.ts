import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { USER_ROLES } from "@/config/app.config";
import type { VendorPermission } from "@/config/permissions.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { hasVendorPermission } from "@/lib/access/rbac";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
} from "@/lib/api/errors";

/**
 * The gate every vendor-area staff endpoint shares: an approved vendor, multi-
 * vendor mode on, and at least one of the listed vendor permissions. Extracted
 * from the staff detail route so the staff sub-routes (orders, notes) enforce
 * exactly the same thing rather than a lookalike.
 */
export async function requireVendorStaffPermission(
  request: NextRequest,
  permissions: VendorPermission[],
  limiterKey: string,
  limiterMode: "lenient" | "moderate" | "strict",
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new AuthenticationError();
  if (session.user.role !== USER_ROLES.VENDOR) throw new AuthorizationError();

  await rateLimitByUser(
    request,
    session.user.id,
    limiterKey,
    limiterMode,
    session.user.role,
  );

  await connectDB();
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

  const vendor = await requireApprovedVendorByUserId(session.user.id);
  const ok = await Promise.all(
    permissions.map((permission) =>
      hasVendorPermission(
        session.user as unknown as {
          id?: string;
          role?: typeof USER_ROLES.VENDOR;
        },
        permission,
      ),
    ),
  );
  if (!ok.some(Boolean)) throw new AuthorizationError();

  return { session, vendor };
}
