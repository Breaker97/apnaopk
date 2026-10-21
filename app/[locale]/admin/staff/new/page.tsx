import { setRequestLocale } from "next-intl/server";
import { StaffForm } from "@/components/admin/staff-form";
import { getAdminTeamAccess, requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { teamHasAny } from "@/lib/access/team-permissions";
import { resolveTeamGrantScope } from "@/lib/access/team-member-roles";
import { ADMIN_AREA_PERMISSIONS } from "@/config/team-permissions.config";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NewStaffPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await requireAdminPageAccess(locale);
  const access = await getAdminTeamAccess(session.user.id);
  // "Save as a role" on the member's Role card needs Manage roles.
  const canManageRoles = teamHasAny(access, [ADMIN_AREA_PERMISSIONS.MANAGE_ROLES]);
  // The roles and permissions the Role card offers: only what they may give.
  const grantScope = await resolveTeamGrantScope(access);

  return <StaffForm locale={locale} canManageRoles={canManageRoles} grantScope={grantScope} />;
}
