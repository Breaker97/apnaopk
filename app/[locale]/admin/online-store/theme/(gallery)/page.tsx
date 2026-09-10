import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { connectDB } from "@/lib/db";
import { getSanitizedSettings } from "@/lib/settings/sanitize-settings";
import {
  resolveActiveTheme,
  THEME_MANIFESTS,
} from "@/lib/storefront/themes/registry";
import { getSettings } from "@/models/settings.model";
import { AdminSettingsProvider } from "@/components/admin/settings/admin-settings-context";
import { isThemePageTab } from "@/lib/storefront/themes/page-tabs";
import { ThemeGallery } from "@/components/admin/store-pages/theme-gallery";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}

export default async function OnlineStoreThemePage({
  params,
  searchParams,
}: PageProps) {
  const [{ locale }, { tab }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const t = await getTranslations({ locale });

  await requireAdminPageAccess(locale);

  await connectDB();
  const [settings, sanitizedSettings] = await Promise.all([
    getSettings(),
    // The Branding tab edits the brand through the same settings store the
    // Settings area uses; seeding it server-side means no skeleton flash.
    getSanitizedSettings(),
  ]);
  const theme = resolveActiveTheme(settings.onlineStore);
  const requestedTab = Array.isArray(tab) ? tab[0] : tab;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("admin.onlineStoreThemePage.title")}
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
          {t("admin.onlineStoreThemePage.description")}
        </p>
      </div>

      <AdminSettingsProvider initialSettings={sanitizedSettings}>
        <ThemeGallery
          locale={locale}
          // Presets are seed data for the activation API, not gallery UI —
          // strip them so the admin payload stays a card list, not templates.
          manifests={THEME_MANIFESTS.map(({ presets, ...manifest }) => ({
            ...manifest,
            // Presets themselves stay server-side; the gallery only needs to
            // know whether the activation dialog should offer the starter.
            hasStarter: Boolean(
              presets?.templates &&
                Object.keys(presets.templates).length > 0,
            ),
          }))}
          activeThemeId={theme.id}
          initialTab={isThemePageTab(requestedTab) ? requestedTab : "theme"}
        />
      </AdminSettingsProvider>
    </div>
  );
}
