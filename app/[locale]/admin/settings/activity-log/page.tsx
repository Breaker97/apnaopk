import { setRequestLocale } from "next-intl/server";
import { ActivityLogListView } from "@/components/admin/activity-log/activity-log-list-view";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * The Activity Log, every row of it. Admin only: platform staff never read the
 * log, so there is no staff page and no staff permission. A vendor reads its own
 * team's part at /vendor/activity-log.
 *
 * Lives under Settings (Store, after Multi-Vendor), so the settings menu stays
 * beside it: the log is the whole store's, not the team's. The settings layout
 * has already admitted an admin; the page asks again, because a layout is not a
 * guard for the page beneath it.
 */
export default async function AdminActivityLogPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  return <ActivityLogListView area="admin" searchParams={search} />;
}
