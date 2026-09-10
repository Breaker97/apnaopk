import { ProductsListing } from "@/components/store/sections/products-listing";
import { ProductSkeleton } from "@/components/products/product-skeleton";
import { lt } from "../localized";
import type { LocalizedText, SectionDefinition } from "../types";

/**
 * The products listing core: title + sort toolbar, faceted sidebar, and
 * the infinite grid — the whole hand-wired /products page body. The
 * heading falls back to the localized "All products" while unset.
 */
export const productsMain: SectionDefinition = {
  type: "products-main",
  version: 1,
  category: "products",
  templates: ["products"],
  required: true,
  locked: true,
  maxPerPage: 1,
  resourceType: "products",
  fields: [{ key: "heading", type: "text", translatable: true, default: "" }],
  Render({ settings, ctx }) {
    const resource = ctx.resource;
    if (resource?.type !== "products") return null;
    return (
      <ProductsListing
        locale={ctx.locale}
        heading={lt(
          settings.heading as LocalizedText,
          ctx.locale,
          ctx.defaultLanguage,
        ).trim()}
        resource={resource}
      />
    );
  },
  Skeleton: () => (
    <div className="container mx-auto px-4">
      <ProductSkeleton count={12} />
    </div>
  ),
};
