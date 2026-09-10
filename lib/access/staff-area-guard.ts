import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { USER_ACCOUNT_STATUS, USER_ROLES } from "@/config/app.config";
import { connectDB } from "@/lib/db";
import { StaffProfile, User } from "@/models";
import type { StaffPermission } from "@/config/permissions.config";
import { normalizeStaffScope } from "@/lib/access/staff-scope";
import { buildLoginUrl, returnPathFromHeaders } from "@/lib/auth/return-path";

export async function requireStaffAreaAccess(params: {
  locale: string;
  required?: StaffPermission[];
  mode?: "any" | "all";
}) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    redirect(
      buildLoginUrl(
        params.locale,
        returnPathFromHeaders(requestHeaders) ??
          `/${params.locale}/staff/dashboard`,
      ),
    );
  }

  if (
    session.user.role !== USER_ROLES.STAFF &&
    session.user.role !== USER_ROLES.SELLER
  ) {
    redirect(`/${params.locale}`);
  }

  await connectDB();
  const [profile, user] = await Promise.all([
    StaffProfile.findOne({ userId: session.user.id, isActive: true })
      .select("permissions vendorIds locationIds fulfillmentRegions")
      .lean(),
    User.findById(session.user.id).select("status").lean(),
  ]);

  const status = (user as { status?: string } | null)?.status;
  if (
    status &&
    status !== USER_ACCOUNT_STATUS.ACTIVE
  ) {
    redirect(`/${params.locale}/forbidden`);
  }

  if (!profile) {
    redirect(`/${params.locale}/forbidden`);
  }

  const staffPermissions = Array.isArray((profile as { permissions?: unknown }).permissions)
    ? ((profile as { permissions?: unknown }).permissions as StaffPermission[])
    : [];
  const staffScope = normalizeStaffScope({
    vendorIds: (profile as { vendorIds?: unknown[] }).vendorIds?.map(String),
    locationIds: (profile as { locationIds?: unknown[] }).locationIds?.map(String),
    fulfillmentRegions: (
      profile as { fulfillmentRegions?: unknown[] }
    ).fulfillmentRegions?.map(String),
  });

  const required = params.required || [];
  if (required.length) {
    const mode = params.mode || "any";
    const ok =
      mode === "all"
        ? required.every((p) => staffPermissions.includes(p))
        : required.some((p) => staffPermissions.includes(p));
    if (!ok) redirect(`/${params.locale}/forbidden`);
  }

  return { session, staffPermissions, staffScope };
}
