import { setRequestLocale } from "next-intl/server";
import { CampaignBannersTable } from "@/components/admin/campaign-banners/campaign-banners-table";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/** Online Store → Campaign Banner: the popups and bars on the store's Home page. */
export default async function AdminCampaignBannersPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);

  return (
    <div className="w-full space-y-4">
      <CampaignBannersTable
        scope={{
          apiBase: "/api/admin/campaign-banners",
          basePath: "/admin/online-store/campaign-banners",
          canEdit: true,
          vendor: false,
        }}
      />
    </div>
  );
}
