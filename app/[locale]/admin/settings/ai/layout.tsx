import { requireAdminArea } from "@/lib/access/admin-page-guard";

/**
 * Opens /admin/settings/ai to the administrators whose team role reaches it
 * (lib/access/team-route-permissions.ts); anyone else lands on the first area
 * they do reach.
 */
export default async function AdminSettingsAiAreaLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireAdminArea(locale, "/admin/settings/ai");
  return children;
}
