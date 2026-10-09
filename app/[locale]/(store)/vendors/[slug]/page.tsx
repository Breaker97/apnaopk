import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { appConfig } from "@/config/app.config";
import { VendorStorefront } from "@/components/store/vendor-storefront";
import {
  getStorefrontIcons,
  getStorefrontMetadataSettings,
  buildStorefrontAlternates,
  buildStorefrontUrl,
  normalizeMetadataText,
  truncateMetadataText,
} from "@/lib/storefront/storefront-metadata";
import { getStorefrontVendorBySlug } from "@/lib/storefront/storefront-vendors";
import { formatVendorAddress } from "@/lib/vendors/vendor-address";
import { getVendorStorefrontPage } from "@/lib/vendors/vendor-store-page-read";

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function resolveBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const [vendor, storeMetadata] = await Promise.all([
    getStorefrontVendorBySlug(String(slug)),
    getStorefrontMetadataSettings(),
  ]);

  if (!vendor) return {};

  // The vendor's own search preview (page settings); each empty value falls
  // back to what the page has always used.
  const { seo } = (await getVendorStorefrontPage(vendor.id)).settings;

  const baseUrl = resolveBaseUrl();
  const page = `/vendors/${slug}`;
  const address = formatVendorAddress(
    vendor.address,
    vendor.addressDisplay,
    locale,
  );

  const title =
    normalizeMetadataText(seo.title) ||
    normalizeMetadataText(vendor.storeName) ||
    storeMetadata.storeName;
  // A store's own words first; otherwise a description that at least says where
  // it trades from, which tells a searcher more than a bare store name.
  const description =
    truncateMetadataText(
      normalizeMetadataText(
        seo.description ||
          vendor.description ||
          (address?.short
            ? `Shop ${vendor.storeName} — ${address.short}.`
            : `Shop products from ${vendor.storeName}.`),
      ),
      160,
    ) || appConfig.description;

  // The vendor's chosen share image, then their artwork, then the store's OG
  // image. No bundled fallback — the app's own branding must never stand in
  // for a merchant's link preview.
  const images = seo.image
    ? [seo.image]
    : vendor.banner
      ? [vendor.banner]
      : vendor.logo
        ? [vendor.logo]
        : storeMetadata.seo.ogImage
          ? [storeMetadata.seo.ogImage]
          : [];

  const twitterHandle = storeMetadata.social?.twitterHandle;

  return {
    title,
    description,
    metadataBase: new URL(baseUrl),
    alternates: await buildStorefrontAlternates({ locale, page }),
    openGraph: {
      type: "website",
      title,
      description,
      url: await buildStorefrontUrl(locale, page),
      siteName: storeMetadata.storeName,
      images:
        images.length > 0
          ? images.map((url) => ({ url, alt: vendor.storeName }))
          : undefined,
      locale,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: images.length > 0 ? images : undefined,
      ...(twitterHandle ? { site: `@${twitterHandle}` } : {}),
    },
    icons: getStorefrontIcons(storeMetadata),
  };
}

export default async function VendorStorefrontPage({
  params,
  searchParams,
}: PageProps) {
  const { locale, slug } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  const vendor = await getStorefrontVendorBySlug(String(slug));
  if (!vendor) notFound();

  // The vendor's landing page (Vendor CMS): published sections and the live
  // page settings. A vendor who never opened the editor gets an empty page and
  // default settings, which draw the store exactly as before.
  const storePage = await getVendorStorefrontPage(vendor.id);

  return (
    <VendorStorefront
      locale={locale}
      vendor={vendor}
      search={search}
      basePath={`/${locale}/vendors/${vendor.slug}`}
      homeSections={storePage.sections}
      pageSettings={storePage.settings}
    />
  );
}
