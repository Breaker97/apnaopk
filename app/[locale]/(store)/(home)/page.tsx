import { setRequestLocale } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { DEFAULT_LANGUAGE } from "@/config/branding.config";
import { StoreSections } from "@/components/store/store-sections";
import {
  getDefaultHomeSections,
  getHomePageSections,
} from "@/lib/storefront/pages/get-home-page";
import type {
  SectionInstance,
  SectionRenderContext,
} from "@/lib/storefront/sections/types";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * The home page renders whatever the theme engine's home document (or, until
 * the migration runs, the mapped legacy `settings.homePage`) says: an ordered
 * list of section instances resolved against the section registry.
 *
 * Only the PUBLISHED state renders here — draft preview lives on its own
 * admin-gated /draft route, so this page never touches a request API and
 * stays fully cacheable for shoppers.
 *
 * It is deliberately **not** location-filtered.
 *
 * Every other listing narrows to the shopper's place, but this page is the
 * storefront's shop window: its job is to show the breadth of the catalogue,
 * and filtering it to one city empties most of the strips a store spent effort
 * curating. A shopper who wants "near me" reaches the filtered listings one
 * click away, where the location banner explains what is being narrowed.
 *
 * The header's "Deliver to" control (when the store switches shopper location
 * on) sets the place from here without narrowing this page: the choice is
 * saved and follows the shopper to every page that does filter, and on to
 * checkout.
 */
export default async function HomePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  let sections: SectionInstance[];
  let ctx: SectionRenderContext;

  try {
    const [settings, page] = await Promise.all([
      getStorefrontSettings(),
      getHomePageSections(),
    ]);
    sections = page.sections;
    ctx = {
      locale: locale as Locale,
      defaultLanguage: settings.defaultLanguage,
      isMultiVendorEnabled: settings.isMultiVendorEnabled,
      themeId: settings.theme.id,
      themeSettings: settings.theme.settings,
      templateType: "home",
    };
  } catch {
    sections = getDefaultHomeSections();
    ctx = {
      locale: locale as Locale,
      defaultLanguage: DEFAULT_LANGUAGE,
      isMultiVendorEnabled: false,
      themeId: "electronics",
      templateType: "home",
    };
  }

  return <StoreSections sections={sections} ctx={ctx} />;
}
