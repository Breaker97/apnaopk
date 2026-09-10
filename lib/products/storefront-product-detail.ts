import { unstable_cache } from "next/cache";
import { PRODUCT_STATUS } from "@/config/app.config";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import { getStorefrontProductConstraint } from "@/lib/catalog/product-visibility";
import { Product } from "@/models";
import { getPlatformMessagingSettings } from "@/lib/notifications/platform-messaging";
import { sanitizeDigitalAssetsForStorefront } from "@/lib/products/digital-assets";
import { stripLocationInventory } from "@/lib/inventory/pickup-branch-stock";
import { sanitizeHtml } from "@/lib/sanitize";

export const getStorefrontProductBySlug = unstable_cache(
  async (slug: string) => {
    await connectDB();

    const product = await Product.findOne({
      slug,
      status: PRODUCT_STATUS.ACTIVE,
      ...(await getStorefrontProductConstraint()),
    })
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
  },
  ["storefront-product-detail"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.products, CACHE_TAGS.categories, CACHE_TAGS.brands],
  },
);
