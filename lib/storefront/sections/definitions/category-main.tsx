import {
  CategoryDetailHeader,
  CategoryDetailMain,
} from "@/components/store/sections/category-detail";
import { ProductSkeleton } from "@/components/products/product-grid";
import {
  CATEGORY_HEADER_FIELDS,
  CATEGORY_MAIN_FIELDS,
  readCategoryHeaderLayout,
  readCategoryMainLayout,
} from "../category-page-layout";
import type { ListingDesign } from "../products-listing-layout";
import type { SectionDefinition, SectionRenderProps } from "../types";

/**
 * The category page split in two: the grid core is required and locked;
 * the stock header is a section a merchandiser may delete and replace
 * with their own hero, description, or promotions.
 *
 * Both halves follow the template's design ("classic" or "electronics")
 * unless the page pins one, and both designs draw every piece the settings
 * turn on (`category-page-layout.ts`).
 */

function renderHeader(design: ListingDesign) {
  return function CategoryHeaderDesign({ settings, ctx }: SectionRenderProps) {
    const resource = ctx.resource;
    if (resource?.type !== "category") return null;
    return (
      <CategoryDetailHeader
        locale={ctx.locale}
        resource={resource}
        design={design}
        layout={readCategoryHeaderLayout(settings, design)}
      />
    );
  };
}

function renderMain(design: ListingDesign) {
  return function CategoryMainDesign({ settings, ctx }: SectionRenderProps) {
    const resource = ctx.resource;
    if (resource?.type !== "category") return null;
    return (
      <CategoryDetailMain
        locale={ctx.locale}
        resource={resource}
        design={design}
        layout={readCategoryMainLayout(settings, design)}
      />
    );
  };
}

export const categoryHeader: SectionDefinition = {
  type: "category-header",
  version: 1,
  category: "categories",
  templates: ["category"],
  maxPerPage: 1,
  resourceType: "category",
  designFollowsTheme: true,
  variants: [
    { key: "classic", name: "Card", Render: renderHeader("classic") },
    { key: "electronics", name: "Centred", Render: renderHeader("electronics") },
  ],
  fields: CATEGORY_HEADER_FIELDS,
  Render: renderHeader("classic"),
};

export const categoryMain: SectionDefinition = {
  type: "category-main",
  version: 1,
  category: "categories",
  templates: ["category"],
  required: true,
  locked: true,
  maxPerPage: 1,
  resourceType: "category",
  designFollowsTheme: true,
  variants: [
    { key: "classic", name: "Classic", Render: renderMain("classic") },
    { key: "electronics", name: "Showroom", Render: renderMain("electronics") },
  ],
  fields: CATEGORY_MAIN_FIELDS,
  Render: renderMain("classic"),
  Skeleton: () => (
    <div className="container mx-auto px-4">
      <ProductSkeleton count={12} />
    </div>
  ),
};
