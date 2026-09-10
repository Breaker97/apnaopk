import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { ContentPageView } from "@/components/store/content-page-view";
import { StoreSections } from "@/components/store/store-sections";
import { getLandingPage } from "@/lib/storefront/pages/get-landing-page";
import { lt } from "@/lib/storefront/sections/localized";
import type { SectionRenderContext } from "@/lib/storefront/sections/types";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

interface PageProps {
  params: Promise<{ locale: string; handle: string }>;
}

/**
 * /pages/<handle> serves two generations of page:
 * 1. Theme-engine LANDING pages (section-built, published via the builder) —
 *    these win. Only the published state renders here; draft preview lives
 *    on the admin-gated /draft/<handle> route, so this page never touches a
 *    request API and stays cacheable.
 * 2. Legacy custom content pages from `settings.contentPages` — the
 *    fallback, and the migration path: rebuilding one as a landing page
 *    under the same handle replaces it without a URL change.
 */
export default async function StoreCustomPage({ params }: PageProps) {
  const { locale, handle } = await params;
  setRequestLocale(locale);

  const [settings, landing] = await Promise.all([
    getStorefrontSettings(),
    getLandingPage(handle),
  ]);

  if (landing) {
    const ctx: SectionRenderContext = {
      locale: locale as Locale,
      defaultLanguage: settings.defaultLanguage,
      isMultiVendorEnabled: settings.isMultiVendorEnabled,
      themeId: settings.theme.id,
      themeSettings: settings.theme.settings,
    };
    return <StoreSections sections={landing.sections} ctx={ctx} />;
  }

  const page = settings.contentPages.customPages.find(
    (item) => item.handle === handle && item.visible,
  );

  if (!page) {
    notFound();
  }

  return (
    <ContentPageView locale={locale} title={page.title} content={page.content} />
  );
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale, handle } = await params;
  const settings = await getStorefrontSettings();

  const landing = await getLandingPage(handle);
  if (landing) {
    const title = lt(landing.title, locale, settings.defaultLanguage);
    return { title: title || undefined };
  }

  const page = settings.contentPages.customPages.find(
    (item) => item.handle === handle && item.visible,
  );
  if (!page) return {};
  return {
    title: page.metaTitle || page.title || undefined,
    description: page.metaDescription || undefined,
  };
}
