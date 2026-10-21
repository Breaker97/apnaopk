import { themeScopeVersions } from "@/lib/theme-colors/settings-write";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { resolveBrand } from "@/lib/branding/brand";
import { connectDB } from "@/lib/db";
import { sanitizeSettings } from "@/lib/settings/sanitize-settings";
import { AdminSettingsProvider } from "@/components/admin/settings/admin-settings-context";
import {
  getActiveThemeManifest,
  resolveActiveTheme,
} from "@/lib/storefront/themes/registry";
import { adoptThemeKeyColors, ownKeyColorDefaults } from "@/lib/storefront/themes/tokens";
import { getSettings } from "@/models/settings.model";
import { Product } from "@/models/product.model";
import { PRODUCT_STATUS } from "@/config/app.config";
import { getStorefrontProductConstraint } from "@/lib/catalog/product-visibility";
import { ThemeEditor } from "@/components/admin/theme-editor/theme-editor";

/**
 * One product a shopper can open, for the preview's "Product page" entry —
 * where sale prices, stars, stock and the buy buttons sit together. None
 * (an empty catalogue, or a failed read) simply leaves the entry out.
 */
async function sampleProductPath(): Promise<string | undefined> {
  try {
    const product = await Product.findOne({
      ...(await getStorefrontProductConstraint()),
      status: PRODUCT_STATUS.ACTIVE,
    })
      .sort({ featured: -1, updatedAt: -1 })
      .select("slug")
      .lean<{ slug?: string } | null>();
    return product?.slug ? `/products/${encodeURIComponent(product.slug)}` : undefined;
  } catch {
    return undefined;
  }
}

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
  // The editor's palette library lives in the brand (`appearance.*`), read
  // through the same settings store the Settings area uses; seeding it
  // server-side means no skeleton flash where the palettes belong.
  const [settings, samplePath] = await Promise.all([getSettings(), sampleProductPath()]);
  // JSON-normalized like getSanitizedSettings: the raw document carries an
  // ObjectId and Dates, which a Client Component prop cannot take.
  const sanitizedSettings = JSON.parse(JSON.stringify(sanitizeSettings(settings))) as Record<string, unknown>;
  const theme = resolveActiveTheme(settings.onlineStore);
  const manifest = getActiveThemeManifest(theme.id);
  const brand = resolveBrand(settings);
  // A theme without i18n copy falls back to its manifest name.
  const nameKey = `admin.onlineStoreThemePage.themes.${theme.id}.name`;
  const themeName = t.has(nameKey) ? t(nameKey) : manifest.name;

  return (
    <AdminSettingsProvider initialSettings={sanitizedSettings}>
      <ThemeEditor
        locale={locale}
        themeId={theme.id}
        themeName={themeName}
        // The theme's own key colours: a theme still following the old
        // store-wide brand opens adopted (the same colours, now its own), and
        // its first save stores them so (adoptThemeKeyColors).
        defaults={ownKeyColorDefaults(theme.defaults)}
        initialTokens={adoptThemeKeyColors(theme.tokens, brand.colors)}
        initialVersions={themeScopeVersions(settings.onlineStore?.themeSettings?.[theme.id],settings.appearance)}
        brand={brand.colors}
        samplePath={samplePath}
      />
    </AdminSettingsProvider>
  );
}
