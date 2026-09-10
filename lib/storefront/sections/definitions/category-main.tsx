import {
  CategoryDetailHeader,
  CategoryDetailMain,
} from "@/components/store/sections/category-detail";
import { ProductSkeleton } from "@/components/products/product-grid";
import type { SectionDefinition } from "../types";

/**
 * The category page split in two: the grid core is required and locked;
 * the stock header is a section a merchandiser may delete and replace
 * with their own hero, description, or promotions.
 */

export const categoryHeader: SectionDefinition = {
  type: "category-header",
  version: 1,
  category: "categories",
  templates: ["category"],
  maxPerPage: 1,
  resourceType: "category",
  fields: [],
  Render({ ctx }) {
    const resource = ctx.resource;
    if (resource?.type !== "category") return null;
    return <CategoryDetailHeader locale={ctx.locale} resource={resource} />;
  },
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
  fields: [],
  Render({ ctx }) {
    const resource = ctx.resource;
    if (resource?.type !== "category") return null;
    return <CategoryDetailMain locale={ctx.locale} resource={resource} />;
  },
  Skeleton: () => (
    <div className="container mx-auto px-4">
      <ProductSkeleton count={12} />
    </div>
  ),
};
