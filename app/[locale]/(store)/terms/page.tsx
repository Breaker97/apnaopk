import { getLocaleRouting } from "@/lib/i18n/locale-routing";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ContentPageView } from "@/components/store/content-page-view";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function TermsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { storeDefault } = await getLocaleRouting();

  const { contentPages } = await getStorefrontSettings();
  if (!contentPages.terms.visible) {
    notFound();
  }

  return (
    <ContentPageView
      locale={locale}
      storeDefault={storeDefault}
      title={contentPages.terms.title}
      content={contentPages.terms.content}
    />
  );
}
