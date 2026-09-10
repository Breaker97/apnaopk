import { z } from "zod";
import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Cart, Product, User } from "@/models";
import { getSettings } from "@/models/settings.model";
import {
  CANONICAL_CART_WEIGHT_UNIT,
  SHIPPING_UNAVAILABLE_MESSAGE,
  type ShippingSettings,
} from "@/lib/shipping/shipping";
import {
  resolveCheckoutShipping,
  buildShippingMetadata,
} from "@/lib/checkout/checkout-shipping";
import { calculateCheckoutTotals } from "@/lib/catalog/discounts";
import {
  pickupCheckoutCharges,
  resolvePickupCheckoutFulfillment,
  serializePickupFulfillmentMetadata,
  type PickupFulfillmentSnapshot,
} from "@/lib/checkout/checkout-pickup";
import {
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
  toStripeAmount,
} from "@/lib/payments/stripe";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import { validateAndCalculateCoupon } from "@/lib/catalog/coupons";
import { validateBody } from "@/lib/api/validate";
import { PRODUCT_STATUS } from "@/config/app.config";
import { isStorefrontProductSourceAllowed } from "@/lib/catalog/product-visibility";
import {
  PURCHASE_TYPE,
  resolvePurchaseType,
  type PreorderSettingsShape,
} from "@/lib/orders/preorders";
import {
  rateLimitByIP,
  rateLimitBySession,
  rateLimitByUser,
} from "@/lib/api/rate-limit-middleware";
import { ValidationError } from "@/lib/api/errors";
import { updateCheckoutSnapshot } from "@/lib/orders/abandoned-checkouts";
import { assertStorefrontWriteAllowed } from "@/lib/maintenance";
import {
  DEFAULT_FREE_SHIPPING_THRESHOLD,
  DEFAULT_ORDER_SHIPPING_COST,
  DEFAULT_ORDER_TAX_RATE,
} from "@/lib/orders/order-settings";
import {
  resolveItemShipping,
  type ProductShippingData,
} from "@/lib/catalog/product-shipping";
import { withApi } from "@/lib/api/handler";
import { isCountryAllowed } from "@/lib/intl/country-availability";

type CheckoutShippingAddress = {
  fullName: string;
  firstName?: string;
  lastName?: string;
  street: string;
  apartment?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone?: string;
};

const CreateStripeIntentBodySchema = z.object({
  // Optional at the schema level: digital-only carts send billing only. The
  // route enforces presence once item shippability is known.
  shippingAddress: z
    .object({
      fullName: z.string().min(1),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      street: z.string().min(1),
      apartment: z.string().optional(),
      city: z.string().min(1),
      state: z.string().optional().default(""),
      postalCode: z.string().min(1),
      country: z.string().min(1),
      phone: z.string().optional(),
    })
    .optional(),
  billingAddress: z
    .object({
      fullName: z.string().min(1),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      street: z.string().min(1),
      apartment: z.string().optional(),
      city: z.string().min(1),
      state: z.string().optional().default(""),
      postalCode: z.string().min(1),
      country: z.string().min(1),
      phone: z.string().optional(),
    })
    .optional(),
  locale: z.string().optional(),
  email: z.string().email().optional(),
  couponCode: z.string().min(3).max(20).optional(),
  preorderAcknowledged: z.boolean().optional(),
  selectedShippingOptionId: z.string().max(100).optional(),
  vendorShippingSelections: z.record(z.string(), z.string().max(100)).optional(),
  fulfillmentMethod: z.enum(["delivery", "pickup"]).optional().default("delivery"),
  pickupLocationId: z.string().min(1).optional(),
});

interface CartItem {
  productId: {
    _id: string;
    name: string;
    price: number;
    images?: string[];
    vendorId: string | { _id: string };
    sku?: string;
    shipping?: ProductShippingData;
  };
  variantId?: string;
  quantity: number;
  price: number;
  purchaseType?: string;
  preorderOutstandingAmount?: number;
}

type StockCheckVariant = {
  _id: { toString: () => string };
  stock?: number;
  sku?: string;
  weight?: number;
  weightUnit?: "g" | "kg" | "lb" | "oz";
  requiresShipping?: boolean;
  preorder?: PreorderSettingsShape;
};

