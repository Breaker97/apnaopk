import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { SectionPreviewSizer } from "@/components/store/section-preview-sizer";
import { StoreSections } from "@/components/store/store-sections";
import { pickPreviewSection } from "@/lib/storefront/pages/draft-preview";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { accentStyle } from "@/lib/vendors/vendor-store-page";
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
 * ONE section of the signed-in vendor's draft landing page (`?section=<id>`,
 * optionally `&block=<id>`) — the frame at the top of each Vendor CMS builder
 * row, the vendor's counterpart of /section-preview. Chrome-less, through the
 * same (preview) layout. Anyone but the vendor gets a 404.
 */
export default async function VendorSectionPreviewPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const preview = await loadVendorPagePreview();
  if (!preview) notFound();

  const query = await searchParams;
  const sectionId = typeof query.section === "string" ? query.section : "";
  const blockId = typeof query.block === "string" ? query.block : "";
  if (!sectionId) notFound();

  const settings = await getStorefrontSettings();

  return (
    <div data-section-preview style={accentStyle(preview.settings.accentColor)}>
      <StoreSections
        sections={pickPreviewSection(preview.sections, sectionId, blockId)}
        page={preview.sections}
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
      <SectionPreviewSizer />
    </div>
  );
}
