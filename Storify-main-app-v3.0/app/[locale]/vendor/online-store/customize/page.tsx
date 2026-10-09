import { AlertCircle } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { VENDOR_STATUS } from "@/config/app.config";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { StorePageBuilder } from "@/components/admin/store-pages/store-page-builder";
import { WarningBanner } from "@/components/ui/warning-banner";
import { VendorLandingPageActions } from "@/components/vendor/online-store/vendor-landing-page-actions";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { connectDB } from "@/lib/db";
import {
  isDemoModeEnabled,
  STORE_BUILDER_DEMO_MODE_MESSAGE,
} from "@/lib/demo-mode";
import { localeHref } from "@/lib/i18n/locale-routing";
import { sectionsEqual } from "@/lib/storefront/pages/lifecycle";
import { getSectionCatalog } from "@/lib/storefront/sections/catalog";
import { normalizeSectionInstance } from "@/lib/storefront/sections/normalize";
import { getSectionDefinition } from "@/lib/storefront/sections/registry";
import type { SectionInstance } from "@/lib/storefront/sections/types";
import {
  getActiveThemeManifest,
  resolveActiveTheme,
} from "@/lib/storefront/themes/registry";
import {
  isVendorPageSectionType,
  normalizeVendorPageSettings,
  VENDOR_PAGE_HIDDEN_FIELDS,
} from "@/lib/vendors/vendor-store-page";
import { vendorPageSections } from "@/lib/vendors/vendor-store-page-read";
import { Vendor } from "@/models";
import { getSettings } from "@/models/settings.model";
import { VendorStorePage } from "@/models/vendor-store-page.model";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Online Store → Customize, the Vendor CMS: the signed-in vendor designs the
 * Home tab of their own storefront (/vendors/<slug>) with the admin's page
 * builder, scoped to the vendor's routes and sections. The marketplace's own
 * pages are edited only in the admin's Customize screen; nothing here
 * reaches them.
 *
 * Viewing needs "view store settings"; without "edit store settings" the
 * builder opens read-only (edits stay in the browser, nothing saves).
 */
export default async function VendorCustomizePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.VIEW_STORE_SETTINGS],
  });
  const canEdit =
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS) ||
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.EDIT_STORE_SETTINGS);

  await connectDB();
  const vendorId = String(access.vendor._id);
  const [settings, doc, vendor, t] = await Promise.all([
    getSettings(),
    VendorStorePage.findOne({ vendorId }).lean(),
    Vendor.findById(vendorId)
      .select("slug status storeActive storeName description banner logo")
      .lean<{
        slug?: string;
        status?: string;
        storeActive?: boolean;
        storeName?: string;
        description?: string;
        banner?: string;
        logo?: string;
      } | null>(),
    getTranslations({ locale }),
  ]);

  const defaultLanguage = settings.general?.defaultLanguage || "en";
  const supported = settings.general?.supportedLanguages ?? [];
  const languages = supported.includes(defaultLanguage)
    ? supported
    : [defaultLanguage, ...supported];

  const stored = Array.isArray(doc?.draft?.sections)
    ? doc.draft.sections
    : doc?.published?.sections;
  const draftSections = migrateForEditor(vendorPageSections(stored ?? []));
  const isPublished = Boolean(doc?.published);
  const hasUnpublishedChanges = isPublished
    ? !sectionsEqual(draftSections, vendorPageSections(doc?.published?.sections))
    : true;

  // The catalogue with the vendor-only sections, narrowed to what a vendor
  // may place, with the fields the vendor builder does not offer taken out
  // (the banner's slides, the category row's marketplace source).
  const catalog = getSectionCatalog(
    { isMultiVendorEnabled: true },
    getActiveThemeManifest(resolveActiveTheme(settings.onlineStore).id)
      .preferredVariants,
    { vendorPage: true },
  )
    .filter((entry) => isVendorPageSectionType(entry.type))
    .map((entry) => {
      const hidden = VENDOR_PAGE_HIDDEN_FIELDS[entry.type];
      return hidden
        ? {
            ...entry,
            fields: entry.fields.filter((field) => !hidden.includes(field.key)),
          }
        : entry;
    });

  const storeIsPublic =
    vendor?.status === VENDOR_STATUS.APPROVED && vendor.storeActive !== false;
  const storeUrl =
    storeIsPublic && vendor?.slug
      ? await localeHref(locale, `/vendors/${vendor.slug}`)
      : null;

  const tr = (key: string, fallback: string) =>
    t.has(key) ? t(key as never) : fallback;

  const takenDown = Boolean(doc?.takedown?.at) && !isPublished;

  return (
    <div className="w-full space-y-4">
      {takenDown ? (
        <WarningBanner icon={AlertCircle}>
          {tr(
            "vendor.landingPage.takenDown",
            "The marketplace team unpublished your landing page. Review it, then publish again when it is ready.",
          )}
          {doc?.takedown?.reason ? ` (${doc.takedown.reason})` : null}
        </WarningBanner>
      ) : null}
      <StorePageBuilder
        scope="vendor"
        locale={locale}
        handle="home"
        heading={tr("vendor.landingPage.title", "Landing page")}
        initialSections={draftSections}
        initialIsPublished={isPublished}
        initialHasUnpublishedChanges={hasUnpublishedChanges}
        catalog={catalog}
        languages={languages}
        defaultLanguage={defaultLanguage}
        demoMode={{
          // Read-only reuses the builder's no-save mode: edits stay in the
          // browser and every save explains why it did not happen.
          enabled: isDemoModeEnabled() || !canEdit,
          message: canEdit
            ? STORE_BUILDER_DEMO_MODE_MESSAGE
            : tr(
                "vendor.landingPage.readOnly",
                "You can look around, but your store's access does not include changing the landing page. Contact the marketplace team to have it turned on.",
              ),
        }}
        actions={
          <VendorLandingPageActions
            storeUrl={storeUrl}
            initialSettings={normalizeVendorPageSettings(doc?.settings)}
            canEdit={canEdit && !isDemoModeEnabled()}
            // What the search preview falls back to, as the store page's
            // metadata does.
            storeName={vendor?.storeName ?? ""}
            storeDescription={vendor?.description ?? ""}
            storeImage={vendor?.banner || vendor?.logo || ""}
          />
        }
      />
    </div>
  );
}

/** Bring stored instances up to the current definitions, as Customize does. */
function migrateForEditor(sections: SectionInstance[]): SectionInstance[] {
  return sections.map((instance) => {
    const def = getSectionDefinition(instance.type);
    return def ? normalizeSectionInstance(def, instance) : instance;
  });
}
