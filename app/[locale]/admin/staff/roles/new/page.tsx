import { setRequestLocale } from "next-intl/server";
import { getAdminTeamAccess, requireAdminArea } from "@/lib/access/admin-page-guard";
import { resolveTeamGrantScope } from "@/lib/access/team-member-roles";
import { TeamRoleEditor } from "@/components/admin/team/team-role-editor";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NewTeamRolePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireAdminArea(locale, "/admin/staff/roles/new");
  const grantScope = await resolveTeamGrantScope(await getAdminTeamAccess(session.user.id));
  return <TeamRoleEditor locale={locale} grantScope={grantScope} />;
}
