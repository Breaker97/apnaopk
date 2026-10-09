import { Home } from "@/contracts/mobile/shop/v1/home";
import { defineRoute } from "@/lib/api-core/registry";
import { resolveCurrency } from "@/lib/intl/currencies";
import { getHomePageSections } from "@/lib/storefront/pages/get-home-page";
import { getHomeCopy } from "@/lib/storefront/section-data/home-copy";
import { drawnSections } from "@/lib/storefront/sections/drawn";
import { getStoreFacts } from "@/lib/storefront/store-facts";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { catalogContext } from "../catalog/product-card";
import { HOME_BLOCK_MAPPERS } from "./blocks";

/**
 * GET /home: the web's home page as blocks, one per section it draws, in its
 * order (contracts … home.ts).
 *
 * Static (ISR), like the web's home page: kept until a tag of something it
 * read expires (the home document and settings, products, categories,
 * collections, brands, sliders, coupons, blog posts, paid placements) or for a
 * minute. What changes on a schedule — a slide's window, a coupon's dates, a
 * countdown, a booking that starts — is decided when it is made, as on the
 * web. Every read throws on failure: nothing missing is ever kept as the
 * store's home.
 */
export const homeRoute = defineRoute({
  id: "home.get",
  method: "GET",
  path: "/home",
  auth: "none",
  cache: { kind: "static", revalidate: 60 },
  output: Home,
  handler: async ({ locale, mobileApp }) => {
    const [facts, storefront, page, copy] = await Promise.all([
      getStoreFacts(),
      getStorefrontSettings(),
      getHomePageSections(),
      getHomeCopy(locale),
    ]);
    const ctx = {
      locale,
      defaultLanguage: storefront.defaultLanguage,
      catalog: catalogContext(facts, mobileApp),
      currency: resolveCurrency(facts.currencyCode),
      copy,
    };
    const sections = drawnSections(page.sections, {
      isMultiVendorEnabled: storefront.isMultiVendorEnabled,
      themeId: storefront.theme.id,
    });
    const blocks = await Promise.all(
      sections.map((section) => {
        const map = HOME_BLOCK_MAPPERS[section.instance.type];
        return section.empty || !map ? null : map(section, ctx);
      }),
    );
    return { blocks: blocks.filter((block) => block !== null) };
  },
});