type StockCheckProduct = {
  stock?: number;
  sku?: string;
  status?: string;
  productSource?: unknown;
  category?: string | { toString: () => string };
  variants?: StockCheckVariant[];
  preorder?: PreorderSettingsShape;
  shipping?: ProductShippingData;
};

/**
 * POST /api/payments/stripe/intent
 * Create Stripe PaymentIntent for inline card payment
 */
export const POST = withApi(
  { auth: "optional" },
  async ({ request, session }) => {
    const cartSessionId = request.cookies?.get("cart_session")?.value;

    if (session?.user?.id) {
      await rateLimitByUser(
        request,
        session.user.id,
        "payments:stripe-intent",
        "strict",
        session.user.role
      );
    } else if (cartSessionId) {
      await rateLimitBySession(
        request,
        cartSessionId,
        "payments:stripe-intent",
        "strict",
      );
    } else {
      await rateLimitByIP(request, "strict");
    }

    await connectDB();

    const {
      shippingAddress,
      billingAddress,
      locale,
      email,
      couponCode,
      preorderAcknowledged,
      selectedShippingOptionId,
      vendorShippingSelections,
      fulfillmentMethod,
      pickupLocationId,
    } = await validateBody(request, CreateStripeIntentBodySchema);

    // Card checkout used to refuse collection outright, because confirming an
    // order claimed a slot's capacity and an abandoned PaymentIntent would
    // strand it. Slot booking is gone — a branch takes no reservations, only
    // opening hours — so there is nothing left to strand, while the restriction
    // went on hiding collection from every store that does not take cash.
    //
    // Nothing the client sent is trusted here beyond *which* branch: the
    // resolver re-reads the address and the branch name server-side, so a
    // tampered payload cannot put a different address on the order.

    const shippingAddressInput = shippingAddress
      ? {
          ...shippingAddress,
          state: shippingAddress.state?.trim() || "N/A",
        }
      : undefined;
    const billingAddressInput = billingAddress
      ? {
          ...billingAddress,
          state: billingAddress.state?.trim() || "N/A",
        }
      : shippingAddressInput;
    const customerEmail =
      typeof email === "string" && email.trim().length > 0
        ? email.trim()
        : session?.user?.email;

    if (!session?.user?.id && !customerEmail) {
      throw new ValidationError({
        email: ["Email is required for guest checkout"],
      });
    }

    const settings = await getSettings();
    assertStorefrontWriteAllowed(settings.maintenance, settings.general?.storeName);
    if (
      shippingAddressInput?.country &&
      !isCountryAllowed(
        shippingAddressInput.country,
        settings.general?.countryAvailability,
      )
    ) {
      throw new ValidationError({
        "shippingAddress.country": ["Selected country is not available"],
      });
    }
    if (
      billingAddressInput?.country &&
      !isCountryAllowed(
        billingAddressInput.country,
        settings.general?.countryAvailability,
      )
    ) {
      throw new ValidationError({
        "billingAddress.country": ["Selected country is not available"],
      });
    }
    const isMultiVendorEnabled = Boolean(settings.multiVendorMode?.enabled);
    const paymentSettings = settings.payment || {};
    const stripeSettings = paymentSettings.stripe;

    if (!stripeSettings?.enabled) {
      throw new ValidationError("Stripe is disabled");
    }
    const stripeSecretKey = resolveStripeCredentials(stripeSettings).secretKey;
    if (!isStripeSecretKeyConfigured(stripeSecretKey)) {
      throw new ValidationError(
        "Stripe is enabled but not configured. Please add Stripe Secret Key in Admin → Settings → Payments.",
      );
    }

    const cartQuery = session?.user?.id
      ? { userId: session.user.id }
      : cartSessionId
        ? { sessionId: cartSessionId }
        : null;

    if (!cartQuery) {
      throw new ValidationError({ cart: ["Cart is empty"] });
    }

    const cart = await Cart.findOne(cartQuery)
      .populate({
        path: "items.productId",
        // `shipping` + `inventory` decide whether `stock` is a limit at all
        // (lib/products/stock-policy.ts) — resolvePurchaseType() reads them.
        select: "name price images vendorId stock inventory sku shipping variants",
        populate: { path: "vendorId", select: "_id" },
      })
      .lean();

    if (!cart || !cart.items || cart.items.length === 0) {
      throw new ValidationError({ cart: ["Cart is empty"] });
    }

    const items = cart.items as unknown as CartItem[];
    // Mirror of the checkout route: a guest paying with an email that already
    // belongs to a registered account gets the order attached to that account
    // (via the intent metadata the finalizer reads back). The finalizer
    // detects a true guest by userId doubling as the cart id, so this must
    // resolve before the metadata is stamped.
    const guestAccount =
      !session?.user?.id && customerEmail
        ? await User.findOne({ email: customerEmail.trim().toLowerCase() })
            .select("_id")
            .lean()
        : null;
    const customerId =
      session?.user?.id ||
      (guestAccount ? String(guestAccount._id) : String(cart._id));
    const purchaseTypes = new Set(
      items.map((item) => item.purchaseType || PURCHASE_TYPE.STANDARD),
    );
    if (purchaseTypes.size > 1) {
      throw new ValidationError({
        cart: [
          "Pre-order items must be checked out separately from regular items",
        ],
      });
    }
    const hasPreorder = purchaseTypes.has(PURCHASE_TYPE.PREORDER);
    if (hasPreorder && preorderAcknowledged !== true) {
      throw new ValidationError({
        preorderAcknowledged: ["Please confirm the pre-order shipping terms"],
      });
    }

    const couponCartItems: Array<{
      productId: string;
      price: number;
      quantity: number;
      categoryId?: string;
    }> = [];

    // Accumulate shippable weight overall and per vendor so the shared resolver
    // can rate weight-based and per-vendor shipping (parity with checkout).
    let totalWeight = 0;
    let hasShippableItems = false;
    const vendorAgg = new Map<
      string,
      {
        subtotal: number;
        shippableSubtotal: number;
        weight: number;
        shippableItemCount: number;
      }
    >();
    const itemVendorId = (item: CartItem) =>
      String(
        (item.productId.vendorId as { _id?: string })?._id ||
          item.productId.vendorId ||
          "",
      );

    // Fetch every cart product in one query instead of one round-trip per item.
    const stockCheckProducts = await Product.find({
      _id: { $in: items.map((item) => item.productId._id) },
    }).lean<Array<StockCheckProduct & { _id: { toString: () => string } }>>();
    const stockCheckProductById = new Map(
      stockCheckProducts.map((product) => [product._id.toString(), product]),
    );
    for (const item of items) {
      const product = stockCheckProductById.get(String(item.productId._id));
      if (!product) {
        throw new ValidationError({
          stock: [
            `${item.productId.name} is out of stock or has insufficient quantity`,
          ],
        });
      }
      if (
        product.status !== PRODUCT_STATUS.ACTIVE ||
        !isStorefrontProductSourceAllowed(
          product.productSource,
          isMultiVendorEnabled,
        )
      ) {
        throw new ValidationError({
          stock: [
            `${item.productId.name} is out of stock or has insufficient quantity`,
          ],
        });
      }

      const purchase = resolvePurchaseType({
        product,
        variantId: item.variantId,
        requestedQuantity: item.quantity,
      });
      const expectedPurchaseType = item.purchaseType || PURCHASE_TYPE.STANDARD;
      if (!purchase || purchase.purchaseType !== expectedPurchaseType) {
        throw new ValidationError({
          stock: [
            `${item.productId.name} is out of stock or has insufficient quantity`,
          ],
        });
      }

      const variantSku = item.variantId
        ? product.variants?.find(
            (variant) => variant._id.toString() === String(item.variantId),
          )?.sku
        : undefined;
      if (!item.productId.sku && !variantSku) {
        throw new ValidationError({
          sku: [`Missing SKU for product "${item.productId.name}"`],
        });
      }

      couponCartItems.push({
        productId: String(item.productId._id),
        price: item.price,
        quantity: item.quantity,
        categoryId: product.category ? String(product.category) : undefined,
      });

      const selectedVariant = item.variantId
        ? product.variants?.find(
            (variant) => variant._id.toString() === String(item.variantId),
          )
        : undefined;
      const itemShipping = resolveItemShipping({
        productShipping: product.shipping,
        variantShipping: selectedVariant,
        quantity: item.quantity,
        targetWeightUnit: CANONICAL_CART_WEIGHT_UNIT,
      });
      const lineWeight = itemShipping.totalWeight;
      totalWeight += lineWeight;
      if (itemShipping.requiresShipping) hasShippableItems = true;

      const vId = itemVendorId(item);
      const agg = vendorAgg.get(vId) || {
        subtotal: 0,
        shippableSubtotal: 0,
        weight: 0,
        shippableItemCount: 0,
      };
      agg.subtotal += item.price * item.quantity;
      agg.weight += lineWeight;
      if (itemShipping.requiresShipping) {
        agg.shippableItemCount += item.quantity;
        agg.shippableSubtotal += item.price * item.quantity;
      }
      vendorAgg.set(vId, agg);
    }

    // Address rules, now that shippability is known — mirrors the online
    // checkout route: physical carts need a shipping address; digital-only
    // carts need billing only, snapshotted as the order address.
    if (hasShippableItems && !shippingAddressInput) {
      throw new ValidationError({
        shippingAddress: ["Shipping address is required"],
      });
    }
    if (!shippingAddressInput && !billingAddressInput) {
      throw new ValidationError({
        billingAddress: ["Billing address is required"],
      });
    }
    const normalizedShippingAddress = (shippingAddressInput ??
      billingAddressInput)!;
    const normalizedBillingAddress =
      billingAddressInput ?? normalizedShippingAddress;

    const subtotal = items.reduce(
      (sum: number, item: CartItem) => sum + item.price * item.quantity,
      0,
    );
    const orderSettings = settings.orders || {};
    const freeShippingThreshold =
      orderSettings.freeShippingThreshold ?? DEFAULT_FREE_SHIPPING_THRESHOLD;
    const defaultShippingCost =
      orderSettings.defaultShippingCost ?? DEFAULT_ORDER_SHIPPING_COST;
    const taxRate = orderSettings.taxRate ?? DEFAULT_ORDER_TAX_RATE;

    let appliedCoupon:
      | {
          couponId: string;
          code: string;
          type: string;
          value: number;
          discount: number;
          maxDiscount?: number;
        }
      | undefined;
    const destination = {
      country: normalizedShippingAddress.country,
      state: normalizedShippingAddress.state,
    };
    const pickupFulfillment: PickupFulfillmentSnapshot | undefined =
      fulfillmentMethod === "pickup"
        ? pickupLocationId
          ? await resolvePickupCheckoutFulfillment({
              owner: { userId: session?.user?.id, sessionId: cartSessionId },
              pickupLocationId,
            })
          : (() => {
              throw new ValidationError("A pickup location is required");
            })()
        : undefined;

    // Nothing is shipped to a collection, so no rate is quoted and no duty is
    // assessed — the goods never cross a border on the store's account. Mirrors
    // the online-checkout route exactly; the two must agree, or a shopper is
    // charged differently for the same order depending on how they pay.
    // Same shared resolver as the online-checkout route — keeps the card path
    // in parity (weight-based, selected rate, per-vendor split, duties).
    const shippingResolution = pickupFulfillment
      ? null
      : await resolveCheckoutShipping({
          subtotal,
          totalWeight,
          vendorAgg,
          destination,
          platformShipping: settings.shipping as ShippingSettings | undefined,
          orders: { freeShippingThreshold, defaultShippingCost },
          isMultiVendorEnabled,
          selectedShippingOptionId,
          vendorShippingSelections,
        });
    if (shippingResolution && !shippingResolution.available) {
      throw new ValidationError(SHIPPING_UNAVAILABLE_MESSAGE);
    }
    const pickupCharges = pickupFulfillment
      ? pickupCheckoutCharges({ shippingCost: 0, dutyAmount: 0 })
      : null;
    const shippingCost =
      pickupCharges?.shippingCost ?? shippingResolution!.shippingCost;
    const dutyAmount =
      pickupCharges?.dutyAmount ?? shippingResolution!.customs.dutyAmount;
    if (couponCode) {
      appliedCoupon = await validateAndCalculateCoupon({
        code: couponCode,
        subtotal,
        shippingCost,
        cartItems: couponCartItems,
        userId: session?.user?.id,
      });
    }

    // Coupons/discounts are computed from the selected shipping cost; duties are
    // added on top of the discounted total (never discounted).
    const totals = calculateCheckoutTotals({
      subtotal,
      shippingCost,
      taxRate,
      coupon: appliedCoupon,
      currency: settings.general?.defaultCurrency,
    });
    const discount = totals.discount;
    const tax = totals.tax;
    const total = totals.total + dutyAmount;
    // For deposit-mode pre-orders only the deposit is due now; the outstanding
    // balance is collected later. Charging the full `total` here (as before)
    // takes the whole amount up front yet the order is still marked
    // partially_paid, so the balance flow would charge the customer twice.
    const preorderOutstandingAmount = items.reduce(
      (sum: number, item: CartItem) =>
        sum + Number(item.preorderOutstandingAmount || 0),
      0,
    );
    const paymentDueNow = Math.max(0, total - preorderOutstandingAmount);

    const activeLocale =
      typeof locale === "string" && locale.length > 0 ? locale : "en";
    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";

    const stripe = getStripeForSecretKey(stripeSecretKey);
    const currency = (settings.general?.defaultCurrency || "USD").toLowerCase();

    const paymentIntent = await stripe.paymentIntents.create({
      amount: toStripeAmount(paymentDueNow, currency),
      currency,
      payment_method_types: ["card"],
      receipt_email: customerEmail,
      metadata: {
        userId: customerId,
        cartId: String(cart._id),
        customerEmail: customerEmail || "",
        locale: activeLocale,
        shippingAddress: JSON.stringify(
          normalizedShippingAddress as CheckoutShippingAddress,
        ),
        billingAddress: JSON.stringify(
          normalizedBillingAddress as CheckoutShippingAddress,
        ),
        subtotal: String(subtotal),
        tax: String(tax),
        discount: String(discount),
        total: String(total),
        couponCode: appliedCoupon?.code || "",
        couponType: appliedCoupon?.type || "",
        couponValue: appliedCoupon ? String(appliedCoupon.value) : "",
        couponId: appliedCoupon?.couponId || "",
        // A collection has no rate to describe and no vendor split to carry, so
        // the shipping keys are written as their zeroed equivalents rather than
        // omitted — `finalizeStripePaymentIntentOrder` reads them by name, and a
        // missing key is not the same as a free one. Mirrors the shape the
        // online-checkout route sends for the identical order.
        ...(shippingResolution
          ? buildShippingMetadata(shippingResolution)
          : {
              shipping: "0",
              shippingMethod: JSON.stringify({
                name: "Local pickup",
                optionId: "pickup",
              }),
              customsDuty: "0",
              customs: JSON.stringify({
                dutyAmount: 0,
                dutyMode: "DDU" as const,
                international: false,
                collectedAtCheckout: false,
              }),
              vendorShipping: "",
            }),
        pickupFulfillment:
          serializePickupFulfillmentMetadata(pickupFulfillment),
      },
    });

    if (!paymentIntent.client_secret) {
      return NextResponse.json(
        { success: false, message: "Failed to create payment intent" },
        { status: 500 },
      );
    }

    const cartDoc = await Cart.findById(cart._id);
    if (cartDoc) {
      await updateCheckoutSnapshot(cartDoc, {
        origin,
        locale: activeLocale,
        email: customerEmail,
        phone: normalizedShippingAddress.phone,
        customerName: normalizedShippingAddress.fullName,
        customerLocale: activeLocale,
        shippingAddress: normalizedShippingAddress,
        billingAddress: normalizedBillingAddress,
        gateway: "card",
        subtotalPrice: subtotal,
        shippingPrice: shippingCost,
        totalTax: tax,
        totalDiscounts: discount,
        totalPrice: total,
        presentmentCurrency: currency,
        paymentEvent: {
          gateway: "card",
          status: "created",
          paymentId: paymentIntent.id,
          message: "Stripe PaymentIntent created",
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
      },
    });
  },
);
