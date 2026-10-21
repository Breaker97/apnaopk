import { setRequestLocale } from "next-intl/server";
import { CampaignBannerEditor } from "@/components/admin/campaign-banners/campaign-banner-editor";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditAdminCampaignBannerPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);

  return (
    <CampaignBannerEditor
      bannerId={id}
      scope={{
          apiBase: "/api/admin/campaign-banners",
          basePath: "/admin/online-store/campaign-banners",
          canEdit: true,
          vendor: false,
        }}
    />
  );
}
