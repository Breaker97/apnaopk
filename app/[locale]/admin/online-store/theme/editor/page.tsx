import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { resolveBrand } from "@/lib/branding/brand";
import { connectDB } from "@/lib/db";
import {
  getActiveThemeManifest,
  resolveActiveTheme,
} from "@/lib/storefront/themes/registry";
import { getSettings } from "@/models/settings.model";
import { ThemeEditor } from "@/components/admin/theme-editor/theme-editor";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Online Store → Themes → Theme settings: the token editor for the ACTIVE
 * theme. Its own route because it is a workspace — group rail, controls,
 * full-height live preview — not a settings form under the gallery.
 */
export default async function ThemeEditorPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });

  await requireAdminPageAccess(locale);

  await connectDB();
  const settings = await getSettings();
  const theme = resolveActiveTheme(settings.onlineStore);
  const manifest = getActiveThemeManifest(theme.id);
  const brand = resolveBrand(settings);
  // A theme without i18n copy falls back to its manifest name.
  const nameKey = `admin.onlineStoreThemePage.themes.${theme.id}.name`;
  const themeName = t.has(nameKey) ? t(nameKey) : manifest.name;

  return (
    <ThemeEditor
      locale={locale}
      themeId={theme.id}
      themeName={themeName}
      defaults={theme.defaults}
      initialTokens={theme.tokens}
      brand={brand.colors}
    />
  );
}
