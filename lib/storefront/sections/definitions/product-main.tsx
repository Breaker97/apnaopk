import { ProductDetails } from "@/components/products/product-details";
import { ProductDetailsSkeleton } from "@/components/products/product-details-skeleton";
import type { ProductPageProduct } from "@/lib/products/purchase-product";
import { getProductFulfillmentNotes } from "@/lib/products/product-fulfillment-notes";
import {
  productReturnWindowDays,
  returnWindowOverridesOf,
  type ReturnWindowProductLike,
} from "@/lib/returns/return-window";
import {
  finalSaleCollectionIdsOf,
  isFinalSaleProduct,
  type FinalSaleProductLike,
} from "@/lib/returns/final-sale";
import { getReturnCollections } from "@/lib/returns/final-sale-collections";
import { productsJoiningByRule } from "@/lib/catalog/collections";
import { getSettingsLean } from "@/models/settings.model";
import type { ProductShippingData } from "@/lib/catalog/product-shipping";
import {
  PRODUCT_GALLERY_LAYOUTS,
  type ProductGalleryLayout,
} from "@/lib/storefront/pages/default-templates";
import {
  DEFAULT_PRODUCT_DETAIL_ROWS_JSON,
  parseProductDetailGroups,
  visibleProductDetailGroups,
} from "@/lib/storefront/sections/product-detail-rows";
import { parseProductDetailConfig } from "@/lib/storefront/sections/product-detail-style";
import { readSpecificationRows } from "./product-specification";
import type { SectionDefinition } from "../types";

/**
 * The product template's CORE: gallery, buy box, description tabs — the
 * whole ProductDetails composition the hand-wired page rendered. Required,
 * locked, and singleton: "delete the product info from the product page" is
 * not a state the engine allows. `galleryLayout` here is the section-level
 * home of the retired `productGalleryLayout` theme setting, now with all
 * six arrangements the Figma spec calls for.
 *
 * The buy box has ONE design (the Minimal composition, Figma 774:4992),
 * arranged by the merchant through `rows` and `detailStyle`, the same under
 * every template.
 */
async function renderProductMain({
  settings,
  ctx,
}: Parameters<SectionDefinition["Render"]>[0]) {
  const resource = ctx.resource;
  // Only absent in a draft preview of a store with no products yet.
  if (resource?.type !== "product") return null;
  const product = resource.product;

  // Resolved here rather than by the page: the delivery/return notes come
  // from the store's shipping and return settings, and the section is their
  // only consumer. The "Collect at" offer depends on the shopper's place, so
  // the buy box asks for it from the browser (use-collection-offer.ts) — this
  // render is cached and shared.
  const vendorId = (product.vendorId as { _id?: string } | undefined)?._id;
  const [fulfillment, storeSettings, returnCollections] = await Promise.all([
    getProductFulfillmentNotes({
      productId: String(product._id),
      price: Number(product.price) || 0,
      vendorId: vendorId ? String(vendorId) : undefined,
      shipping: product.shipping as ProductShippingData | undefined,
    }),
    getSettingsLean(),
    getReturnCollections(),
  ]);

  // The automated collections the return settings name, which a product joins
  // by their rules and never lists itself. The rules are cached; only a store
  // that has such a collection matches this product against them.
  const productId = String(product._id);
  const ruleCollections = (
    await productsJoiningByRule([productId], returnCollections.rules)
  ).get(productId);

  // The product's own return window, when it or a collection sets one (R6):
  // the line says that, not the store's.
  const ownWindow = productReturnWindowDays(
    product as unknown as ReturnWindowProductLike,
    returnWindowOverridesOf(storeSettings),
    ruleCollections,
  );
  const productFulfillment =
    ownWindow !== undefined && fulfillment.returns
      ? { ...fulfillment, returns: { ...fulfillment.returns, windowDays: ownWindow } }
      : fulfillment;

  // Final sale by product, variant and collection, answered here with the
  // store's collections; the buy box picks the chosen variant's answer.
  const finalSaleCollections = finalSaleCollectionIdsOf(storeSettings);
  const finalSaleSource = product as unknown as FinalSaleProductLike;
  const finalSale = {
    product: isFinalSaleProduct(
      finalSaleSource,
      undefined,
      finalSaleCollections,
      ruleCollections,
    ),
    variants: Object.fromEntries(
      (finalSaleSource.variants || []).map((variant) => [
        String(variant._id ?? ""),
        isFinalSaleProduct(
          finalSaleSource,
          variant._id,
          finalSaleCollections,
          ruleCollections,
        ),
      ]),
    ),
  };

  // Whether the page ALSO draws the standalone spec section (the
  // Electronics preset does): the buy box then stands its own inline copy
  // down — two spec tables on one page is the bug this prevents. Read from
  // the page being drawn, so a draft preview follows the draft.
  const pageSections = ctx.pageSectionTypes;
  const standaloneSpecs = pageSections?.has("product-specification") ?? false;

  return (
    // An inline-size container spanning the surface: the gallery's bleed
    // (--store-content-inset in globals.css) is measured against it.
    <div className="@container w-full">
    <div className="container mx-auto px-4 pt-6 lg:pt-8">
      <ProductDetails
        product={product as unknown as ProductPageProduct}
        locale={ctx.locale}
        isMultiVendor={ctx.isMultiVendorEnabled}
        fulfillment={productFulfillment}
        finalSale={finalSale}
        galleryLayout={settings.galleryLayout as ProductGalleryLayout}
        rowGroups={visibleProductDetailGroups(
          parseProductDetailGroups(settings.rows),
        )}
        detail={parseProductDetailConfig(settings.detailStyle)}
        standaloneSpecs={standaloneSpecs}
        // The tab strip names only what the shopper can land on. The inline
        // table always draws (with its own empty state); the standalone one
        // draws nothing live for a product without rows. A hidden or removed
        // Reviews section takes its tab and the rating's link with it.
        sectionTargets={{
          specifications:
            !standaloneSpecs || readSpecificationRows(product).length > 0,
          reviews: pageSections?.has("product-reviews") ?? true,
        }}
      />
    </div>
    </div>
  );
}

export const productMain: SectionDefinition = {
  type: "product-main",
  version: 1,
  category: "products",
  templates: ["product"],
  required: true,
  locked: true,
  maxPerPage: 1,
  resourceType: "product",
  fields: [
    {
      key: "galleryLayout",
      type: "select",
      options: PRODUCT_GALLERY_LAYOUTS,
      default: "bottom",
    },
    // The Minimal design's row arrangement (groups, order, visibility) as a
    // JSON string — see product-detail-rows.ts. A text field so the config
    // rides the existing normalize/write machinery; the parser falls back
    // to the default arrangement on anything malformed.
    {
      key: "rows",
      type: "text",
      default: DEFAULT_PRODUCT_DETAIL_ROWS_JSON,
    },
    // Visibility + Style knobs (product-detail-style.ts), same JSON-in-text
    // arrangement as `rows`. Empty default: the parser fills every knob.
    { key: "detailStyle", type: "text", default: "" },
  ],
  // The Render awaits the delivery/return notes; the Skeleton lets the rest
  // of the template stream around it instead of blocking.
  Skeleton: () => (
    <div className="container mx-auto px-4 pt-6 lg:pt-8">
      <ProductDetailsSkeleton />
    </div>
  ),
  Render: renderProductMain,
};
