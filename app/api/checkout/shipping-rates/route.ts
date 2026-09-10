import { z } from "zod";
import { connectDB } from "@/lib/db";
import { Cart } from "@/models";
import { getSettingsLean } from "@/models/settings.model";
import {
  CANONICAL_CART_WEIGHT_UNIT,
  type ShippingSettings,
} from "@/lib/shipping/shipping";
import { resolveCheckoutShipping } from "@/lib/checkout/checkout-shipping";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import {
  DEFAULT_FREE_SHIPPING_THRESHOLD,
  DEFAULT_ORDER_SHIPPING_COST,
} from "@/lib/orders/order-settings";
import {
  rateLimitByIP,
  rateLimitBySession,
  rateLimitByUser,
} from "@/lib/api/rate-limit-middleware";
import {
  resolveItemShipping,
  type ProductShippingData,
  type VariantShippingData,
} from "@/lib/catalog/product-shipping";
import { withApi } from "@/lib/api/handler";
import { isCountryAllowed } from "@/lib/intl/country-availability";

const ShippingRatesSchema = z.object({
  country: z.string().optional().default(""),
  state: z.string().optional().default(""),
  selectedShippingOptionId: z.string().max(100).optional(),
  vendorShippingSelections: z.record(z.string(), z.string().max(100)).optional(),
});

type RatesCartItem = {
  productId: {
    _id: string;
    price?: number;
    vendorId: string | { _id: string };
    shipping?: ProductShippingData;
    variants?: Array<
      VariantShippingData & { _id: { toString: () => string } }
    >;
  };
  variantId?: string;
  quantity: number;
  price: number;
};

/**
 * POST /api/checkout/shipping-rates
 * Returns selectable shipping options for the current cart + destination,
 * grouped per vendor when per-vendor shipping applies. Read-only: it computes
 * rates for the checkout selector UI; the order route re-resolves and validates
 * the chosen options authoritatively at payment time.
 */
export const POST = withApi(
  { auth: "optional" },
  async ({ request, session }) => {
    const cartSessionId = request.cookies?.get("cart_session")?.value;

    if (session?.user?.id) {
      await rateLimitByUser(
        request,
        session.user.id,
        "checkout:shipping-rates",
        "lenient",
        session.user.role,
      );
    } else if (cartSessionId) {
      await rateLimitBySession(request, cartSessionId, "checkout:shipping-rates", "lenient");
    } else {
      await rateLimitByIP(request, "lenient");
    }

    const { country, state, selectedShippingOptionId, vendorShippingSelections } =
      await validateBody(request, ShippingRatesSchema);

    await connectDB();
    const settings = await getSettingsLean();
    if (
      country.trim() &&
      !isCountryAllowed(country, settings.general?.countryAvailability)
    ) {
      throw new ValidationError({
        country: ["Selected country is not available"],
      });
    }
    const isMultiVendorEnabled = Boolean(settings.multiVendorMode?.enabled);

    const cartQuery = session?.user?.id
      ? { userId: session.user.id }
      : cartSessionId
        ? { sessionId: cartSessionId }
        : null;
    if (!cartQuery) throw new ValidationError({ cart: ["Cart is empty"] });

    const cart = await Cart.findOne(cartQuery)
      .populate({
        path: "items.productId",
        select: "price vendorId shipping variants",
        populate: { path: "vendorId", select: "_id" },
      })
      .lean();

    if (!cart || !cart.items || cart.items.length === 0) {
      throw new ValidationError({ cart: ["Cart is empty"] });
    }

    const items = cart.items as unknown as RatesCartItem[];

    let subtotal = 0;
    let totalWeight = 0;
    const vendorAgg = new Map<
      string,
      {
        subtotal: number;
        shippableSubtotal: number;
        weight: number;
        shippableItemCount: number;
      }
    >();

    for (const item of items) {
      const lineTotal = item.price * item.quantity;
      subtotal += lineTotal;

      const selectedVariant = item.variantId
        ? item.productId.variants?.find(
            (variant) => variant._id.toString() === String(item.variantId),
          )
        : undefined;
      const itemShipping = resolveItemShipping({
        productShipping: item.productId.shipping,
        variantShipping: selectedVariant,
        quantity: item.quantity,
        targetWeightUnit: CANONICAL_CART_WEIGHT_UNIT,
      });
      const lineWeight = itemShipping.totalWeight;
      totalWeight += lineWeight;

      const vendorId = String(
        (item.productId.vendorId as { _id?: string })?._id ||
          item.productId.vendorId ||
          "",
      );
      const agg = vendorAgg.get(vendorId) || {
        subtotal: 0,
        shippableSubtotal: 0,
        weight: 0,
        shippableItemCount: 0,
      };
      agg.subtotal += lineTotal;
      agg.weight += lineWeight;
      if (itemShipping.requiresShipping) {
        agg.shippableItemCount += item.quantity;
        agg.shippableSubtotal += lineTotal;
      }
      vendorAgg.set(vendorId, agg);
    }

    const orderSettings = settings.orders || {};
    const resolution = await resolveCheckoutShipping({
      subtotal,
      totalWeight,
      vendorAgg,
      destination: { country, state },
      platformShipping: settings.shipping as ShippingSettings | undefined,
      orders: {
        freeShippingThreshold:
          orderSettings.freeShippingThreshold ?? DEFAULT_FREE_SHIPPING_THRESHOLD,
        defaultShippingCost:
          orderSettings.defaultShippingCost ?? DEFAULT_ORDER_SHIPPING_COST,
      },
      isMultiVendorEnabled,
      selectedShippingOptionId,
      vendorShippingSelections,
    });

    return successResponse({
      available: resolution.available,
      mode: resolution.mode,
      shippingCost: resolution.shippingCost,
      singleOptions: resolution.singleOptions,
      vendorGroups: resolution.vendorGroups.map((g) => ({
        vendorId: g.vendorId,
        vendorName: g.vendorName || "Vendor",
        selectedOptionId: g.selectedOptionId,
        cost: g.cost,
        options: g.options,
      })),
      customs: {
        dutyAmount: resolution.customs.dutyAmount,
        collectedAtCheckout: resolution.customs.collectedAtCheckout,
      },
    });
  },
);
