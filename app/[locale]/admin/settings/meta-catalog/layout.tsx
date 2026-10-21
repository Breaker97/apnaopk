import { requireAdminArea } from "@/lib/access/admin-page-guard";

/**
 * Opens /admin/settings/meta-catalog to the administrators whose team role reaches it
 * (lib/access/team-route-permissions.ts); anyone else lands on the first area
 * they do reach.
 */
export default async function AdminSettingsMetaCatalogAreaLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireAdminArea(locale, "/admin/settings/meta-catalog");
  return children;
}
