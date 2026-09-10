import "server-only";

/**
 * The product page's delivery and return lines, resolved from the store's
 * real settings — see lib/products/fulfillment-notes.ts for why.
 *
 * The delivery window is priced through the SAME resolver checkout uses
 * (`resolveCheckoutShipping`): one line of this product, in the store's own
 * country, since a product page has no address to rate against and a domestic
 * order is the honest default. That keeps the number here the number the
 * shopper meets again at checkout — including a vendor's own profile on a
 * store with per-vendor shipping — instead of a second calculation that can
 * drift from the first.
 */

import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { resolveCheckoutShipping } from "@/lib/checkout/checkout-shipping";
import {
  CANONICAL_CART_WEIGHT_UNIT,
  type ShippingSettings,
} from "@/lib/shipping/shipping";
import {
  resolveItemShipping,
  type ProductShippingData,
} from "@/lib/catalog/product-shipping";
import {
  DEFAULT_FREE_SHIPPING_THRESHOLD,
  DEFAULT_ORDER_SHIPPING_COST,
} from "@/lib/orders/order-settings";
import { normalizeContentPagesSettings } from "@/lib/site-config/content-pages-config";
import { resolveReturnPolicy } from "@/lib/returns/return-policy";
import { RETURN_WINDOW_DAYS } from "@/lib/returns/return-plan";
import {
  deliveryWindowFromShipping,
  returnsNoteFromPolicy,
  type ProductFulfillmentNotes,
} from "@/lib/products/fulfillment-notes";

type FulfillmentProductInput = {
  productId: string;
  price: number;
  vendorId?: string;
  shipping?: ProductShippingData;
};

export const getProductFulfillmentNotes = unstable_cache(
  async (input: FulfillmentProductInput): Promise<ProductFulfillmentNotes> => {
    await connectDB();
    const settings = await getSettings();
    const shipping = settings.shipping as ShippingSettings | undefined;

    // One unit at the product's own weight; a variant chosen later can only
    // move the price within weight-range rates, and the page has no
    // selection yet when this is resolved.
    const item = resolveItemShipping({
      productShipping: input.shipping,
      quantity: 1,
      targetWeightUnit: CANONICAL_CART_WEIGHT_UNIT,
    });
    const price = Math.max(0, Number(input.price) || 0);
    const vendorAgg = new Map([
      [
        input.vendorId ?? "",
        {
          subtotal: price,
          shippableSubtotal: item.requiresShipping ? price : 0,
          weight: item.totalWeight,
          shippableItemCount: item.requiresShipping ? 1 : 0,
        },
      ],
    ]);
    const orderSettings = settings.orders || {};
    const resolution = await resolveCheckoutShipping({
      subtotal: price,
      totalWeight: item.totalWeight,
      vendorAgg,
      destination: { country: shipping?.origin?.country ?? "" },
      platformShipping: shipping,
      orders: {
        freeShippingThreshold:
          orderSettings.freeShippingThreshold ?? DEFAULT_FREE_SHIPPING_THRESHOLD,
        defaultShippingCost:
          orderSettings.defaultShippingCost ?? DEFAULT_ORDER_SHIPPING_COST,
      },
      isMultiVendorEnabled: Boolean(settings.multiVendorMode?.enabled),
    });

    return {
      deliveryDays: item.requiresShipping
        ? deliveryWindowFromShipping({
            available: resolution.available,
            method: resolution.selectedShippingMethod,
            showEstimatedDelivery:
              shipping?.delivery?.showEstimatedDelivery ?? true,
          })
        : null,
      returns: returnsNoteFromPolicy({
        requiresShipping: item.requiresShipping,
        windowDays: RETURN_WINDOW_DAYS,
        policy: resolveReturnPolicy(settings),
        policyPage: normalizeContentPagesSettings(settings.contentPages).returns
          .visible,
      }),
    };
  },
  ["product-fulfillment-notes"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.settings, CACHE_TAGS.products],
  },
);
