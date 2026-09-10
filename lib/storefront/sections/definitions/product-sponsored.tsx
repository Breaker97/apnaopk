import { SponsoredProductsCarousel } from "@/components/products/sponsored-products-carousel";
import type { SectionDefinition } from "../types";

function resolveCategoryId(product: Record<string, unknown>): string | undefined {
  const category = product.category as
    | { _id?: string }
    | string
    | null
    | undefined;
  return typeof category === "string" ? category : category?._id;
}

/**
 * The product page's paid rail (the mixed sponsored/organic shelf). One per
 * page for the same reason as the home rail: strict-index rendering sells
 * specific rungs. Slot depth stays with the boost settings; what THIS
 * section controls is whether the placement renders at all — and
 * `getSponsoredPlacementDepths` reads the published template so vendors are
 * never sold positions on a page that hides them.
 */
export const productSponsored: SectionDefinition = {
  type: "product-sponsored",
  version: 1,
  category: "products",
  templates: ["product"],
  maxPerPage: 1,
  resourceType: "product",
  fields: [],
  available: (ctx) => ctx.isMultiVendorEnabled,
  Render({ ctx }) {
    const resource = ctx.resource;
    if (resource?.type !== "product") return null;
    return (
      <div className="container mx-auto mt-12 px-4">
        <SponsoredProductsCarousel
          productId={String(resource.product._id)}
          categoryId={resolveCategoryId(resource.product)}
          locale={ctx.locale}
        />
      </div>
    );
  },
  // Streams like the old page's `fallback={null}` boundary: usually renders
  // nothing (no paid rungs), so a visible skeleton would be a lie.
  Skeleton: () => null,
};
