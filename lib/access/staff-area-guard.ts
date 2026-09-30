import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { USER_ACCOUNT_STATUS, USER_ROLES } from "@/config/app.config";
import { connectDB } from "@/lib/db";
import { StaffProfile, User } from "@/models";
import type { StaffPermission } from "@/config/permissions.config";
import { normalizeStaffScope } from "@/lib/access/staff-scope";
import { effectiveStaffPermissions } from "@/lib/access/staff-authz";
import { isVendorOwnedStaffProfile } from "@/lib/access/staff-ownership";
import { buildLoginUrl, returnPathFromHeaders } from "@/lib/auth/return-path";
import { localeHref } from "@/lib/i18n/locale-routing";

export async function requireStaffAreaAccess(params: {
  locale: string;
  required?: StaffPermission[];
  mode?: "any" | "all";
}) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    redirect(
      await localeHref(
        params.locale,
        buildLoginUrl(
          params.locale,
          returnPathFromHeaders(requestHeaders) ?? "/staff/dashboard",
        ),
      ),
    );
  }

  if (
    session.user.role !== USER_ROLES.STAFF &&
    session.user.role !== USER_ROLES.SELLER
  ) {
    redirect("/");
  }

  await connectDB();
  const [profile, user] = await Promise.all([
    StaffProfile.findOne({ userId: session.user.id, isActive: true })
      .select("permissions managedBy vendorIds locationIds fulfillmentRegions")
      .lean(),
    User.findById(session.user.id).select("status").lean(),
  ]);

  const status = (user as { status?: string } | null)?.status;
  if (
    status &&
    status !== USER_ACCOUNT_STATUS.ACTIVE
  ) {
    redirect("/forbidden");
  }

  if (!profile) {
    redirect("/forbidden");
  }

  const staffPermissions = effectiveStaffPermissions(
    profile as { permissions?: unknown; managedBy?: unknown; vendorIds?: unknown[] },
  );
  const staffScope = normalizeStaffScope({
    vendorIds: (profile as { vendorIds?: unknown[] }).vendorIds?.map(String),
    locationIds: (profile as { locationIds?: unknown[] }).locationIds?.map(String),
    fulfillmentRegions: (
      profile as { fulfillmentRegions?: unknown[] }
    ).fulfillmentRegions?.map(String),
    wholeOrdersOnly: isVendorOwnedStaffProfile(
      profile as { managedBy?: unknown; vendorIds?: unknown[] },
    ),
  });

  const required = params.required || [];
  if (required.length) {
    const mode = params.mode || "any";
    const ok =
      mode === "all"
        ? required.every((p) => staffPermissions.includes(p))
        : required.some((p) => staffPermissions.includes(p));
    if (!ok) redirect("/forbidden");
  }

  return { session, staffPermissions, staffScope };
}
