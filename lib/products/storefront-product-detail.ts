import { unstable_cache } from "next/cache";
import { PRODUCT_STATUS } from "@/config/app.config";
import { CACHE_TAGS, productSlugTag } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import { getStorefrontProductConstraint } from "@/lib/catalog/product-visibility";
import { Product } from "@/models";
import { getPlatformMessagingSettings } from "@/lib/notifications/platform-messaging";
import { sanitizeDigitalAssetsForStorefront } from "@/lib/products/digital-assets";
import { stripLocationInventory } from "@/lib/inventory/pickup-branch-stock";
import { sanitizeHtml } from "@/lib/sanitize";
import { STOREFRONT_PRODUCT_SELECT } from "@/lib/products/storefront-private-fields";

async function loadStorefrontProductBySlug(slug: string) {
  await connectDB();

  const product = await Product.findOne({
    slug,
    status: PRODUCT_STATUS.ACTIVE,
    ...(await getStorefrontProductConstraint()),
  })
    // This document is serialized into the RSC payload of every product
    // page and answers GET /api/products/[slug]: nothing the store keeps for
    // itself — cost, the search index — may ride along.
    .select(STOREFRONT_PRODUCT_SELECT)
    .populate(
      "vendorId",
      "storeName slug logo description rating messaging isDefault",
    )
    .populate("category", "name slug")
    .populate("brand", "name slug logo")
    .lean();

  if (!product) return null;
  // Strip private storage keys — the PDP may show what a purchase includes
  // (name/size), but downloads go through the order-gated route only.
  const serialized = sanitizeDigitalAssetsForStorefront(
    JSON.parse(JSON.stringify(product)),
  );
  stripLocationInventory(serialized);
  // Sanitized here, on the server, rather than in the product component:
  // running sanitize-html in the browser shipped its parser stack
  // (htmlparser2, postcss, entities — ~120 KB) on every storefront page for
  // a string the server already holds. Every consumer of this loader gets
  // safe HTML.
  if (typeof serialized.description === "string") {
    serialized.description = sanitizeHtml(serialized.description);
  }
  if (!serialized.vendorId || serialized.vendorId.isDefault === true) {
    serialized.platformMessaging = await getPlatformMessagingSettings();
  }
  return serialized;
}

/**
 * The product page's data, cached per slug.
 *
 * Built per call so the entry can carry its own `productSlugTag`: a sale
 * expires just this product (see `revalidateProductStock`) rather than the
 * `products` tag every listing shares. The cache key does not change with it —
 * `unstable_cache` keys on the callback source, the key parts and the
 * arguments, all of which are the same on every call.
 */
export function getStorefrontProductBySlug(slug: string) {
  return unstable_cache(
    loadStorefrontProductBySlug,
    ["storefront-product-detail"],
    {
      revalidate: 60,
      tags: [
        CACHE_TAGS.products,
        CACHE_TAGS.categories,
        CACHE_TAGS.brands,
        productSlugTag(slug),
      ],
    },
  )(slug);
}
