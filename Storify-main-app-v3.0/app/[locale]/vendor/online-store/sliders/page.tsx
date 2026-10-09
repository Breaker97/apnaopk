import { AlertCircle } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { WarningBanner } from "@/components/ui/warning-banner";
import { VendorSlidersManager } from "@/components/vendor/online-store/vendor-sliders-manager";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { resolveBrand } from "@/lib/branding/brand";
import { compileTheme } from "@/lib/storefront/themes/compile";
import { resolveActiveTheme } from "@/lib/storefront/themes/registry";
import { getSettings } from "@/models/settings.model";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Online Store → Sliders: the vendor's own slide groups, placed on their
 * landing page with the Slider section. Same editor and lifecycle (draft →
 * publish → history) as the admin's Sliders screen.
 */
export default async function VendorSlidersPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.VIEW_STORE_SETTINGS],
  });
  const canEdit =
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS) ||
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.EDIT_STORE_SETTINGS);

  // The marketplace's active theme, compiled, so the canvas and previews
  // stand on the ground the vendor's page is drawn on.
  const [settings, t] = await Promise.all([
    getSettings(),
    getTranslations({ locale }),
  ]);
  const theme = resolveActiveTheme(settings.onlineStore);
  const surface = compileTheme(theme.tokens, resolveBrand(settings).colors);
  const defaultLanguage = settings.general?.defaultLanguage || "en";
  const supported: string[] = settings.general?.supportedLanguages ?? [];
  const languages = supported.includes(defaultLanguage)
    ? [defaultLanguage, ...supported.filter((code) => code !== defaultLanguage)]
    : [defaultLanguage, ...supported];

  return (
    <div className="w-full space-y-4">
      {!canEdit ? (
        <WarningBanner icon={AlertCircle}>
          {t.has("vendor.landingPage.readOnly")
            ? t("vendor.landingPage.readOnly")
            : "You can look around, but your store's access does not include changing the online store. Contact the marketplace team to have it turned on."}
        </WarningBanner>
      ) : null}
      <VendorSlidersManager
        locale={locale}
        storeSurface={{ vars: surface.vars, attributes: surface.attributes }}
        languages={languages}
        defaultLanguage={defaultLanguage}
      />
    </div>
  );
}
