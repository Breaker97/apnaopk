import { setRequestLocale } from "next-intl/server";
import { getAdminTeamAccess, requireAdminArea } from "@/lib/access/admin-page-guard";
import { resolveTeamGrantScope } from "@/lib/access/team-member-roles";
import { TeamRoleEditor } from "@/components/admin/team/team-role-editor";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditTeamRolePage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await requireAdminArea(locale, "/admin/staff/roles");
  const grantScope = await resolveTeamGrantScope(await getAdminTeamAccess(session.user.id));
  return <TeamRoleEditor locale={locale} roleId={id} grantScope={grantScope} />;
}
