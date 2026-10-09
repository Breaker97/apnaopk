import { setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { FooterWorkspace } from "@/components/admin/online-store/footer-studio/footer-workspace";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function OnlineStoreMenusFooterPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  return <FooterWorkspace locale={locale} />;
}
