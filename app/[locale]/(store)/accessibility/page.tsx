import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ContentPageView } from "@/components/store/content-page-view";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AccessibilityPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { contentPages } = await getStorefrontSettings();
  if (!contentPages.accessibility.visible) {
    notFound();
  }

  return (
    <ContentPageView
      locale={locale}
      title={contentPages.accessibility.title}
      content={contentPages.accessibility.content}
    />
  );
}
