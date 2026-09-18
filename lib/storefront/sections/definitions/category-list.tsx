import { CategoryListSection } from "@/components/store/sections/category-list-section";
import { sectionEmptyState } from "@/components/store/sections/section-empty-state";
import { FeaturedCategoriesSkeleton } from "@/components/store/home-section-skeletons";
import {
  readCategoryListStyle,
  type CategoryListVariant,
} from "../category-list-style";
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

/**
 * Every template renders the same section: the template is the PRESET the
 * block's style starts from (category-list-style.ts), and `style` holds
 * what the merchant adjusted on top.
 */
const render = (variant: CategoryListVariant): SectionDefinition["Render"] =>
  function CategoryListRender({ settings, ctx }: SectionRenderProps) {
    return (
      <CategoryListSection
        locale={ctx.locale}
        title={lt(settings.title as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        source={settings.source as FeaturedCategoriesSource}
        limit={settings.limit as number}
        categoryIds={settings.categoryIds as string[]}
        style={readCategoryListStyle(settings.style, variant)}
        emptyState={sectionEmptyState(ctx, {
          title: "Category row",
          hint: "No categories to show yet — publish some, mark them featured, or pick them by hand in this section.",
        })}
      />
    );
  };

/** The original image-card row — what every stored instance already renders. */
const cards = render("cards");

/** Circular department tiles under a centred heading. */
const circles = render("circles");

/** Tall picture tiles with the name on the picture — the fashion design. */
const overlay = render("overlay");

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
    { key: "overlay", name: "Label on image", Render: overlay, Skeleton: FeaturedCategoriesSkeleton },
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
    // JSON — see category-list-style.ts. A text field so the style rides
    // the section contract (draft, publish, history) like any setting;
    // its own editor panel edits it, and the parser fills every knob from
    // the template's preset. Empty: the template exactly as designed.
    { key: "style", type: "text", default: "" },
  ],
  Render: cards,
  Skeleton: FeaturedCategoriesSkeleton,
};
