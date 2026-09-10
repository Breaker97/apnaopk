import { HomeFeaturedCategories } from "@/components/store/home-featured-categories";
import { sectionEmptyState } from "@/components/store/sections/section-empty-state";
import { ElectronicsCategoryStrip } from "@/components/store/sections/themes/electronics-category-strip";
import { FeaturedCategoriesSkeleton } from "@/components/store/home-section-skeletons";
import {
  FEATURED_CATEGORIES_LIMIT_MAX,
  FEATURED_CATEGORIES_LIMIT_MIN,
  FEATURED_CATEGORIES_SOURCES,
  type FeaturedCategoriesSource,
} from "@/lib/site-config/home-page-config";
import { lt } from "../localized";
import type {
  LocalizedText,
  SectionDefinition,
  SectionRenderProps,
} from "../types";

function props({ settings, ctx }: SectionRenderProps) {
  return {
    locale: ctx.locale,
    title: lt(settings.title as LocalizedText, ctx.locale, ctx.defaultLanguage),
    source: settings.source as FeaturedCategoriesSource,
    limit: settings.limit as number,
    categoryIds: settings.categoryIds as string[],
    emptyState: sectionEmptyState(ctx, {
      title: "Category row",
      hint: "No categories to show yet — publish some, mark them featured, or pick them by hand in this section.",
    }),
  };
}

/** The original image-card row — what every stored instance already renders. */
const cards: SectionDefinition["Render"] = (renderProps) => (
  <HomeFeaturedCategories {...props(renderProps)} />
);

/** Circular department tiles under a centred heading. */
const circles: SectionDefinition["Render"] = (renderProps) => (
  <ElectronicsCategoryStrip {...props(renderProps)} />
);

// Sources and limits are still imported from home-page-config while the
// legacy settings path exists; they inline here when that file is deleted.
export const categoryList: SectionDefinition = {
  type: "category-list",
  version: 1,
  category: "categories",
  suggested: true,
  // FIRST entry is the default every existing document falls back to — never
  // reorder this list, only append.
  variants: [
    { key: "cards", name: "Image cards", Render: cards, Skeleton: FeaturedCategoriesSkeleton },
    { key: "circles", name: "Circular strip", Render: circles, Skeleton: FeaturedCategoriesSkeleton },
  ],
  fields: [
    { key: "title", type: "text", translatable: true, default: "Featured Categories" },
    { key: "source", type: "select", options: FEATURED_CATEGORIES_SOURCES, default: "featured" },
    {
      key: "limit",
      type: "number",
      default: 8,
      min: FEATURED_CATEGORIES_LIMIT_MIN,
      max: FEATURED_CATEGORIES_LIMIT_MAX,
    },
    { key: "categoryIds", type: "categoryList" },
  ],
  Render: cards,
  Skeleton: FeaturedCategoriesSkeleton,
};
