import { ProductsListing } from "@/components/store/sections/products-listing";
import { ProductSkeleton } from "@/components/products/product-skeleton";
import { lt } from "../localized";
import { PRODUCTS_LISTING_FIELDS } from "../products-listing-fields";
import {
  readProductsListingLayout,
  type ListingDesign,
} from "../products-listing-layout";
import type {
  LocalizedText,
  SectionDefinition,
  SectionRenderProps,
} from "../types";

/** The listing as one design draws it; both designs run the same component. */
function renderListing(design: ListingDesign) {
  return function ListingDesignRender({ settings, ctx }: SectionRenderProps) {
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
        layout={readProductsListingLayout(settings)}
        design={design}
        preview={ctx.preview}
      />
    );
  };
}

/**
 * The products listing core: title + sort toolbar, faceted filters, and the
 * grid — the whole /products page body. The heading falls back to the
 * localized "All products" while unset.
 *
 * Its design follows the template: "classic" or "electronics", resolved from
 * the active template unless the page pins one. Both designs offer every
 * feature (see `ProductsListing`).
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
  designFollowsTheme: true,
  variants: [
    { key: "classic", name: "Classic", Render: renderListing("classic") },
    { key: "electronics", name: "Showroom", Render: renderListing("electronics") },
  ],
  fields: [
    { key: "heading", type: "text", translatable: true, default: "" },
    ...PRODUCTS_LISTING_FIELDS,
  ],
  Render: renderListing("classic"),
  Skeleton: () => (
    <div className="container mx-auto px-4">
      <ProductSkeleton count={12} />
    </div>
  ),
};
