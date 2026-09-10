import { HomeNewArrivals } from "@/components/store/home-new-arrivals";
import { NewArrivalsSkeleton } from "@/components/store/home-section-skeletons";
import {
  NEW_ARRIVALS_COLUMNS_MAX,
  NEW_ARRIVALS_COLUMNS_MIN,
  NEW_ARRIVALS_LIMIT_MAX,
  NEW_ARRIVALS_LIMIT_MIN,
  NEW_ARRIVALS_SOURCES,
  type NewArrivalsSource,
} from "@/lib/site-config/home-page-config";
import { lt } from "../localized";
import type { LocalizedText, SectionDefinition } from "../types";

/** A curated product row (the legacy "Products on Sale" section). */
export const productGrid: SectionDefinition = {
  type: "product-grid",
  version: 1,
  category: "products",
  suggested: true,
  fields: [
    { key: "title", type: "text", translatable: true, default: "Products on Sale" },
    { key: "subtitle", type: "text", translatable: true, default: "" },
    { key: "source", type: "select", options: NEW_ARRIVALS_SOURCES, default: "discounted" },
    {
      key: "limit",
      type: "number",
      default: 8,
      min: NEW_ARRIVALS_LIMIT_MIN,
      max: NEW_ARRIVALS_LIMIT_MAX,
    },
    {
      key: "desktopColumns",
      type: "number",
      default: 4,
      min: NEW_ARRIVALS_COLUMNS_MIN,
      max: NEW_ARRIVALS_COLUMNS_MAX,
    },
    {
      key: "productIds",
      type: "productList",
      hint: "Drag to set the shelf order.",
      showWhen: { key: "source", values: ["manual"] },
    },
  ],
  Render({ settings, ctx }) {
    return (
      <HomeNewArrivals
        locale={ctx.locale}
        title={lt(settings.title as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        subtitle={lt(settings.subtitle as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        source={settings.source as NewArrivalsSource}
        limit={settings.limit as number}
        desktopColumns={settings.desktopColumns as number}
        productIds={settings.productIds as string[]}
      />
    );
  },
  Skeleton: ({ settings }) => (
    <NewArrivalsSkeleton desktopColumns={settings.desktopColumns as number} />
  ),
};
