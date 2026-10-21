import { setRequestLocale } from "next-intl/server";
import { requireAdminArea, getAdminTeamAccess } from "@/lib/access/admin-page-guard";
import { listTeamRoles } from "@/lib/access/team-role-service";
import { teamHasAny } from "@/lib/access/team-permissions";
import { ADMIN_AREA_PERMISSIONS } from "@/config/team-permissions.config";
import { TeamRolesList } from "@/components/admin/team/team-roles-list";
import { connectDB } from "@/lib/db";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminTeamRolesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireAdminArea(locale, "/admin/staff/roles");
  await connectDB();
  const [roles, access] = await Promise.all([listTeamRoles(), getAdminTeamAccess(session.user.id)]);
  return (
    <TeamRolesList
      roles={roles}
      canManage={teamHasAny(access, [ADMIN_AREA_PERMISSIONS.MANAGE_ROLES])}
    />
  );
}
