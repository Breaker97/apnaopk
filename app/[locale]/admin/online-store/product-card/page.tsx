import { setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { resolveBrand } from "@/lib/branding/brand";
import { buildPageSwitcher } from "@/lib/storefront/pages/page-switcher";
import { compileTheme } from "@/lib/storefront/themes/compile";
import { resolveActiveTheme } from "@/lib/storefront/themes/registry";
import { ProductCardBuilder } from "@/components/admin/online-store/product-card-builder";
import { getSettings } from "@/models/settings.model";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * The product card configurator — reached from the Customize page switcher
 * (a `nav:` entry, like Checkout). One store-wide card design: element
 * order/grouping, visibility toggles, and style, seeded from fixed templates.
 *
 * It carries the SAME page switcher as the section builder, so this editor
 * is a stop on the tour rather than a dead end the merchant has to use the
 * browser's back button to leave.
 *
 * The ACTIVE THEME is compiled and handed down so the preview stands on the
 * storefront's own ground — its background, palette, radii and page width —
 * instead of an admin-grey panel. Without it a merchant reads the card
 * against the wrong colours and sizes it against nothing.
 */
export default async function OnlineStoreProductCardPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  const settings = await getSettings();
  const theme = resolveActiveTheme(settings.onlineStore);
  const surface = compileTheme(theme.tokens, resolveBrand(settings).colors);
  const switcher = await buildPageSwitcher(
    locale,
    "nav:/admin/online-store/product-card",
    settings.general?.defaultLanguage || "en",
  );

  return (
    <ProductCardBuilder
      locale={locale}
      switcher={switcher}
      storeSurface={{ vars: surface.vars, attributes: surface.attributes }}
    />
  );
}
