import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Order, Cart } from "@/models";
import {
  paginatedResponse,
  createdResponse,
} from "@/lib/api/response";
import {
  handleApiError,
  AuthenticationError,
  ValidationError,
} from "@/lib/api/errors";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { getSettingsLean } from "@/models/settings.model";
import { getNextOnlineOrderNumber } from "@/lib/orders/order-number";
import { auditOrderPlaced, customerActor } from "@/lib/orders/audit-order";
import {
  DEFAULT_FREE_SHIPPING_THRESHOLD,
  DEFAULT_ORDER_SHIPPING_COST,
  DEFAULT_ORDER_TAX_RATE,
  DEFAULT_VENDOR_COMMISSION_RATE,
} from "@/lib/orders/order-settings";
import {
  CANONICAL_CART_WEIGHT_UNIT,
  SHIPPING_UNAVAILABLE_MESSAGE,
  type ShippingSettings,
} from "@/lib/shipping/shipping";
import {
  allocateSubOrderShipping,
  resolveCheckoutShipping,
} from "@/lib/checkout/checkout-shipping";
import {
  decrementInventory,
  restoreInventory,
  InsufficientStockError,
} from "@/lib/inventory/inventory";
import { markOrderInventoryReserved } from "@/lib/orders/order-inventory";
import { PURCHASE_TYPE } from "@/lib/orders/preorders";
import { isStorefrontProductSourceAllowed } from "@/lib/catalog/product-visibility";
import { productAllowsOversell } from "@/lib/products/stock-policy";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import {
  buildVendorSubOrders,
  getOrderItemVendorId,
  groupItemsByOrderVendor,
  resolveOrderVendorContext,
} from "@/lib/orders/order-vendors";
import { ensurePendingChargeTransaction } from "@/lib/payments/payment-transactions";
import { notifyOrderCreatedParticipants } from "@/lib/notifications/notifications";
import { assertStorefrontWriteAllowed } from "@/lib/maintenance";
import { resolveOrderItemCost } from "@/lib/products/item-cost";
import {
  buildOrderItemCustomsSnapshot,
  resolveItemShipping,
  type ProductShippingData,
  type VariantShippingData,
} from "@/lib/catalog/product-shipping";
import { withApi } from "@/lib/api/handler";
import { parsePageLimit } from "@/lib/api/list-query";
import { isCountryAllowed } from "@/lib/intl/country-availability";
import { sanitizeOrdersForCustomer } from "@/lib/orders/order-customer-view";
import { roundMoney } from "@/lib/intl/money";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === 11000
  );
}

/**
 * GET /api/orders
 * Get orders for the current user
 */
// Shape check only. The addresses are normalized and validated below against
// the cart's shippability (digital-only carts need none), the payment method
// against the allow-list, and the shipping selections against the options the
// server just computed — none of that belongs in a static schema.
const DirectOrderBodySchema = z.object({
  shippingAddress: z.any().optional(),
  billingAddress: z.any().optional(),
  paymentMethod: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
  selectedShippingOptionId: z.string().max(100).optional(),
  vendorShippingSelections: z.record(z.string(), z.unknown()).optional(),
});

export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = parsePageLimit(searchParams, {
      defaultLimit: 10,
      maxLimit: 100,
    });
    const status = searchParams.get("status");
    const type = searchParams.get("type");

    const query: Record<string, unknown> = { customerId: session.user.id };

    if (status && status !== "all") {
      query.status = status;
    }
    if (type === "preorders") {
      query.hasPreorder = true;
    } else if (type === "regular") {
      query.hasPreorder = { $ne: true };
    }

    const [orders, total] = await Promise.all([
      Order.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Order.countDocuments(query),
    ]);

    // Never the raw documents: every sub-order carries that vendor's
    // commission, earnings and payout schedule, and this endpoint answers to
    // the shopper.
    return paginatedResponse(
      await sanitizeOrdersForCustomer(orders),
      page,
      limit,
      total,
    );
  },
);

