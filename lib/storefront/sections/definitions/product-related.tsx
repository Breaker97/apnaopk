import { getTranslations } from "next-intl/server";
import { RelatedProducts } from "@/components/products/related-products";
import { RelatedProductsSkeleton } from "@/components/products/product-details-skeleton";
import { lt } from "../localized";
import type { LocalizedText, SectionDefinition } from "../types";

/**
 * "You may also like" — related products by category, pickup-aware through
 * the shopper's location. The title falls back to the LOCALIZED storefront
 * string while unset, so the default template reads identically in every
 * locale; typing a custom title takes over from there.
 *
 * The two variants share the shelf entirely — same query, same cards, same
 * scroller — and differ only in the header the carousel draws.
 */
function renderWith(
  appearance: "classic" | "electronics",
): SectionDefinition["Render"] {
  return async function Render({ settings, ctx }) {
    const resource = ctx.resource;
    if (resource?.type !== "product") return null;
    const product = resource.product;
    const category = product.category as
      | { _id?: string }
      | string
      | null
      | undefined;
    const categoryId =
      typeof category === "string" ? category : category?._id;

    const custom = lt(
      settings.title as LocalizedText,
      ctx.locale,
      ctx.defaultLanguage,
    ).trim();
    const title = custom
      ? custom
      : (await getTranslations({ locale: ctx.locale }))(
          "product.youMayAlsoLike",
        );

    return (
      <section
        id="customers-also-purchased"
        className="container mx-auto mt-12 border-t border-border/70 px-4 py-12"
      >
        <RelatedProducts
          productId={String(product._id)}
          categoryId={categoryId as string}
          locale={ctx.locale}
          title={title}
          location={resource.location}
          appearance={appearance}
        />
      </section>
    );
  };
}

export const productRelated: SectionDefinition = {
  type: "product-related",
  version: 1,
  category: "products",
  templates: ["product"],
  maxPerPage: 1,
  resourceType: "product",
  fields: [{ key: "title", type: "text", translatable: true, default: "" }],
  // NEVER reorder — the first entry is what stored documents render.
  variants: [
    { key: "classic", name: "Classic", Render: renderWith("classic") },
    {
      key: "electronics",
      name: "Electronics",
      Render: renderWith("electronics"),
    },
  ],
  Render: renderWith("classic"),
  Skeleton: () => (
    <div className="container mx-auto mt-12 border-t border-border/70 px-4 py-12">
      <RelatedProductsSkeleton />
    </div>
  ),
};
