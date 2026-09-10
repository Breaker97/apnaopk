import { HomeSponsoredProducts } from "@/components/store/home-sponsored-products";
import { NewArrivalsSkeleton } from "@/components/store/home-section-skeletons";
import {
  NEW_ARRIVALS_COLUMNS_MAX,
  NEW_ARRIVALS_COLUMNS_MIN,
  SPONSORED_PRODUCTS_LIMIT_MAX,
  SPONSORED_PRODUCTS_LIMIT_MIN,
} from "@/lib/site-config/home-page-config";
import {
  SECTION_TITLE_SIZE_OPTIONS,
  TITLE_SIZE_FIELD_KEY,
  type SectionDefinition,
} from "../types";

/**
 * Paid boost placements. Content comes from live campaigns, never from
 * merchant picks — only the slot count, the desktop column count and the
 * heading size are editable, and the section renders nothing while boosting
 * is disabled.
 *
 * The heading is NOT a field. It is fixed to the localized "Sponsored"
 * (`common.sponsored`, the same word Amazon, Walmart, Best Buy and eBay put
 * over paid shelves), so a merchant cannot retitle an ad row into
 * "Recommended for you" and quietly weaken the disclosure. The per-card
 * pill on every paid rung stays the legal disclosure either way.
 */
export const sponsoredRail: SectionDefinition = {
  type: "sponsored-rail",
  version: 1,
  category: "products",
  // One per page: strict-index rendering sells specific visual rungs, and a
  // second rail would double-sell them. Render enforces this cap even if a
  // hand-edited document says otherwise.
  maxPerPage: 1,
  fields: [
    {
      key: "limit",
      type: "number",
      default: 8,
      min: SPONSORED_PRODUCTS_LIMIT_MIN,
      max: SPONSORED_PRODUCTS_LIMIT_MAX,
    },
    // How many cards share the visible desktop row — same knob, same bounds
    // as the product-group and product-grid sections. Phones and tablets keep
    // their fixed tiers.
    {
      key: "desktopColumns",
      type: "number",
      default: 4,
      min: NEW_ARRIVALS_COLUMNS_MIN,
      max: NEW_ARRIVALS_COLUMNS_MAX,
    },
    // Declared by hand: the registry derives this control from a title
    // field, and this section has none. The fixed heading still gets the
    // same three size steps as every other shelf.
    {
      key: TITLE_SIZE_FIELD_KEY,
      type: "select",
      options: SECTION_TITLE_SIZE_OPTIONS,
      default: "default",
      width: "third",
    },
  ],
  available: (ctx) => ctx.isMultiVendorEnabled,
  Render({ settings, ctx }) {
    return (
      <HomeSponsoredProducts
        locale={ctx.locale}
        limit={settings.limit as number}
        desktopColumns={settings.desktopColumns as number}
        // The active theme decides the heading treatment (the compare-page
        // precedent) — Electronics' two-tone, plain elsewhere.
        themedHeading={ctx.themeId === "electronics"}
        ctx={ctx}
      />
    );
  },
  Skeleton: ({ settings }) => (
    <NewArrivalsSkeleton desktopColumns={(settings.desktopColumns as number) || 4} />
  ),
};