/**
 * POST /api/orders
 * Create a new order from cart
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new AuthenticationError();

    await connectDB();

    const body = await validateBody(request, DirectOrderBodySchema);
    const { billingAddress, paymentMethod, notes } = body;
    let { shippingAddress } = body;
    // The shopper's chosen rate(s). Only ids are accepted — they are looked up
    // in the options the server itself just computed, so an unknown or tampered
    // id simply falls back to the default pick rather than setting a price.
    const selectedShippingOptionId =
      typeof body.selectedShippingOptionId === "string"
        ? body.selectedShippingOptionId
        : undefined;
    const vendorShippingSelections =
      body.vendorShippingSelections &&
      typeof body.vendorShippingSelections === "object" &&
      !Array.isArray(body.vendorShippingSelections)
        ? (Object.fromEntries(
            Object.entries(
              body.vendorShippingSelections as Record<string, unknown>,
            ).filter(([, optionId]) => typeof optionId === "string"),
          ) as Record<string, string>)
        : undefined;
    // Digital-only carts don't need a shipping address — enforced below once
    // the cart items are inspected for shippability.

    // This route only creates orders that are settled outside a gateway.
    // paymentMethod is stored verbatim and later drives refund routing, so an
    // arbitrary string would create an order no refund path can handle.
    const allowedPaymentMethods = new Set(["cod", "manual"]);
    if (!allowedPaymentMethods.has(String(paymentMethod || "").toLowerCase())) {
      throw new ValidationError(
        "Unsupported payment method for direct order placement",
      );
    }

    // Get user's cart with product details for validation
    const cart = await Cart.findOne({ userId: session.user.id })
      .populate(
        "items.productId",
        "name price images vendorId sku status stock inventory slug productSource shipping variants",
      )
      .lean();

    if (!cart || cart.items.length === 0) {
      throw new ValidationError("Cart is empty");
    }
    const cartItems = cart.items as Array<{
      productId: {
        _id?: string;
        name?: string;
        price?: number;
        sku?: string;
        status?: string;
        stock?: number;
        inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean };
        vendorId?: unknown;
        productSource?: unknown;
        shipping?: ProductShippingData;
        variants?: Array<
          VariantShippingData & {
            _id: { toString: () => string };
            price?: number;
          }
        >;
      } | null;
      price: number;
      quantity: number;
      image?: string;
      variantId?: string;
      name?: string;
      purchaseType?: string;
    }>;

    // This endpoint knows nothing about pre-order reservations: it decrements
    // plain stock, so a pre-order line here would sell units that do not
    // exist yet and never touch the preorder counters. Pre-orders go through
    // the standard checkout (/api/payments/checkout), whose prepaid gateways
    // also carry the deposit/pay-later maths COD-style methods cannot.
    if (
      cartItems.some(
        (item) =>
          (item.purchaseType || PURCHASE_TYPE.STANDARD) ===
          PURCHASE_TYPE.PREORDER,
      )
    ) {
      throw new ValidationError(
        "Pre-order items must be checked out through the storefront checkout",
      );
    }

    // Resolve the authoritative, variant-aware unit price from the live product
    // document. product.price is only the MIN variant price (a "from $X" display
    // mirror), so it must never be used for a specific variant line. Using one
    // resolver for subtotal, shipping subtotal, line items and commission keeps
    // order.total === Σ(items.price × qty) and prevents mispriced variant orders.
    const resolveCurrentItemPrice = (item: (typeof cartItems)[number]): number => {
      const product = item.productId;
      if (!product) return item.price ?? 0;
      if (item.variantId && Array.isArray(product.variants)) {
        const variant = product.variants.find(
          (candidate) => candidate._id.toString() === String(item.variantId),
        );
        if (variant && typeof variant.price === "number") return variant.price;
      }
      if (typeof product.price === "number") return product.price;
      return item.price ?? 0;
    };

    const settings = await getSettingsLean();
    assertStorefrontWriteAllowed(settings.maintenance, settings.general?.storeName);
    if (
      shippingAddress?.country &&
      !isCountryAllowed(
        shippingAddress.country,
        settings.general?.countryAvailability,
      )
    ) {
      throw new ValidationError({
        "shippingAddress.country": ["Selected country is not available"],
      });
    }
    if (
      billingAddress?.country &&
      !isCountryAllowed(
        billingAddress.country,
        settings.general?.countryAvailability,
      )
    ) {
      throw new ValidationError({
        "billingAddress.country": ["Selected country is not available"],
      });
    }
    const isMultiVendorEnabled = Boolean(settings.multiVendorMode?.enabled);

    // Validate cart items before checkout
    const invalidItems: string[] = [];
    for (const item of cartItems) {
      if (!item.productId || !item.productId._id) {
        invalidItems.push("A product in your cart no longer exists");
        continue;
      }
      if (item.productId.status !== "active") {
        invalidItems.push(
          `"${item.productId.name || "Unknown"}" is no longer available`
        );
        continue;
      }
      if (
        !isStorefrontProductSourceAllowed(
          item.productId.productSource,
          isMultiVendorEnabled,
        )
      ) {
        invalidItems.push(
          `"${item.productId.name || "Unknown"}" is no longer available`
        );
        continue;
      }
      // Only products whose stock is a real limit can run out — a digital
      // download or a product with tracking off would otherwise be rejected
      // here at 0 despite its buy box and the cart both allowing it.
      const stockIsALimit = !productAllowsOversell(item.productId);
      if (
        stockIsALimit &&
        typeof item.productId.stock === "number" &&
        item.productId.stock < item.quantity
      ) {
        invalidItems.push(
          `"${item.productId.name || "Unknown"}" has insufficient stock (${item.productId.stock} available)`
        );
      }
    }
    if (invalidItems.length > 0) {
      throw new ValidationError(
        `Cart validation failed: ${invalidItems.join("; ")}`
      );
    }

    // Calculate totals using current, variant-aware product prices
    const subtotal = cartItems.reduce(
      (sum, item) => sum + resolveCurrentItemPrice(item) * item.quantity,
      0
    );
    const orderSettings = settings.orders || {};
    const freeShippingThreshold =
      orderSettings.freeShippingThreshold ?? DEFAULT_FREE_SHIPPING_THRESHOLD;
    const defaultShippingCost =
      orderSettings.defaultShippingCost ?? DEFAULT_ORDER_SHIPPING_COST;
    const taxRate = orderSettings.taxRate ?? DEFAULT_ORDER_TAX_RATE;
    // Resolved before the cart is walked so the vendor keys the rate engine
    // groups by are the very same ones the sub-orders are built with below —
    // otherwise per-vendor costs cannot be allocated back onto them.
    const vendorContext = await resolveOrderVendorContext({
      isMultiVendorEnabled,
    });

    let totalWeight = 0;
    let hasShippableItems = false;
    let hasDigitalItems = false;
    const vendorAgg = new Map<
      string,
      {
        subtotal: number;
        shippableSubtotal: number;
        weight: number;
        shippableItemCount: number;
      }
    >();
    for (const item of cartItems) {
      if (!item.productId) continue;
      const variant = item.variantId
        ? item.productId.variants?.find(
            (candidate) =>
              candidate._id.toString() === String(item.variantId),
          )
        : undefined;
      const itemShipping = resolveItemShipping({
        productShipping: item.productId.shipping,
        variantShipping: variant,
        quantity: item.quantity,
        targetWeightUnit: CANONICAL_CART_WEIGHT_UNIT,
      });
      totalWeight += itemShipping.totalWeight;
      hasShippableItems ||= itemShipping.requiresShipping;
      hasDigitalItems ||= !itemShipping.requiresShipping;

      const lineTotal = resolveCurrentItemPrice(item) * item.quantity;
      const vendorId = getOrderItemVendorId(
        item.productId.vendorId,
        vendorContext,
      );
      const agg = vendorAgg.get(vendorId) || {
        subtotal: 0,
        shippableSubtotal: 0,
        weight: 0,
        shippableItemCount: 0,
      };
      agg.subtotal += lineTotal;
      agg.weight += itemShipping.totalWeight;
      if (itemShipping.requiresShipping) {
        agg.shippableSubtotal += lineTotal;
        agg.shippableItemCount += item.quantity;
      }
      vendorAgg.set(vendorId, agg);
    }

    if (hasShippableItems && !shippingAddress) {
      throw new ValidationError("Shipping address is required");
    }
    if (!shippingAddress) {
      // Digital-only: billing stands in as the order's address snapshot so
      // downstream consumers (emails, invoices, admin) keep rendering one.
      if (!billingAddress) {
        throw new ValidationError("Billing address is required");
      }
      shippingAddress = billingAddress;
    }
    const digitalOnly = !hasShippableItems;

    // Digital deliverables release off the order itself, not off a courier
    // hand-over, so any digital line on a COD order would be handed over before
    // the cash is collected — and on a mixed order the shopper could keep the
    // files and refuse the parcel. Compared case-insensitively because the
    // allow-list above accepts any casing and stores it verbatim.
    if (hasDigitalItems && String(paymentMethod).toLowerCase() === "cod") {
      throw new ValidationError(
        "Cash on Delivery is not available for orders that include digital items",
      );
    }

    // The same resolver every gateway checkout path uses, so a COD order is
    // priced, rated per vendor, and charged duty exactly like a card order.
    const shippingResolution = hasShippableItems
      ? await resolveCheckoutShipping({
          subtotal,
          totalWeight,
          vendorAgg,
          destination: {
            country: shippingAddress.country,
            state: shippingAddress.state,
          },
          platformShipping: settings.shipping as ShippingSettings | undefined,
          orders: { freeShippingThreshold, defaultShippingCost },
          isMultiVendorEnabled,
          selectedShippingOptionId,
          vendorShippingSelections,
        })
      : null;
    if (shippingResolution && !shippingResolution.available) {
      throw new ValidationError(SHIPPING_UNAVAILABLE_MESSAGE);
    }
    const shippingCost = shippingResolution?.shippingCost ?? 0;
    const customsEstimate = shippingResolution?.customs;
    const dutyAmount = customsEstimate?.dutyAmount ?? 0;
    const tax = roundMoney(subtotal * taxRate);
    const total = subtotal + shippingCost + tax + dutyAmount;

    // Generate order number (with retry for uniqueness)

    const vendorItems = groupItemsByOrderVendor(
      cartItems,
      vendorContext,
      (item) => item.productId?.vendorId,
    );
    const subOrders = await buildVendorSubOrders(vendorItems, {
      codCollectedByDefault: settings.shipping?.codCollectedBy,
      getProductId: (item) => item.productId?._id || item.productId,
      getVariantId: (item) => item.variantId,
      getName: (item) => item.productId?.name || item.name,
      getSku: (item) => item.productId?.sku,
      getQuantity: (item) => item.quantity,
      getPrice: (item) => resolveCurrentItemPrice(item),
      getCost: (item) =>
        resolveOrderItemCost({
          product: item.productId,
          variantId: item.variantId,
        }),
      getImage: (item) => item.image,
      getCustoms: (item) =>
        item.productId
          ? buildOrderItemCustomsSnapshot({
              productShipping: item.productId.shipping,
              variantShipping: item.variantId
                ? item.productId.variants?.find(
                    (candidate) =>
                      candidate._id.toString() === String(item.variantId),
                  )
                : undefined,
            })
          : undefined,
      fallbackCommissionPercent:
        settings.orders?.commission?.vendorRate ?? DEFAULT_VENDOR_COMMISSION_RATE,
      status: "pending",
    });

    allocateSubOrderShipping(subOrders, {
      vendorShippingCosts:
        shippingResolution?.vendorShippingCosts ?? new Map(),
      orderShippingCost: shippingCost,
      orderShippingMethod: shippingResolution?.selectedShippingMethod,
    });

    // Create order with retry for order number uniqueness
    const orderData = {
      customerId: session.user.id,
      currency: settings.general?.defaultCurrency || "USD",
      items: cartItems.map((item) => ({
        productId: item.productId?._id || item.productId,
        vendorId: getOrderItemVendorId(item.productId?.vendorId, vendorContext),
        variantId: item.variantId,
        name: item.productId?.name || item.name,
        sku: item.productId?.sku || "",
        price: resolveCurrentItemPrice(item),
        cost: resolveOrderItemCost({
          product: item.productId,
          variantId: item.variantId,
        }),
        quantity: item.quantity,
        image: item.image,
        customs: item.productId
          ? buildOrderItemCustomsSnapshot({
              productShipping: item.productId.shipping,
              variantShipping: item.variantId
                ? item.productId.variants?.find(
                    (candidate) =>
                      candidate._id.toString() === String(item.variantId),
                  )
                : undefined,
            })
          : undefined,
      })),
      subOrders,
      shippingAddress,
      billingAddress: billingAddress || shippingAddress,
      digitalOnly,
      paymentMethod,
      paymentStatus: "pending",
      subtotal,
      shippingCost,
      shippingMethod: shippingResolution?.selectedShippingMethod,
      customs: customsEstimate
        ? {
            dutyAmount: customsEstimate.dutyAmount,
            dutyMode: customsEstimate.dutyMode,
            international: customsEstimate.international,
            collectedAtCheckout: customsEstimate.collectedAtCheckout,
          }
        : undefined,
      tax,
      discount: 0,
      total,
      status: "pending",
      notes,
    };

    const inventoryLines = cartItems.map((item) => ({
      productId: String(item.productId?._id || item.productId),
      variantId: item.variantId ? String(item.variantId) : undefined,
      quantity: item.quantity,
    }));

    // Idempotency guard: atomically claim the cart so a double-submitted
    // checkout (double-click, network retry) can't create two orders and
    // decrement stock twice from the same cart. A stale claim from a crashed
    // request expires after 30s; a successful checkout deletes the cart.
    const claimStaleBefore = new Date(Date.now() - 30_000);
    const cartClaim = await Cart.findOneAndUpdate(
      {
        _id: cart._id,
        $or: [
          { checkoutClaimedAt: null },
          { checkoutClaimedAt: { $exists: false } },
          { checkoutClaimedAt: { $lt: claimStaleBefore } },
        ],
      },
      { $set: { checkoutClaimedAt: new Date() } },
    ).lean();
    if (!cartClaim) {
      throw new ValidationError(
        "This order is already being placed. Please wait a moment.",
      );
    }
    const releaseCartClaim = () =>
      Cart.updateOne(
        { _id: cart._id },
        { $unset: { checkoutClaimedAt: "" } },
      ).catch((err) =>
        console.error("Failed to release checkout claim:", err),
      );

    // Decrement inventory before creating the order. If the order fails to
    // persist after retries, restore inventory to avoid permanent over-reserve.
    try {
      await decrementInventory(inventoryLines);
    } catch (err) {
      await releaseCartClaim();
      if (err instanceof InsufficientStockError) {
        throw new ValidationError(
          "Some items are out of stock. Please update your cart and try again.",
        );
      }
      throw err;
    }
    revalidateProductContent({
      slugs: cartItems
        .map((item) => (item.productId as { slug?: string } | null)?.slug)
        .filter(
          (slug): slug is string =>
            typeof slug === "string" && slug.length > 0,
        ),
    });

    let order;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          order = await Order.create({
            ...orderData,
            orderNumber: await getNextOnlineOrderNumber(orderSettings.prefix),
          });
          break;
        } catch (err) {
          if (isDuplicateKeyError(err) && attempt < 2) continue;
          throw err;
        }
      }
    } catch (err) {
      await restoreInventory(inventoryLines).catch((restoreErr) =>
        console.error("Failed to restore inventory after order failure:", restoreErr),
      );
      await releaseCartClaim();
      throw err;
    }

    if (!order) {
      await restoreInventory(inventoryLines).catch((restoreErr) =>
        console.error("Failed to restore inventory after order failure:", restoreErr),
      );
      await releaseCartClaim();
      throw new Error("Failed to create order after retries");
    }

    // Inventory was decremented before order create; mark sub-orders reserved.
    await markOrderInventoryReserved(String(order._id)).catch((err) =>
      console.error("Failed to mark inventory reserved on order:", err),
    );

    if (paymentMethod === "cod") {
      await ensurePendingChargeTransaction({
        _id: String(order._id),
        orderNumber: order.orderNumber,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        paymentId: order.paymentId,
        stripePaymentIntentId: order.stripePaymentIntentId,
        paypalCaptureId: order.paypalCaptureId,
        subtotal: order.subtotal,
        shippingCost: order.shippingCost,
        tax: order.tax,
        discount: order.discount,
        total: order.total,
        currency: settings.general?.defaultCurrency,
        channel: order.channel || "online",
        createdAt: order.createdAt,
      }).catch((err) => {
        console.error("Failed to sync pending COD payment transaction:", err);
      });
    }

    await Cart.deleteOne({ userId: session.user.id });

    // Update customer profile stats (fire-and-forget)
    import("@/lib/customers/customer")
      .then(({ refreshCustomerStats }) =>
        refreshCustomerStats(session.user.id),
      )
      .catch((err) =>
        console.error("Failed to refresh customer stats:", err),
      );

    await notifyOrderCreatedParticipants(order).catch((err) =>
      console.error("Failed to create order notifications:", err),
    );

    // Birth event for the timeline. The shopper placed this, so it is attributed
    // to them rather than to a staff account.
    await auditOrderPlaced(customerActor(request, session), order, {
      source: "storefront",
      total: order.total,
      currency: order.currency || settings.general?.defaultCurrency,
      itemCount: order.items.length,
      paymentMethod: order.paymentMethod,
    });

    return createdResponse(order);
  } catch (error) {
    return handleApiError(error);
  }
}
