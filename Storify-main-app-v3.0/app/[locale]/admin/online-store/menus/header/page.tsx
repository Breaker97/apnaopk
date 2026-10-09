import { setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { HeaderStudio } from "@/components/admin/online-store/header-studio/header-studio";
import { getDraftGroupSections } from "@/lib/storefront/pages/get-template";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function OnlineStoreMenusHeaderPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  // The announcement bar and the top tags strip are section instances on the
  // header group document. The studio shows them as pinned rows above and
  // below the layout, edits them in place, and publishes them back through
  // the group's draft → publish routes.
  const chromeSections = await getDraftGroupSections("header");

  return (
    <HeaderStudio
      initialChromeSections={JSON.parse(JSON.stringify(chromeSections))}
    />
  );
}
