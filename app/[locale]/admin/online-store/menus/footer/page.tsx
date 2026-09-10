import { setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { FooterBuilder } from "@/components/admin/online-store/footer-builder";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function OnlineStoreMenusFooterPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  return <FooterBuilder locale={locale} />;
}
