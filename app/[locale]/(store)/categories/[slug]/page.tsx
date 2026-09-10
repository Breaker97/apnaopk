import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { appConfig } from "@/config/app.config";
import { type Locale } from "@/config/i18n.config";
import { resolveRequestLocation } from "@/lib/locations/resolve-request-location";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import { StoreSections } from "@/components/store/store-sections";
import { getTemplateSections } from "@/lib/storefront/pages/get-template";
import type { SectionRenderContext } from "@/lib/storefront/sections/types";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import {
  buildStorefrontAlternates,
  getStorefrontIcons,
  getStorefrontMetadataSettings,
  normalizeMetadataText,
  truncateMetadataText,
} from "@/lib/storefront/storefront-metadata";
import { getStorefrontCategoryBySlug } from "@/lib/storefront/storefront-categories";

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

async function getCategory(slug: string) {
  return getStorefrontCategoryBySlug(slug);
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const [category, storeMetadata] = await Promise.all([
    getCategory(slug),
    getStorefrontMetadataSettings(),
  ]);

  if (!category) return {};

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const page = `/categories/${slug}`;
  const title =
    normalizeMetadataText(category.seo?.pageTitle || category.name) ||
    storeMetadata.storeName;
  const description =
    truncateMetadataText(
      normalizeMetadataText(
        category.seo?.metaDescription ||
          category.description ||
          storeMetadata.seo.metaDescription ||
          storeMetadata.storeDescription ||
          appConfig.description,
      ),
      160,
    ) || appConfig.description;
  const keywords =
    Array.isArray(category.seo?.tags) && category.seo.tags.length > 0
      ? category.seo.tags
      : storeMetadata.seo.metaKeywords;
  // Category artwork, then the store's OG image — no bundled fallback, so a
  // store that configured neither shares a link without this app's artwork.
  const images = category.image
    ? [category.image]
    : category.icon
      ? [category.icon]
      : storeMetadata.seo.ogImage
        ? [storeMetadata.seo.ogImage]
        : [];

  return {
    title,
    description,
    keywords,
    authors: [{ name: storeMetadata.storeName }],
    creator: storeMetadata.storeName,
    publisher: storeMetadata.storeName,
    metadataBase: new URL(baseUrl),
    alternates: await buildStorefrontAlternates({ locale, page }),
    openGraph: {
      title,
      description,
      url: `${baseUrl}/${locale}${page}`,
      siteName: storeMetadata.storeName,
      images:
        images.length > 0
          ? images.map((url) => ({ url, width: 1200, height: 630, alt: title }))
          : undefined,
      locale,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: images.length > 0 ? images : undefined,
    },
    robots: { index: true, follow: true },
    icons: getStorefrontIcons(storeMetadata),
  };
}

export default async function CategoryDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { locale, slug } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  // The page's own location pill points at the grid, so the template has to
  // honour the location — otherwise the control says "Seattle" over an
  // unfiltered category.
  const location = resolveRequestLocation(search);
  const [t, category, template, storefront] = await Promise.all([
    getTranslations({ locale }),
    getCategory(slug),
    getTemplateSections("category"),
    getStorefrontSettings(),
  ]);

  if (!category) {
    notFound();
  }

  // The category TEMPLATE renders everything below the breadcrumb:
  // category-header (deletable, replaceable with a custom hero) +
  // category-main (the locked grid core) by default.
  const ctx: SectionRenderContext = {
    locale: locale as Locale,
    defaultLanguage: storefront.defaultLanguage,
    isMultiVendorEnabled: storefront.isMultiVendorEnabled,
    themeId: storefront.theme.id,
    themeSettings: storefront.theme.settings,
    templateType: "category",
    resource: { type: "category", category, searchParams: search, location },
  };

  return (
    <div className="pb-8">
      <div className="container mx-auto px-4 pt-8">
        <StoreBreadcrumb
          locale={locale}
          items={[
            { label: t("common.categories"), href: "/categories" },
            { label: category.name },
          ]}
        />
      </div>

      <StoreSections sections={template.sections} ctx={ctx} />
    </div>
  );
}
