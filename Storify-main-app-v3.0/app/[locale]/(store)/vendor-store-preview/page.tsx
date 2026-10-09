import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { DraftPreviewPill } from "@/components/store/draft-preview-pill";
import { SectionPreviewBridge } from "@/components/store/section-preview-bridge";
import { StoreSections } from "@/components/store/store-sections";
import { VendorStorefront } from "@/components/store/vendor-storefront";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { getStorefrontVendorBySlug } from "@/lib/storefront/storefront-vendors";
import {
  accentStyle,
  VENDOR_STORE_PREVIEW_SEGMENT,
} from "@/lib/vendors/vendor-store-page";
import { loadVendorPagePreview } from "@/lib/vendors/vendor-store-page-preview";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/** The vendor's own scaffolding; never something a crawler should keep. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * The signed-in vendor's DRAFT landing page, drawn by the real storefront
 * page (VendorStorefront) inside the real store chrome — what the Vendor CMS
 * builder's Preview button and live panel show. Only the vendor themself can
 * open it; everyone else gets a 404. Its tabs link back here, so the vendor
 * can look at the other tabs without leaving the preview.
 */
export default async function VendorStorePreviewPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const preview = await loadVendorPagePreview();
  if (!preview) notFound();

  const [vendor, search] = await Promise.all([
    getStorefrontVendorBySlug(preview.slug),
    searchParams,
  ]);

  if (!vendor) {
    // The store is not public yet (unpaid setup, paused): there is no store
    // header to draw, so the draft sections preview on their own.
    const settings = await getStorefrontSettings();
    return (
      <div style={accentStyle(preview.settings.accentColor)}>
        <StoreSections
          sections={preview.sections}
          editable
          ctx={{
            locale: locale as Locale,
            defaultLanguage: settings.defaultLanguage,
            isMultiVendorEnabled: settings.isMultiVendorEnabled,
            themeId: settings.theme.id,
            themeSettings: settings.theme.settings,
            vendor: { id: preview.vendorId, slug: preview.slug },
            preview: true,
          }}
        />
        <SectionPreviewBridge />
      </div>
    );
  }

  return (
    <>
      <VendorStorefront
        locale={locale}
        vendor={vendor}
        search={search}
        basePath={`/${locale}/${VENDOR_STORE_PREVIEW_SEGMENT}`}
        homeSections={preview.sections}
        pageSettings={preview.settings}
        preview
      />
      <DraftPreviewPill
        locale={locale as Locale}
        livePath={`/${locale}/vendors/${vendor.slug}`}
      />
      <SectionPreviewBridge />
    </>
  );
}
