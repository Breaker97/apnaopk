import { after, NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Cart, Product, Order, User } from "@/models";
import {
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
  toStripeAmount,
} from "@/lib/payments/stripe";
import { getSettings } from "@/models/settings.model";
import {
  resolveIotecCredentials,
  resolveMtnMomoCredentials,
  resolvePayPalCredentials,
  resolvePesapalCredentials,
  resolveOrangeMoneyCredentials,
  resolveStripeCredentials,
} from "@/lib/settings/credentials";
import { createPayPalOrder } from "@/lib/payments/paypal";
import {
  createRazorpayOrder,
  getRazorpayCredentials,
} from "@/lib/payments/razorpay";
import { buildRazorpayCallbackUrl } from "@/lib/payments/razorpay-callback";
import {
  getPaystackCredentials,
  initializePaystackTransaction,
} from "@/lib/payments/paystack";
import {
  getPesapalCredentials,
  isPesapalCurrency,
  normalizePesapalCountryCode,
  PESAPAL_CURRENCIES,
  submitPesapalOrder,
} from "@/lib/payments/pesapal";
import {
  getIotecCredentials,
  IOTEC_CURRENCY,
  IOTEC_MIN_AMOUNT,
  IotecApiError,
  normalizeUgandaMsisdn,
  submitIotecCardCollection,
  submitIotecCollection,
  type IotecCollectionResponse,
} from "@/lib/payments/iotec";
import {
  getOrangeMoneyCredentials,
  isOrangeMoneyCurrency,
  ORANGE_MONEY_CURRENCIES,
  orangeMoneyChargeCurrency,
  orangeMoneyLang,
  submitOrangeMoneyPayment,
} from "@/lib/payments/orange-money";
import {
  getMtnMomoCredentials,
  isMtnMomoCurrency,
  MTN_MOMO_CURRENCIES,
  MtnMomoApiError,
  mtnMomoCallbackUrl,
  mtnMomoChargeCurrency,
  normalizeMtnMomoMsisdn,
  requestMtnMomoPayment,
} from "@/lib/payments/mtn-momo";
import { randomUUID } from "crypto";
import { currencyMinorUnitExponent } from "@/lib/intl/money";
import { sendOrderConfirmationEmail } from "@/lib/email/order-emails";
import {
  decrementInventory,
  InsufficientStockError,
  restoreInventory,
} from "@/lib/inventory/inventory";
import { markOrderInventoryReserved } from "@/lib/orders/order-inventory";
import {
  getOrderPreorderLines,
  getPreorderReleaseDateForOrder,
  markOrderPreorderReserved,
  PREORDER_ITEM_STATUS,
  PURCHASE_TYPE,
  releasePreorderQuantity,
  reservePreorderQuantity,
  resolvePurchaseType,
  type PreorderSettingsShape,
} from "@/lib/orders/preorders";
import { getNextOnlineOrderNumber } from "@/lib/orders/order-number";
import {
  DEFAULT_FREE_SHIPPING_THRESHOLD,
  DEFAULT_ORDER_SHIPPING_COST,
  DEFAULT_ORDER_TAX_RATE,
} from "@/lib/orders/order-settings";
import {
  couponHoldKey,
  holdCouponUse,
  releaseCouponUse,
  takeCouponUse,
  splitCouponDiscount,
  validateAndCalculateCoupon,
} from "@/lib/catalog/coupons";
import {
  CANONICAL_CART_WEIGHT_UNIT,
  SHIPPING_UNAVAILABLE_MESSAGE,
  type ShippingSettings,
} from "@/lib/shipping/shipping";
import {
  resolveCheckoutShipping,
  allocateSubOrderShipping,
  buildShippingMetadata,
} from "@/lib/checkout/checkout-shipping";
import { checkoutCartFingerprint } from "@/lib/checkout/checkout-cart-fingerprint";
import {
  calculateCheckoutTotals,
  isFreeShippingCouponType,
} from "@/lib/catalog/discounts";
import {
  preorderOutstandingAfterCoupon,
  sumPreorderOutstandingAfterCoupon,
  type PreorderSplitLine,
} from "@/lib/orders/preorder-coupon-split";
import {
  ConflictError,
  handleApiError,
  ValidationError,
} from "@/lib/api/errors";
import {
  CART_PRICES_CHANGED_MESSAGE,
  CART_PRICES_CHANGED_REASON,
  cartLinePriceChanged,
  type CartPriceChange,
} from "@/lib/checkout/cart-price-change";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import {
  rateLimitByIP,
  rateLimitBySession,
  rateLimitByUser,
} from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/api/validate";
import { CheckoutSchema } from "@/lib/validations";
import { enforceCheckoutSubmission } from "@/lib/checkout/checkout-submission";
import type { OrderCheckoutField } from "@/types";
import { assertCashOnDeliveryAllowed } from "@/lib/checkout/cod-eligibility";
import { assertCartVendorsSellable } from "@/lib/checkout/sellable-vendors";
import { isStorefrontProductSourceAllowed } from "@/lib/catalog/product-visibility";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import {
  bindOffersToOrder,
  loadShopperOffers,
  matchOffersToLines,
  quoteOfferLineKey,
} from "@/lib/quotes/quote-offer";
import {
  buildVendorSubOrders,
  getOrderItemVendorId,
  groupItemsByOrderVendor,
  resolveOrderVendorContext,
} from "@/lib/orders/order-vendors";
import { ensurePendingChargeTransaction } from "@/lib/payments/payment-transactions";
import {
  assertDeferredBalanceCollectable,
  assertPreorderMandateAccepted,
} from "@/lib/payments/deferred-balance";
import {
  resolveGuestStripeCustomerId,
  resolveStripeCustomerId,
} from "@/lib/payments/stripe-customer";
import {
  PREORDER_CARD_SETUP_KIND,
  buildPreorderMandateText,
  preorderMandateRequired,
} from "@/lib/payments/preorder-mandate";
import {
  markCheckoutRecovered,
  updateCheckoutSnapshot,
} from "@/lib/orders/abandoned-checkouts";
import { notifyOrderCreatedParticipants } from "@/lib/notifications/notifications";
import { assertStorefrontWriteAllowed } from "@/lib/maintenance";
import { resolveOrderItemCost } from "@/lib/products/item-cost";
import {
  buildOrderItemCustomsSnapshot,
  resolveItemShipping,
  type ProductShippingData,
  type VariantShippingData,
} from "@/lib/catalog/product-shipping";
import {
  pickupCheckoutCharges,
  resolvePickupCheckoutFulfillment,
  type PickupFulfillmentSnapshot,
} from "@/lib/checkout/checkout-pickup";
import { isCountryAllowed } from "@/lib/intl/country-availability";

interface CartItem {
  productId: {
    _id: string;
    name: string;
    price: number;
    images?: string[];
    vendorId: string | { _id: string };
    sku?: string;
    slug?: string;
    shipping?: ProductShippingData;
    variants?: Array<VariantShippingData & { _id: { toString: () => string } }>;
  };
  variantId?: string;
  quantity: number;
  price: number;
  /**
   * The quote offer this line is priced by, re-resolved from the shopper's
   * account on every checkout rather than trusted off the cart document.
   */
  quoteId?: string;
  purchaseType?: string;
  preorderReleaseDate?: Date;
  preorderMessage?: string;
  preorderPaymentMode?: "full" | "deposit" | "pay_later";
  preorderDepositAmount?: number;
  preorderOutstandingAmount?: number;
  preorderSupplierEta?: Date;
  preorderBatchName?: string;
}

/** A cart line, as the coupon split over a pre-order balance reads it. */
function preorderSplitLines(items: CartItem[]): PreorderSplitLine[] {
  return items.map((item) => {
    const vendor = item.productId.vendorId;
    return {
      price: item.price,
      quantity: item.quantity,
      purchaseType: item.purchaseType,
      preorderOutstandingAmount: item.preorderOutstandingAmount,
      vendorId: vendor ? String(typeof vendor === "object" ? vendor._id : vendor) : null,
    };
  });
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
  priceOnRequest?: boolean;
  productSource?: unknown;
  category?: string | { toString: () => string };
  variants?: StockCheckVariant[];
  preorder?: PreorderSettingsShape;
  shipping?: ProductShippingData;
};

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

/**
 * POST /api/payments/checkout
 * Create checkout payment session/order
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const cartSessionId = request.cookies?.get("cart_session")?.value;

    if (session?.user?.id) {
      await rateLimitByUser(
        request,
        session.user.id,
        "payments:checkout",
        "strict",
        session.user.role
      );
    } else if (cartSessionId) {
      await rateLimitBySession(
        request,
        cartSessionId,
        "payments:checkout",
        "strict",
      );
    } else {
      await rateLimitByIP(request, "strict");
    }

    await connectDB();

    const {
      shippingAddress,
      billingAddress,
      paymentMethod,
      locale,
      email,
      couponCode,
      preorderAcknowledged,
      preorderMandateAccepted,
      setupIntentId,
      selectedShippingOptionId,
      vendorShippingSelections,
      fulfillmentMethod,
      pickupLocationId,
      iotecChannel,
      iotecPhone,
      mtnMomoPhone,
      phone,
      customerNote,
      customFields,
    } = await validateBody(
      request,
      CheckoutSchema,
    );
    // May be absent: a store that reaches shoppers by phone does not collect
    // an email. Whether this request needed one is the checkout settings'
    // call, enforced below once the cart is known.
    const customerEmail =
      typeof email === "string" && email.trim().length > 0
        ? email.trim()
        : session?.user?.email;

    // shippingAddress is optional at the schema level: digital-only carts
    // send billing only. Whether it is actually required is decided below,
    // after the items are inspected for shippability.
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
    const paypalSettings = paymentSettings.paypal;
    const razorpaySettings = paymentSettings.razorpay;
    const paystackSettings = paymentSettings.paystack;
    const pesapalSettings = paymentSettings.pesapal;
    const iotecSettings = paymentSettings.iotec;
    const orangeMoneySettings = paymentSettings.orange_money;
    const mtnMomoSettings = paymentSettings.mtn_momo;
    const codSettings = paymentSettings.cod;

    const cartQuery = session?.user?.id
      ? { userId: session.user.id }
      : cartSessionId
        ? { sessionId: cartSessionId }
        : null;

    if (!cartQuery) {
      throw new ValidationError({ cart: ["Cart is empty"] });
    }

    // Get current cart (customer or guest)
    const cart = await Cart.findOne(cartQuery)
      .populate({
        path: "items.productId",
        // `shipping` + `inventory` decide whether `stock` is a limit at all
        // (lib/products/stock-policy.ts) — resolvePurchaseType() reads them.
        select:
          "name price images vendorId stock inventory sku slug shipping variants",
        populate: { path: "vendorId", select: "_id" },
      })
      .lean();

    if (!cart || !cart.items || cart.items.length === 0) {
      throw new ValidationError({ cart: ["Cart is empty"] });
    }

    const items = cart.items as unknown as CartItem[];
    // A guest checkout whose email already belongs to a registered account is
    // attached to that account, the way Shopify attaches orders by email —
    // the order shows up in their history immediately instead of waiting for
    // the login-time claim. Only emails with no account stay guest orders.
    const guestAccount =
      !session?.user?.id && customerEmail
        ? await User.findOne({ email: customerEmail.trim().toLowerCase() })
            .select("_id")
            .lean()
        : null;
    const customerId =
      session?.user?.id ||
      (guestAccount ? String(guestAccount._id) : String(cart._id));
    // With no user account behind customerId, the order itself must carry the
    // guest's email or the public tracking/invoice lookups have nothing to
    // match against once the cart is gone.
    const guestEmail =
      session?.user?.id || guestAccount ? undefined : customerEmail;
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

    if (isMultiVendorEnabled) {
      const vendorIds = Array.from(
        new Set(
          items
            .map((item) => String((item.productId.vendorId as { _id?: string })?._id || item.productId.vendorId || ""))
            .filter(Boolean),
        ),
      );
      await assertCartVendorsSellable(vendorIds);
    }

    const couponCartItems: Array<{
      productId: string;
      price: number;
      quantity: number;
      categoryId?: string;
    }> = [];
    // Lines whose live price differs from the one the shopper was shown.
    const priceChanges: CartPriceChange[] = [];

    // Accumulate shippable weight (in the store's weight unit) overall and per
    // vendor, so the rate engine can price weight-based and per-vendor shipping.
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
    const itemVendorId = (item: CartItem) =>
      String(
        (item.productId.vendorId as { _id?: string })?._id ||
          item.productId.vendorId ||
          "",
      );

    // Validate stock against selected variant (when present) to match inventory decrement rules.
    // Fetch every cart product in one query instead of one round-trip per item.
    const stockCheckProducts = await Product.find({
      _id: { $in: items.map((item) => item.productId._id) },
    }).lean<Array<StockCheckProduct & { _id: { toString: () => string } }>>();
    const stockCheckProductById = new Map(
      stockCheckProducts.map((product) => [product._id.toString(), product]),
    );

    // Quoted lines are priced by the merchant's offer, not by the catalogue —
    // a "price on request" product carries price 0, so the re-pricing below
    // would hand the shopper the whole order for nothing. Offers belong to an
    // account, so a guest checkout resolves none and any quoted line in it is
    // refused (a shopper who was quoted signs in; that is how the price found
    // them in the first place).
    const quoteOffers = matchOffersToLines(
      items.map((item) => ({
        productId: item.productId._id,
        variantId: item.variantId,
        quantity: item.quantity,
      })),
      await loadShopperOffers(session?.user?.id, {
        productIds: items.map((item) => String(item.productId._id)),
      }),
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
      const hasExplicitStatus = typeof product.status === "string";
      const hasExplicitProductSource =
        product.productSource !== undefined && product.productSource !== null;
      const isUnavailableByStatus =
        hasExplicitStatus && product.status !== "active";
      const isUnavailableByProductSource =
        hasExplicitProductSource &&
        !isStorefrontProductSourceAllowed(
          product.productSource,
          isMultiVendorEnabled,
        );

      // Keep compatibility with legacy products that may not have status/source fields.
      if (isUnavailableByStatus || isUnavailableByProductSource) {
        throw new ValidationError({
          stock: [
            `${item.productId.name} is out of stock or has insufficient quantity`,
          ],
        });
      }

      // The offer that makes this line buyable at all, when the product is
      // sold by quote. Recorded on the line so the order carries it and the
      // quote can be closed out; cleared when there is none, so a line whose
      // product has since been given a real price cannot drag a spent quote
      // onto the order.
      const lineOffer = quoteOffers.get(
        quoteOfferLineKey(item.productId._id, item.variantId),
      );
      if (isQuoteOnlyProduct(product) && !lineOffer) {
        throw new ValidationError({
          stock: [
            `The quoted price for ${item.productId.name} is no longer available. Request a new quote to continue.`,
          ],
        });
      }
      item.quoteId = lineOffer?.quoteId;

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

      // Re-price standard lines from the LIVE product so a stale cart snapshot
      // (carts live up to 30 days) can't lock an old price in either direction.
      // Variant-aware: product.price is only the cheapest-variant mirror.
      // Pre-order lines are left untouched — their deposit/outstanding amounts
      // were computed against the price quoted at reservation time.
      if (lineOffer) {
        // Not a price change: GET /api/cart already shows the shopper the
        // offer, so this is the figure on their screen.
        item.price = lineOffer.unitPrice;
      } else if (
        (item.purchaseType || PURCHASE_TYPE.STANDARD) !== PURCHASE_TYPE.PREORDER
      ) {
        const liveVariant = item.variantId
          ? (
              product.variants as
                | Array<{ _id: { toString(): string }; price?: number }>
                | undefined
            )?.find((v) => v._id.toString() === String(item.variantId))
          : undefined;
        const livePrice =
          liveVariant && typeof liveVariant.price === "number"
            ? liveVariant.price
            : typeof (product as { price?: number }).price === "number"
              ? (product as { price?: number }).price
              : item.price;
        if (typeof livePrice === "number") {
          if (cartLinePriceChanged(item.price, livePrice)) {
            priceChanges.push({
              productId: String(item.productId._id),
              variantId: item.variantId ? String(item.variantId) : undefined,
              name: item.productId.name,
              previousPrice: item.price,
              price: livePrice,
            });
          }
          item.price = livePrice;
        }
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
      else hasDigitalItems = true;

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

    // Address rules, now that shippability is known: physical carts need a
    // shipping address; digital-only carts need billing only, which is also
    // snapshotted as the order address so every downstream consumer (emails,
    // invoices, admin views) still has an address to render.
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
    const digitalOnly = !hasShippableItems;

    // The form the admin configured — contact method, required fields, the
    // store's own questions — held to on the server too.
    const submission = enforceCheckoutSubmission({
      settings,
      user: session?.user
        ? {
            email: session.user.email,
            phone: (session.user as { phone?: string | null }).phone,
          }
        : null,
      digitalOnly,
      body: {
        email,
        phone,
        paymentMethod,
        iotecChannel,
        customerNote,
        customFields,
      },
      shippingAddress: shippingAddressInput,
      billingAddress: billingAddressInput,
    });
    // A phone-first store's contact number is the one couriers, SMS updates
    // and phone order-tracking read, and they all read it off the address.
    if (submission.contactPhone) {
      normalizedShippingAddress.phone ||= submission.contactPhone;
      normalizedBillingAddress.phone ||= submission.contactPhone;
    }
    const checkoutDetails = {
      customerNote: submission.customerNote,
      checkoutFields: submission.checkoutFields,
      contactPhone: submission.contactPhone,
    };

    // Persist any re-priced values back to the cart so consumers that re-read
    // the cart (notably the Stripe Checkout Session finalizer) charge and
    // record the same price, and the cart-tampering guard doesn't reject a
    // legitimately re-priced order. Idempotent when nothing changed.
    const repriceOps = items
      .filter((item) => (item as unknown as { _id?: unknown })._id)
      .map((item) => ({
        updateOne: {
          filter: { _id: cart._id },
          update: { $set: { "items.$[el].price": item.price } },
          arrayFilters: [
            { "el._id": (item as unknown as { _id: unknown })._id },
          ],
        },
      }));
    // A price that moved since the shopper's summary was drawn is not charged
    // or ordered unseen: stop before any gateway is asked for anything. The
    // new prices are written first — and awaited, since the page re-reads the
    // cart to show them and the next attempt must find them there.
    if (priceChanges.length > 0) {
      await Cart.bulkWrite(repriceOps);
      throw new ConflictError(CART_PRICES_CHANGED_MESSAGE, {
        reason: CART_PRICES_CHANGED_REASON,
        items: priceChanges,
      });
    }
    if (repriceOps.length > 0) {
      await Cart.bulkWrite(repriceOps).catch((err) =>
        console.error("Failed to persist re-priced cart items:", err),
      );
    }

    // Calculate totals
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
          vendorShares?: Record<string, number>;
          shippingShares?: Record<string, number>;
          shippingVendorId?: string;
          fundedBy: "platform" | "vendor";
        }
      | undefined;
    const destination = {
      country: normalizedShippingAddress.country,
      state: normalizedShippingAddress.state,
    };
    const platformShipping = settings.shipping as ShippingSettings | undefined;
    const legacyOrders = { freeShippingThreshold, defaultShippingCost };

    // Single source of truth for cost, selected method, per-vendor allocation,
    // and duties — shared with the Stripe paths so they cannot diverge.
    // A branch is identified by itself — there is no hold to quote back. The
    // resolver re-reads the branch server-side, so the only thing a client
    // decides here is *which* of the merchant's collection points, and a
    // tampered payload cannot put a different address on the order.
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
    const shippingResolution = pickupFulfillment
      ? null
      : await resolveCheckoutShipping({
          subtotal,
          totalWeight,
          vendorAgg,
          destination,
          platformShipping,
          orders: legacyOrders,
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
    const shippingCost = pickupCharges?.shippingCost ?? shippingResolution!.shippingCost;
    const selectedShippingMethod = pickupFulfillment
      ? { name: "Local pickup", optionId: "pickup" }
      : shippingResolution!.selectedShippingMethod;
    const vendorShippingCosts = pickupFulfillment
      ? new Map()
      : shippingResolution!.vendorShippingCosts;
    const customsEstimate = pickupFulfillment
      ? {
          dutyAmount: 0,
          dutyMode: "DDU" as const,
          international: false,
          collectedAtCheckout: false,
        }
      : shippingResolution!.customs;
    const dutyAmount = pickupCharges?.dutyAmount ?? customsEstimate.dutyAmount;

    // What each seller's delivery costs, for a seller's own free-shipping coupon.
    const shippingByVendor = Object.fromEntries(
      [...vendorShippingCosts].map(([vendorId, entry]) => [vendorId, entry.cost]),
    );
    if (couponCode) {
      appliedCoupon = await validateAndCalculateCoupon({
        code: couponCode,
        subtotal,
        shippingCost,
        shippingByVendor,
        cartItems: couponCartItems,
        userId: session?.user?.id || (guestAccount ? String(guestAccount._id) : undefined),
        email: customerEmail,
      });
    }

    const totals = calculateCheckoutTotals({
      subtotal,
      shippingCost,
      taxRate,
      coupon: appliedCoupon,
      shippingByVendor,
      currency: settings.general?.defaultCurrency,
    });
    const discount = totals.discount;
    const tax = totals.tax;
    const total = totals.total + dutyAmount;
    // A scoped coupon's discount, by the vendor whose items earned it, rescaled
    // if the totals capped the discount below what the coupon offered.
    const couponVendorShares = appliedCoupon?.vendorShares
      ? discount === appliedCoupon.discount
        ? appliedCoupon.vendorShares
        : splitCouponDiscount(discount, appliedCoupon.vendorShares)
      : undefined;
    // The same for a free-shipping coupon: whose delivery it actually paid
    // for — see `shippingDiscount` on the sub-order.
    const couponShippingShares = appliedCoupon?.shippingShares
      ? discount === appliedCoupon.discount
        ? appliedCoupon.shippingShares
        : splitCouponDiscount(discount, appliedCoupon.shippingShares)
      : undefined;
    // What is owed later, after the coupon — which comes off the deposit and
    // the balance in proportion rather than all off the deposit. See
    // `preorderOutstandingAfterCoupon`.
    const preorderOutstandingAmount = sumPreorderOutstandingAfterCoupon(
      preorderSplitLines(items),
      {
        goodsDiscount: totals.subtotalDiscount,
        vendorShares: couponVendorShares,
      },
      settings.general?.defaultCurrency || "USD",
    );
    const paymentDueNow = Math.max(0, total - preorderOutstandingAmount);

    if (!paymentMethod) {
      throw new ValidationError({
        paymentMethod: ["Payment method is required"],
      });
    }

    // Refuse to take a deposit the store has no way of topping up later. This
    // sits here rather than inside a gateway branch because `paymentDueNow`
    // above already split the money in two, and every branch below charges the
    // smaller half without knowing the larger half is uncollectable.
    assertDeferredBalanceCollectable({
      paymentMethod,
      outstandingAmount: preorderOutstandingAmount,
    });

    // The permission to keep the shopper's card, for the same reason and in
    // the same place: every card branch below either saves a card or hands the
    // balance to a page that will, and none of them may do it unasked. Only a
    // card checkout keeps one — guest or not, now that a guest's card has a
    // Customer to live on — so only a card checkout is asked. The wording is
    // composed here, never accepted from the request.
    const isCardCheckout = paymentMethod === "card";
    assertPreorderMandateAccepted({
      outstandingAmount: preorderOutstandingAmount,
      accepted: preorderMandateAccepted,
      savesCard: isCardCheckout,
    });
    const preorderMandateText =
      preorderMandateRequired(preorderOutstandingAmount) && isCardCheckout
      ? buildPreorderMandateText({
          outstandingAmount: preorderOutstandingAmount,
          currency: settings.general?.defaultCurrency || "USD",
          releaseDate: getPreorderReleaseDateForOrder(items),
        })
      : "";

    // Collection takes every configured payment method, exactly as delivery
    // does. It was restricted to COD because a pickup booking used to consume a
    // capacity hold the moment the order was created, and a hosted redirect
    // abandoned after that point would strand a slot nobody could rebook. Slot
    // booking is gone — a branch takes no reservations, only opening hours — so
    // the hold this protected no longer exists, while the restriction went on
    // hiding collection entirely from every prepaid-only store.
    //
    // A prepaid collection is in fact the safer of the two orders: the money is
    // settled before anything leaves the counter.

    const activeLocale =
      typeof locale === "string" && locale.length > 0 ? locale : "en";

    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";

    const cartDoc = await Cart.findById(cart._id);
    if (cartDoc) {
      // Stripe's hosted page creates the order later, from the webhook, and
      // only the cart survives until then.
      cartDoc.checkoutDetails = checkoutDetails;
      await updateCheckoutSnapshot(cartDoc, {
        trackAbandoned: submission.checkout.abandonedCheckouts.enabled,
        origin,
        locale: activeLocale,
        email: customerEmail,
        phone: normalizedShippingAddress.phone,
        customerName: normalizedShippingAddress.fullName,
        customerLocale: activeLocale,
        shippingAddress: normalizedShippingAddress,
        billingAddress: normalizedBillingAddress,
        gateway: paymentMethod,
        subtotalPrice: subtotal,
        shippingPrice: shippingCost,
        totalTax: tax,
        totalDiscounts: discount,
        totalPrice: total,
        presentmentCurrency: settings.general?.defaultCurrency || "USD",
        paymentEvent: {
          gateway: paymentMethod,
          status: "created",
          message: "Checkout payment started",
        },
      });
    }

    // One use of a limited coupon, kept for this shopper while they pay. Every
    // branch below either takes a payment or commits the order, and each is
    // refused here, before any of that, when the coupon has no use to spare.
    const checkoutCouponHoldKey = couponHoldKey(customerId);
    if (appliedCoupon) {
      await holdCouponUse({
        couponId: appliedCoupon.couponId,
        holdKey: checkoutCouponHoldKey,
      });
    }

    // Handle COD (Cash on Delivery)
    if (paymentMethod === "cod") {
      assertCashOnDeliveryAllowed({
        settings: codSettings,
        total,
        hasDigitalItems,
        hasPreorder,
      });

      // The order is the commitment, so the coupon's use is taken now — and
      // refused now if it has none — rather than counted once the order exists.
      if (appliedCoupon) {
        await takeCouponUse({
          couponId: appliedCoupon.couponId,
          holdKey: checkoutCouponHoldKey,
        });
      }
      const giveBackCouponUse = () =>
        appliedCoupon
          ? releaseCouponUse(appliedCoupon.couponId).catch((err) =>
              console.error("Failed to give back a COD coupon use:", err),
            )
          : Promise.resolve();

      // Every line is a standard purchase here — the pre-order guard above
      // keeps reservation-type lines off the COD path entirely.
      const inventoryLines = items.map((item) => ({
        productId: String(item.productId._id),
        variantId: item.variantId,
        quantity: item.quantity,
      }));

      try {
        // A collection comes off the counter the shopper chose, not off
        // whichever branch happens to hold the most. The order does not exist
        // yet on this path, so the snapshot is read directly rather than
        // through `orderInventoryOpts`.
        await decrementInventory(
          inventoryLines,
          pickupFulfillment
            ? { locationId: pickupFulfillment.pickup.pickupLocationId }
            : {},
        );
      } catch (err) {
        await giveBackCouponUse();
        if (err instanceof InsufficientStockError) {
          const failedItem = items.find(
            (item) => String(item.productId._id) === String(err.line.productId),
          );
          const failedName = failedItem?.productId.name || "Product";
          throw new ValidationError({
            stock: [
              `${failedName} is out of stock or has insufficient quantity`,
            ],
          });
        }
        throw err;
      }

      let order: Awaited<ReturnType<typeof createOrder>>;
      try {
        order = await createOrder({
          ...checkoutDetails,
          customerId,
          guestEmail,
          items,
          shippingAddress: normalizedShippingAddress,
        digitalOnly,
          billingAddress: normalizedBillingAddress,
          paymentMethod: "cod",
          couponUseTaken: Boolean(appliedCoupon),
          shippingMethod: selectedShippingMethod,
          customs: customsEstimate,
          vendorShippingCosts,
          fulfillment: pickupFulfillment,
          paymentStatus: PAYMENT_STATUS.PENDING,
          subtotal,
          discount,
          shippingCost,
          tax,
          total,
          coupon: appliedCoupon
            ? {
                code: appliedCoupon.code,
                type: appliedCoupon.type,
                value: appliedCoupon.value,
                couponId: appliedCoupon.couponId,
                vendorShares: couponVendorShares,
                shippingShares: couponShippingShares,
                fundedBy: appliedCoupon.fundedBy,
              }
            : undefined,
          isMultiVendorEnabled,
          orderPrefix: orderSettings.prefix,
          currency: settings.general?.defaultCurrency || "USD",
        });
      } catch (err) {
        // Back to the branch the decrement just took them from — the same
        // options object, or the units migrate between shops on every failed
        // order creation.
        await restoreInventory(
          inventoryLines,
          pickupFulfillment
            ? { locationId: pickupFulfillment.pickup.pickupLocationId }
            : {},
        ).catch(() => undefined);
        await giveBackCouponUse();
        throw err;
      }

      // Mark sub-orders as having inventory reserved so cancel/refund paths
      // know which lines to restore.
      await markOrderInventoryReserved(String(order._id)).catch((err) =>
        console.error("Failed to mark inventory reserved on COD order:", err),
      );

      // Clear cart only after order + inventory succeed.
      await Cart.findByIdAndUpdate(cart._id, { $set: { items: [] } });

      // Bookkeeping, confirmation email (PDF invoice + SMTP), and
      // notifications run after the response streams so the customer
      // isn't held on the success redirect while they complete.
      after(async () => {
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
          channel: "online",
          createdAt: order.createdAt,
        }).catch((err) => {
          console.error("Failed to sync pending COD payment transaction:", err);
        });

        await markCheckoutRecovered({
          cartId: cart._id,
          orderId: order._id,
          paymentEvent: {
            gateway: "cod",
            status: "succeeded",
            message: "Cash on delivery order placed",
          },
        }).catch((err) =>
          console.error("Failed to mark abandoned checkout recovered:", err),
        );

        if (customerEmail) {
          await sendOrderConfirmationEmail(
            {
              orderNumber: order.orderNumber,
              customerName: normalizedShippingAddress.fullName,
              customerEmail,
              items: order.items.map(
                (i: {
                  name: string;
                  quantity: number;
                  price: number;
                  image?: string;
                }) => ({
                  name: i.name,
                  quantity: i.quantity,
                  price: i.price,
                  image: i.image,
                }),
              ),
              subtotal: order.subtotal,
              discount: order.discount,
              shipping: order.shippingCost,
              tax: order.tax,
              total: order.total,
              shippingAddress: order.shippingAddress,
              paymentMethod: order.paymentMethod,
            },
            settings,
          ).catch((err) =>
            console.error("Failed to send COD order confirmation email:", err),
          );
        }

        await notifyOrderCreatedParticipants(order, {
          customerEmailSent: Boolean(customerEmail),
        }).catch((err) =>
          console.error("Failed to create COD order notifications:", err),
        );
      });

      return NextResponse.json({
        success: true,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          paymentMethod: "cod",
          redirectUrl: `${origin}/${activeLocale}/checkout/success?order=${order.orderNumber}`,
        },
      });
    }

    if (hasPreorder && paymentDueNow <= 0) {
      // Nothing was charged, so nothing proves a card was collected except the
      // SetupIntent the client just confirmed — and its id arrives in the
      // request, where anyone could put any id on the account. Read it back
      // from Stripe and believe only what Stripe says: our own metadata names
      // the shopper it was set up for, and it has to name this one.
      let preorderSavedPaymentMethodId: string | undefined;
      let preorderStripeCustomerId: string | undefined;
      if (setupIntentId) {
        const setupSecretKey = resolveStripeCredentials(stripeSettings).secretKey;
        if (!isStripeSecretKeyConfigured(setupSecretKey)) {
          throw new ValidationError("Card payments are not configured");
        }
        const setupIntent = await getStripeForSecretKey(
          setupSecretKey,
        ).setupIntents.retrieve(setupIntentId);
        const setupMetadata = setupIntent.metadata || {};
        if (
          setupMetadata.kind !== PREORDER_CARD_SETUP_KIND ||
          String(setupMetadata.userId || "") !== String(customerId) ||
          setupIntent.status !== "succeeded"
        ) {
          throw new ValidationError({
            setupIntentId: ["This card setup does not belong to this order"],
          });
        }
        const method = setupIntent.payment_method;
        preorderSavedPaymentMethodId =
          typeof method === "string" ? method : method?.id;
        // The Customer the card was saved against, read off the setup rather
        // than recomputed. For a guest it exists nowhere else: it was minted
        // for this cart, and the order is the only thing that will remember it.
        const setupCustomer = setupIntent.customer;
        preorderStripeCustomerId =
          typeof setupCustomer === "string" ? setupCustomer : setupCustomer?.id;
      }
      if (preorderMandateText && !preorderSavedPaymentMethodId) {
        // The shopper authorised a card being kept and none was: the order is
        // still good — they will be asked for the balance the way they always
        // were — but the authorisation bought nothing, which is worth saying.
        console.error(
          "Pay-later pre-order accepted the card mandate without a saved card",
        );
      }
      const preorderLines = getOrderPreorderLines(items);
      // Nothing is captured later that would count the coupon, so its use is
      // taken with the order, as cash on delivery's is; cancelling or expiring
      // the pre-order gives it back.
      if (appliedCoupon) {
        await takeCouponUse({
          couponId: appliedCoupon.couponId,
          holdKey: checkoutCouponHoldKey,
        });
      }
      const giveBackCouponUse = () =>
        appliedCoupon
          ? releaseCouponUse(appliedCoupon.couponId).catch((err) =>
              console.error("Failed to give back a pay-later coupon use:", err),
            )
          : Promise.resolve();
      try {
        await reservePreorderQuantity(preorderLines);
      } catch (err) {
        await giveBackCouponUse();
        throw err;
      }
      let order: Awaited<ReturnType<typeof createOrder>>;
      try {
        order = await createOrder({
          ...checkoutDetails,
          customerId,
          guestEmail,
          items,
          shippingAddress: normalizedShippingAddress,
        digitalOnly,
          billingAddress: normalizedBillingAddress,
          paymentMethod: "pay_later",
          couponUseTaken: Boolean(appliedCoupon),
          preorderMandateText: preorderMandateText || undefined,
          preorderSavedPaymentMethodId,
          stripeCustomerId: preorderStripeCustomerId,
          shippingMethod: selectedShippingMethod,
          customs: customsEstimate,
          vendorShippingCosts,
          fulfillment: pickupFulfillment,
          paymentStatus: PAYMENT_STATUS.PENDING,
          subtotal,
          discount,
          shippingCost,
          tax,
          total,
          coupon: appliedCoupon
            ? {
                code: appliedCoupon.code,
                type: appliedCoupon.type,
                value: appliedCoupon.value,
                couponId: appliedCoupon.couponId,
                vendorShares: couponVendorShares,
                shippingShares: couponShippingShares,
                fundedBy: appliedCoupon.fundedBy,
              }
            : undefined,
          isMultiVendorEnabled,
          orderPrefix: orderSettings.prefix,
          currency: settings.general?.defaultCurrency || "USD",
        });
      } catch (err) {
        await releasePreorderQuantity(preorderLines).catch(() => undefined);
        await giveBackCouponUse();
        throw err;
      }
      await markOrderPreorderReserved(String(order._id)).catch((err) =>
        console.error("Failed to mark pay-later preorder reserved:", err),
      );
      await Cart.findByIdAndUpdate(cart._id, { $set: { items: [] } });
      after(async () => {
        await notifyOrderCreatedParticipants(order).catch((err) =>
          console.error(
            "Failed to create pay-later preorder notifications:",
            err,
          ),
        );
      });
      return NextResponse.json({
        success: true,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          paymentMethod: "pay_later",
          redirectUrl: `${origin}/${activeLocale}/checkout/success?order=${order.orderNumber}`,
        },
      });
    }

    if (paymentMethod === "paypal") {
      if (!paypalSettings?.enabled)
        throw new ValidationError("PayPal is disabled");
      const paypalCreds = resolvePayPalCredentials(paypalSettings);
      if (!paypalCreds.clientId || !paypalCreds.clientSecret) {
        throw new ValidationError("PayPal is not configured");
      }

      const { orderId: paypalOrderId, approvalUrl } = await createPayPalOrder({
        creds: {
          clientId: paypalCreds.clientId,
          clientSecret: paypalCreds.clientSecret,
          mode: paypalCreds.mode,
        },
        currency: (settings.general?.defaultCurrency || "USD").toUpperCase(),
        total: paymentDueNow,
        returnUrl: `${origin}/${activeLocale}/checkout/success`,
        cancelUrl: `${origin}/${activeLocale}/checkout?canceled=true`,
        referenceId: String(cart._id),
      });

      const order = await createOrder({
        ...checkoutDetails,
        customerId,
        guestEmail,
        items,
        shippingAddress: normalizedShippingAddress,
        digitalOnly,
        billingAddress: normalizedBillingAddress,
        paymentMethod: "paypal",
        shippingMethod: selectedShippingMethod,
        customs: customsEstimate,
        vendorShippingCosts,
        fulfillment: pickupFulfillment,
        paymentStatus: PAYMENT_STATUS.PENDING,
        subtotal,
        discount,
        shippingCost,
        tax,
        total,
        coupon: appliedCoupon
          ? {
              code: appliedCoupon.code,
              type: appliedCoupon.type,
              value: appliedCoupon.value,
              couponId: appliedCoupon.couponId,
                vendorShares: couponVendorShares,
                shippingShares: couponShippingShares,
              fundedBy: appliedCoupon.fundedBy,
            }
          : undefined,
        paypalOrderId,
        isMultiVendorEnabled,
        orderPrefix: orderSettings.prefix,
        currency: settings.general?.defaultCurrency || "USD",
      });

      return NextResponse.json({
        success: true,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          paymentMethod: "paypal",
          paypalOrderId,
          url: approvalUrl,
        },
      });
    }

    if (paymentMethod === "razorpay") {
      if (!razorpaySettings?.enabled) {
        throw new ValidationError("Razorpay is disabled");
      }

      const razorpayCreds = getRazorpayCredentials({
        keyId: razorpaySettings.keyId,
        keySecret: razorpaySettings.keySecret,
      });
      const currency = (settings.general?.defaultCurrency || "INR").toUpperCase();

      const razorpayOrder = await createRazorpayOrder({
        creds: razorpayCreds,
        amount: paymentDueNow,
        currency,
        receipt: `cart_${String(cart._id).slice(-18)}_${Date.now().toString(36)}`,
        notes: {
          cartId: String(cart._id),
          customerId,
          locale: activeLocale,
        },
      });

      const order = await createOrder({
        ...checkoutDetails,
        customerId,
        guestEmail,
        items,
        shippingAddress: normalizedShippingAddress,
        digitalOnly,
        billingAddress: normalizedBillingAddress,
        paymentMethod: "razorpay",
        shippingMethod: selectedShippingMethod,
        customs: customsEstimate,
        vendorShippingCosts,
        fulfillment: pickupFulfillment,
        paymentStatus: PAYMENT_STATUS.PENDING,
        subtotal,
        discount,
        shippingCost,
        tax,
        total,
        coupon: appliedCoupon
          ? {
              code: appliedCoupon.code,
              type: appliedCoupon.type,
              value: appliedCoupon.value,
              couponId: appliedCoupon.couponId,
                vendorShares: couponVendorShares,
                shippingShares: couponShippingShares,
              fundedBy: appliedCoupon.fundedBy,
            }
          : undefined,
        razorpayOrderId: razorpayOrder.id,
        isMultiVendorEnabled,
        orderPrefix: orderSettings.prefix,
        currency: settings.general?.defaultCurrency || "USD",
      });

      return NextResponse.json({
        success: true,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          paymentMethod: "razorpay",
          keyId: razorpayCreds.keyId,
          razorpayOrderId: razorpayOrder.id,
          amount: razorpayOrder.amount,
          currency: razorpayOrder.currency,
          name: settings.general?.storeName || "Store",
          description: `Order ${order.orderNumber}`,
          // A failed payment lands on the same page, which shows the failure
          // instead of verifying.
          callbackUrl: buildRazorpayCallbackUrl({
            successUrl: `${origin}/${activeLocale}/checkout/success`,
            failureUrl: `${origin}/${activeLocale}/checkout/success`,
          }),
        },
      });
    }

    if (paymentMethod === "paystack") {
      if (!paystackSettings?.enabled) {
        throw new ValidationError("Paystack is disabled");
      }
      if (!customerEmail) {
        throw new ValidationError({
          email: ["Email is required for Paystack checkout"],
        });
      }

      const paystackCreds = getPaystackCredentials({
        publicKey: paystackSettings.publicKey,
        secretKey: paystackSettings.secretKey,
      });
      const currency = (settings.general?.defaultCurrency || "NGN").toUpperCase();
      const paystackReference = `ps-${String(cart._id)}-${Date.now().toString(36)}`;
      const callbackUrl = `${origin}/${activeLocale}/checkout/success?paystack_reference=${encodeURIComponent(paystackReference)}`;

      const transaction = await initializePaystackTransaction({
        creds: paystackCreds,
        email: customerEmail,
        amount: paymentDueNow,
        currency,
        reference: paystackReference,
        callbackUrl,
        metadata: {
          cartId: String(cart._id),
          customerId,
          locale: activeLocale,
        },
      });

      const order = await createOrder({
        ...checkoutDetails,
        customerId,
        guestEmail,
        items,
        shippingAddress: normalizedShippingAddress,
        digitalOnly,
        billingAddress: normalizedBillingAddress,
        paymentMethod: "paystack",
        shippingMethod: selectedShippingMethod,
        customs: customsEstimate,
        vendorShippingCosts,
        fulfillment: pickupFulfillment,
        paymentStatus: PAYMENT_STATUS.PENDING,
        subtotal,
        discount,
        shippingCost,
        tax,
        total,
        coupon: appliedCoupon
          ? {
              code: appliedCoupon.code,
              type: appliedCoupon.type,
              value: appliedCoupon.value,
              couponId: appliedCoupon.couponId,
                vendorShares: couponVendorShares,
                shippingShares: couponShippingShares,
              fundedBy: appliedCoupon.fundedBy,
            }
          : undefined,
        paystackReference,
        isMultiVendorEnabled,
        orderPrefix: orderSettings.prefix,
        currency: settings.general?.defaultCurrency || "USD",
      });

      return NextResponse.json({
        success: true,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          paymentMethod: "paystack",
          paystackReference,
          accessCode: transaction.access_code,
          url: transaction.authorization_url,
        },
      });
    }

    if (paymentMethod === "pesapal") {
      if (!pesapalSettings?.enabled) {
        throw new ValidationError("Pesapal is disabled");
      }
      if (!customerEmail) {
        throw new ValidationError({
          email: ["Email is required for Pesapal checkout"],
        });
      }

      const resolvedPesapal = resolvePesapalCredentials(pesapalSettings);
      const pesapalCreds = getPesapalCredentials(resolvedPesapal);
      if (!pesapalCreds.ipnId) {
        throw new ValidationError(
          "Pesapal is not configured. Register the IPN URL and add its IPN ID.",
        );
      }

      const currency = (settings.general?.defaultCurrency || "UGX").toUpperCase();
      // Pesapal is an East African acquirer and refuses anything it cannot
      // settle. Said here, before the order is written, rather than letting the
      // shopper meet a raw gateway error at the end of a built cart.
      if (!isPesapalCurrency(currency)) {
        throw new ValidationError(
          `Pesapal cannot settle ${currency}. Set the store default currency to one of ${[...PESAPAL_CURRENCIES].join(", ")} in Admin → Settings → General.`,
        );
      }
      const merchantReference = `psp-${String(cart._id).slice(-18)}-${Date.now().toString(36)}`;
      const callbackUrl = `${origin}/${activeLocale}/checkout/success?pesapal_reference=${encodeURIComponent(merchantReference)}`;
      const fullNameParts = normalizedBillingAddress.fullName
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const firstName =
        normalizedBillingAddress.firstName || fullNameParts[0] || "Customer";
      const lastName =
        normalizedBillingAddress.lastName ||
        fullNameParts.slice(1).join(" ") ||
        firstName;

      const pesapalOrder = await submitPesapalOrder({
        creds: pesapalCreds,
        merchantReference,
        currency,
        amount: paymentDueNow,
        description: `Store checkout ${merchantReference}`,
        callbackUrl,
        cancellationUrl: `${origin}/${activeLocale}/checkout?canceled=true`,
        notificationId: pesapalCreds.ipnId,
        billingAddress: {
          email_address: customerEmail,
          phone_number: normalizedBillingAddress.phone,
          country_code: normalizePesapalCountryCode(
            normalizedBillingAddress.country,
          ),
          first_name: firstName,
          last_name: lastName,
          line_1: normalizedBillingAddress.street,
          line_2: normalizedBillingAddress.apartment,
          city: normalizedBillingAddress.city,
          state: normalizedBillingAddress.state,
          postal_code: normalizedBillingAddress.postalCode,
          zip_code: normalizedBillingAddress.postalCode,
        },
      });

      if (
        !pesapalOrder.order_tracking_id ||
        !pesapalOrder.redirect_url ||
        pesapalOrder.merchant_reference !== merchantReference
      ) {
        throw new ValidationError("Pesapal returned an invalid order response");
      }

      const order = await createOrder({
        ...checkoutDetails,
        customerId,
        guestEmail,
        items,
        shippingAddress: normalizedShippingAddress,
        digitalOnly,
        billingAddress: normalizedBillingAddress,
        paymentMethod: "pesapal",
        shippingMethod: selectedShippingMethod,
        customs: customsEstimate,
        vendorShippingCosts,
        fulfillment: pickupFulfillment,
        paymentStatus: PAYMENT_STATUS.PENDING,
        subtotal,
        discount,
        shippingCost,
        tax,
        total,
        coupon: appliedCoupon
          ? {
              code: appliedCoupon.code,
              type: appliedCoupon.type,
              value: appliedCoupon.value,
              couponId: appliedCoupon.couponId,
                vendorShares: couponVendorShares,
                shippingShares: couponShippingShares,
              fundedBy: appliedCoupon.fundedBy,
            }
          : undefined,
        pesapalOrderTrackingId: pesapalOrder.order_tracking_id,
        pesapalMerchantReference: merchantReference,
        isMultiVendorEnabled,
        orderPrefix: orderSettings.prefix,
        // Must match the currency the charge was submitted in — the finalizer
        // compares the gateway's currency against the order's.
        currency,
      });

      return NextResponse.json({
        success: true,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          paymentMethod: "pesapal",
          pesapalOrderTrackingId: pesapalOrder.order_tracking_id,
          pesapalMerchantReference: merchantReference,
          url: pesapalOrder.redirect_url,
        },
      });
    }

    if (paymentMethod === "iotec") {
      if (!iotecSettings?.enabled) {
        throw new ValidationError("ioTec Pay is disabled");
      }

      const resolvedIotec = resolveIotecCredentials(iotecSettings);
      const iotecCreds = getIotecCredentials(resolvedIotec);
      if (!iotecCreds.walletId) {
        throw new ValidationError(
          "ioTec Pay is not configured. Add the wallet ID in Admin → Settings → Payments.",
        );
      }

      const currency = (
        settings.general?.defaultCurrency || "UGX"
      ).toUpperCase();
      // ioTec Pay settles Ugandan mobile money and cards in UGX only, and the
      // minimum below is denominated in shillings — charging any other currency
      // would silently mis-denominate both.
      if (currency !== IOTEC_CURRENCY) {
        throw new ValidationError(
          `ioTec Pay only accepts ${IOTEC_CURRENCY}. Set the store default currency to ${IOTEC_CURRENCY} in Admin → Settings → General.`,
        );
      }
      // ioTec collections take whole currency units (UGX is zero-decimal).
      const amount = Math.round(paymentDueNow);
      if (amount < IOTEC_MIN_AMOUNT) {
        throw new ValidationError(
          `ioTec Pay requires a minimum amount of ${IOTEC_MIN_AMOUNT} ${currency}.`,
        );
      }

      const externalId = `iot-${String(cart._id).slice(-18)}-${Date.now().toString(36)}`;
      const isCard = iotecChannel === "card";
      // Card collections are billed to the customer's email; mobile money is
      // billed to the MSISDN the payer approves the PIN prompt on.
      const payer = isCard
        ? String(customerEmail || "")
        : normalizeUgandaMsisdn(iotecPhone || normalizedBillingAddress.phone);
      if (!payer) {
        throw new ValidationError(
          isCard
            ? { email: ["Email is required for ioTec card payments"] }
            : {
                iotecPhone: [
                  "A valid Ugandan mobile money number is required for ioTec Pay",
                ],
              },
        );
      }

      // Submitting a mobile-money collection puts a PIN prompt on the payer's
      // phone straight away, and ioTec has no programmatic refund API. So the
      // order is persisted first and cancelled if the collection never starts —
      // the reverse order could take a payment with no order behind it.
      const order = await createOrder({
        ...checkoutDetails,
        customerId,
        guestEmail,
        items,
        shippingAddress: normalizedShippingAddress,
        digitalOnly,
        billingAddress: normalizedBillingAddress,
        paymentMethod: "iotec",
        shippingMethod: selectedShippingMethod,
        customs: customsEstimate,
        vendorShippingCosts,
        fulfillment: pickupFulfillment,
        paymentStatus: PAYMENT_STATUS.PENDING,
        subtotal,
        discount,
        shippingCost,
        tax,
        total,
        coupon: appliedCoupon
          ? {
              code: appliedCoupon.code,
              type: appliedCoupon.type,
              value: appliedCoupon.value,
              couponId: appliedCoupon.couponId,
                vendorShares: couponVendorShares,
                shippingShares: couponShippingShares,
              fundedBy: appliedCoupon.fundedBy,
            }
          : undefined,
        iotecExternalId: externalId,
        isMultiVendorEnabled,
        orderPrefix: orderSettings.prefix,
        currency,
      });

      let collection: IotecCollectionResponse;
      try {
        collection = isCard
          ? await submitIotecCardCollection({
              creds: iotecCreds,
              externalId,
              currency,
              amount,
              payer,
              redirectUrl: `${origin}/${activeLocale}/checkout/success?iotec_external_id=${encodeURIComponent(externalId)}`,
              payerName: normalizedBillingAddress.fullName,
              payerNote: `Store checkout ${externalId}`,
            })
          : await submitIotecCollection({
              creds: iotecCreds,
              externalId,
              currency,
              amount,
              payer,
              payerName: normalizedBillingAddress.fullName,
              payerNote: `Store checkout ${externalId}`,
            });

        if (!collection.id || (isCard && !collection.cardRedirectUrl)) {
          throw new ValidationError(
            isCard
              ? "ioTec returned an invalid card response"
              : "ioTec returned an invalid collection response",
          );
        }
      } catch (err) {
        // Retire the order only when ioTec definitively refused the request —
        // the rule MTN MoMo below already keeps. A 4xx means nothing was queued
        // and no phone was prompted. A timeout, a dropped connection, a 5xx or
        // an unreadable 2xx may all be a collection ioTec accepted: the payer
        // approves the PIN, and a cancelled order would be refunded rather than
        // fulfilled. Left pending it is an abandoned checkout, and the callback
        // (which carries the external id) settles it if the payer did pay.
        const definitivelyRejected =
          err instanceof IotecApiError &&
          err.httpStatus >= 400 &&
          err.httpStatus < 500;
        if (definitivelyRejected) {
          await Order.updateOne(
            { _id: order._id },
            { $set: { status: ORDER_STATUS.CANCELLED } },
          ).catch((cancelErr) =>
            console.error(
              "Failed to cancel order after ioTec collection failure:",
              cancelErr,
            ),
          );
        } else {
          console.error(
            `ioTec collection outcome unknown for order ${order._id}; left pending for its callback:`,
            err,
          );
        }
        throw err;
      }

      // The finalizer looks orders up by transaction id; until this lands it
      // falls back to the external id the callback also carries.
      await Order.updateOne(
        { _id: order._id },
        { $set: { iotecTransactionId: collection.id } },
      );

      return NextResponse.json({
        success: true,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          paymentMethod: "iotec",
          iotecTransactionId: collection.id,
          iotecExternalId: externalId,
          ...(isCard
            ? { url: collection.cardRedirectUrl }
            : // No redirect: the payer approves the charge on their phone; the
              // client polls /api/payments/iotec/verify until it resolves.
              { requiresPolling: true }),
        },
      });
    }

    if (paymentMethod === "orange_money") {
      if (!orangeMoneySettings?.enabled) {
        throw new ValidationError("Orange Money is disabled");
      }
      if (!customerEmail) {
        throw new ValidationError({
          email: ["Email is required for Orange Money checkout"],
        });
      }

      const resolvedOrangeMoney =
        resolveOrangeMoneyCredentials(orangeMoneySettings);
      const orangeMoneyCreds = getOrangeMoneyCredentials(resolvedOrangeMoney);

      const currency = (
        settings.general?.defaultCurrency || "XOF"
      ).toUpperCase();
      // Orange Money is a per-country wallet, not a global acquirer. Said here,
      // before the order is written, rather than letting the shopper meet a raw
      // gateway error at the end of a built cart.
      if (!isOrangeMoneyCurrency(currency)) {
        throw new ValidationError(
          `Orange Money cannot settle ${currency}. Set the store default currency to one of ${[...ORANGE_MONEY_CURRENCIES].join(", ")} in Admin → Settings → General.`,
        );
      }

      // A fully-discounted cart has nothing for a wallet to collect, and Orange
      // answers a zero-amount web payment with an error the shopper cannot act
      // on. Say so here instead, before an order is written and cancelled.
      if (!(paymentDueNow > 0)) {
        throw new ValidationError(
          "This order has nothing left to pay. Place it without a payment gateway.",
        );
      }

      // Orange takes major units. In a zero-decimal currency a fractional total
      // would be silently rounded by the gateway and then fail the finalizer's
      // cross-check — after the payer's money had moved.
      if (
        currencyMinorUnitExponent(currency) === 0 &&
        !Number.isInteger(paymentDueNow)
      ) {
        throw new ValidationError(
          `${currency} has no minor unit, so ${paymentDueNow} cannot be charged. Round the cart total to a whole ${currency}.`,
        );
      }

      const orangeMoneyOrderId = `om-${String(cart._id).slice(-18)}-${Date.now().toString(36)}`;

      // The order is written BEFORE the gateway call on purpose. Orange's
      // notification is keyed on our own reference, so persisting it first means
      // the callback's lookup key exists from the very first moment — no
      // adoption path, no second write for a notification to outrun. Creating an
      // unpaid order early is safe here because /webpayment only mints a hosted
      // URL: it moves no money and prompts nobody.
      const order = await createOrder({
        ...checkoutDetails,
        customerId,
        guestEmail,
        items,
        shippingAddress: normalizedShippingAddress,
        digitalOnly,
        billingAddress: normalizedBillingAddress,
        paymentMethod: "orange_money",
        shippingMethod: selectedShippingMethod,
        customs: customsEstimate,
        vendorShippingCosts,
        fulfillment: pickupFulfillment,
        paymentStatus: PAYMENT_STATUS.PENDING,
        subtotal,
        discount,
        shippingCost,
        tax,
        total,
        coupon: appliedCoupon
          ? {
              code: appliedCoupon.code,
              type: appliedCoupon.type,
              value: appliedCoupon.value,
              couponId: appliedCoupon.couponId,
                vendorShares: couponVendorShares,
                shippingShares: couponShippingShares,
              fundedBy: appliedCoupon.fundedBy,
            }
          : undefined,
        orangeMoneyOrderId,
        isMultiVendorEnabled,
        orderPrefix: orderSettings.prefix,
        currency,
      });

      let payment;
      try {
        payment = await submitOrangeMoneyPayment({
          creds: orangeMoneyCreds,
          orderId: orangeMoneyOrderId,
          amount: paymentDueNow,
          // Sandbox settles in Orange's placeholder currency, live in the
          // store's own. One helper decides, and the finalizer reads the same.
          currency: orangeMoneyChargeCurrency(orangeMoneyCreds.mode, currency),
          returnUrl: `${origin}/${activeLocale}/checkout/success?orange_money_order_id=${encodeURIComponent(orangeMoneyOrderId)}`,
          cancelUrl: `${origin}/${activeLocale}/checkout?canceled=true`,
          // Orange calls this server-to-server, so it must be absolute and
          // publicly reachable — not a locale-prefixed page route.
          notifUrl: `${origin}/api/payments/orange-money/callback`,
          lang: orangeMoneyLang(activeLocale),
          reference: settings.general?.storeName || "Storify",
        });
      } catch (err) {
        // Nothing was charged, but an order with no payment session behind it
        // can never be completed — retire it rather than leaving it pending.
        await Order.updateOne(
          { _id: order._id },
          { $set: { status: ORDER_STATUS.CANCELLED } },
        );
        throw err;
      }

      // The pay token is required to call /transactionstatus and the notif
      // token is the only secret the callback can authenticate against, so an
      // order without them can never be verified. Losing this write is fatal.
      const stored = await Order.updateOne(
        { _id: order._id },
        {
          $set: {
            orangeMoneyPayToken: payment.pay_token,
            orangeMoneyNotifToken: payment.notif_token,
          },
        },
      );
      if (stored.modifiedCount !== 1) {
        await Order.updateOne(
          { _id: order._id },
          { $set: { status: ORDER_STATUS.CANCELLED } },
        );
        throw new ValidationError(
          "Orange Money payment session could not be stored. Please try again.",
        );
      }

      return NextResponse.json({
        success: true,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          paymentMethod: "orange_money",
          orangeMoneyOrderId,
          url: payment.payment_url,
        },
      });
    }

    if (paymentMethod === "mtn_momo") {
      if (!mtnMomoSettings?.enabled) {
        throw new ValidationError("MTN MoMo is disabled");
      }

      const resolvedMtnMomo = resolveMtnMomoCredentials(mtnMomoSettings);
      const mtnMomoCreds = getMtnMomoCredentials(resolvedMtnMomo);

      const currency = (
        settings.general?.defaultCurrency || "UGX"
      ).toUpperCase();
      // MoMo is a per-country wallet like Orange Money. Said here, before the
      // order is written, rather than letting the shopper meet a raw gateway
      // error at the end of a built cart.
      if (!isMtnMomoCurrency(currency)) {
        throw new ValidationError(
          `MTN MoMo cannot settle ${currency}. Set the store default currency to one of ${[...MTN_MOMO_CURRENCIES].join(", ")} in Admin → Settings → General.`,
        );
      }

      // requesttopay takes major units. In a zero-decimal currency a
      // fractional total would be rounded by the gateway and then fail the
      // finalizer's amount cross-check — after the payer's money had moved.
      if (
        currencyMinorUnitExponent(currency) === 0 &&
        !Number.isInteger(paymentDueNow)
      ) {
        throw new ValidationError(
          `${currency} has no minor unit, so ${paymentDueNow} cannot be charged. Round the cart total to a whole ${currency}.`,
        );
      }

      const payerMsisdn = normalizeMtnMomoMsisdn(
        mtnMomoPhone || normalizedBillingAddress.phone,
        mtnMomoCreds.targetEnvironment,
      );
      if (!payerMsisdn) {
        throw new ValidationError({
          mtnMomoPhone: [
            "A valid MTN mobile money number is required for MTN MoMo",
          ],
        });
      }

      // The X-Reference-Id is minted here and never returned by MTN — it is
      // the transaction's only handle, so it must be on the order before the
      // prompt can exist anywhere.
      const mtnMomoReferenceId = randomUUID();

      // Like ioTec (and unlike Orange Money), the order is persisted first and
      // cancelled if the request never starts: requesttopay puts a PIN prompt
      // on the payer's phone straight away, and a prompt whose reference we
      // failed to store is money that could move with no order behind it.
      const order = await createOrder({
        ...checkoutDetails,
        customerId,
        guestEmail,
        items,
        shippingAddress: normalizedShippingAddress,
        digitalOnly,
        billingAddress: normalizedBillingAddress,
        paymentMethod: "mtn_momo",
        shippingMethod: selectedShippingMethod,
        customs: customsEstimate,
        vendorShippingCosts,
        fulfillment: pickupFulfillment,
        paymentStatus: PAYMENT_STATUS.PENDING,
        subtotal,
        discount,
        shippingCost,
        tax,
        total,
        coupon: appliedCoupon
          ? {
              code: appliedCoupon.code,
              type: appliedCoupon.type,
              value: appliedCoupon.value,
              couponId: appliedCoupon.couponId,
                vendorShares: couponVendorShares,
                shippingShares: couponShippingShares,
              fundedBy: appliedCoupon.fundedBy,
            }
          : undefined,
        mtnMomoReferenceId,
        mtnMomoPhone: payerMsisdn,
        isMultiVendorEnabled,
        orderPrefix: orderSettings.prefix,
        currency,
      });

      try {
        await requestMtnMomoPayment({
          creds: mtnMomoCreds,
          referenceId: mtnMomoReferenceId,
          amount: paymentDueNow,
          // Sandbox settles in EUR only, live in the store's own currency.
          // One helper decides, and the finalizer reads the same.
          currency: mtnMomoChargeCurrency(mtnMomoCreds.mode, currency),
          // Echoed back by the status endpoint and shown in MTN's dashboard —
          // the order id makes it directly searchable in the admin.
          externalId: String(order._id),
          payerMsisdn,
          payerMessage: `Order ${order.orderNumber}`.replace(/[^\w\s.-]/g, ""),
          payeeNote: `Store checkout ${order._id}`,
          // Built from the host registered with MTN, not from this request's
          // origin: MTN compares the two and fails the whole payment with
          // INVALID_CALLBACK_URL_HOST when they differ. Unconfigured means no
          // callback is requested at all, which costs only an optimistic
          // notification the finalizer never trusts on its own.
          callbackUrl: mtnMomoCallbackUrl(mtnMomoCreds),
        });
      } catch (err) {
        // Retire the order ONLY when MTN definitively refused the request. A
        // 4xx is a rejected payload — nothing was queued and no phone was
        // prompted, so the order can never be paid. A timeout or a 5xx is
        // ambiguous: MTN may have accepted it and prompted the payer anyway,
        // and cancelling there would strand real money against a cancelled
        // order that the finalizer then refuses forever. Left PENDING it is
        // just an abandoned checkout — this gateway's normal resting state —
        // and the reconcile sweep completes it if the payer did pay.
        const definitivelyRejected =
          err instanceof MtnMomoApiError &&
          err.httpStatus >= 400 &&
          err.httpStatus < 500;
        if (definitivelyRejected) {
          await Order.updateOne(
            { _id: order._id },
            { $set: { status: ORDER_STATUS.CANCELLED } },
          ).catch((cancelErr) =>
            console.error(
              "Failed to cancel order after MTN MoMo request failure:",
              cancelErr,
            ),
          );
        } else {
          console.error(
            `MTN MoMo requesttopay outcome unknown for order ${order._id}; left pending for the reconcile sweep:`,
            err,
          );
        }
        throw err;
      }

      return NextResponse.json({
        success: true,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          paymentMethod: "mtn_momo",
          mtnMomoReferenceId,
          // No redirect: the payer approves the PIN prompt on their phone; the
          // client polls /api/payments/mtn-momo/verify until it resolves.
          requiresPolling: true,
        },
      });
    }

    if (paymentMethod !== "card") {
      throw new ValidationError("Unsupported payment method");
    }

    if (discount > 0) {
      throw new ValidationError(
        "Discounted card checkout is handled via Payment Intent flow",
      );
    }

    if (!stripeSettings?.enabled)
      throw new ValidationError("Stripe is disabled");
    const stripeSecretKey = resolveStripeCredentials(stripeSettings).secretKey;
    if (!isStripeSecretKeyConfigured(stripeSecretKey)) {
      throw new ValidationError(
        "Stripe is enabled but not configured. Please add Stripe Secret Key in Admin → Settings → Payments.",
      );
    }

    // Create Stripe line items
    const checkoutCurrency = (
      settings.general?.defaultCurrency || "USD"
    ).toLowerCase();
    const lineItems = items
      .map((item: CartItem) => {
        const lineDueNow =
          item.purchaseType === PURCHASE_TYPE.PREORDER &&
          typeof item.preorderDepositAmount === "number"
            ? item.preorderDepositAmount
            : item.price * item.quantity;
        if (lineDueNow <= 0) return null;
        return {
          price_data: {
            currency: checkoutCurrency,
            product_data: {
              name: item.productId.name,
              images: item.productId.images?.slice(0, 1) || [],
            },
            unit_amount: toStripeAmount(
              lineDueNow / item.quantity,
              checkoutCurrency,
            ),
          },
          quantity: item.quantity,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    // Add shipping if applicable
    if (shippingCost > 0) {
      lineItems.push({
        price_data: {
          currency: checkoutCurrency,
          product_data: {
            name: "Shipping",
            images: [],
          },
          unit_amount: toStripeAmount(shippingCost, checkoutCurrency),
        },
        quantity: 1,
      });
    }

    // Add tax
    if (tax > 0) {
      lineItems.push({
        price_data: {
          currency: checkoutCurrency,
          product_data: {
            name: "Tax",
            images: [],
          },
          unit_amount: toStripeAmount(tax, checkoutCurrency),
        },
        quantity: 1,
      });
    }

    // Add estimated import duties (DDP) so the charged amount matches `total`.
    if (dutyAmount > 0) {
      lineItems.push({
        price_data: {
          currency: checkoutCurrency,
          product_data: {
            name: "Estimated duties",
            images: [],
          },
          unit_amount: toStripeAmount(dutyAmount, checkoutCurrency),
        },
        quantity: 1,
      });
    }

    // Same reason as the PaymentIntent path: a pre-order that will be asked for
    // its balance later needs the deposit to have belonged to a Customer — a
    // guest's minted for this cart, since they have no account to keep one on.
    const stripeCustomerId =
      (await resolveStripeCustomerId({
        secretKey: stripeSecretKey,
        userId: customerId,
        email: customerEmail,
        name: session?.user?.name,
      })) ||
      (guestEmail && preorderMandateText
        ? await resolveGuestStripeCustomerId({
            secretKey: stripeSecretKey,
            cartId: String(cart._id),
            email: customerEmail,
          })
        : undefined);

    // Create Stripe checkout session
    const checkoutSession = await getStripeForSecretKey(
      stripeSecretKey,
    ).checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      // Keep the card for the balance, on the same terms as the embedded card
      // flow: only where the shopper authorised it and there is a Customer for
      // Stripe to attach it to.
      ...(preorderMandateText && stripeCustomerId
        ? {
            payment_intent_data: {
              setup_future_usage: "off_session" as const,
            },
          }
        : {}),
      metadata: {
        // Carried on the session because that is what the order builder reads
        // when the hosted page is the one that took the money.
        preorderMandate: preorderMandateText,
        userId: customerId,
        cartId: String(cart._id),
        shippingAddress: JSON.stringify(normalizedShippingAddress),
        billingAddress: JSON.stringify(normalizedBillingAddress),
        customerEmail: customerEmail || "",
        subtotal: String(subtotal),
        tax: String(tax),
        discount: String(discount),
        total: String(total),
        // Taken after the re-priced lines were written back to the cart, which
        // is what the order builder will read and compare this against.
        cartFingerprint: checkoutCartFingerprint(items),
        couponCode: appliedCoupon?.code || "",
        couponType: appliedCoupon?.type || "",
        couponValue: appliedCoupon ? String(appliedCoupon.value) : "",
        couponId: appliedCoupon?.couponId || "",
        couponFundedBy: appliedCoupon?.fundedBy || "",
        couponVendorShares: couponVendorShares
          ? JSON.stringify(couponVendorShares)
          : "",
        couponShippingShares: couponShippingShares
          ? JSON.stringify(couponShippingShares)
          : "",
        ...(shippingResolution
          ? buildShippingMetadata(shippingResolution)
          : {
              shipping: "0",
              shippingMethod: JSON.stringify(selectedShippingMethod),
              customsDuty: "0",
              customs: JSON.stringify(customsEstimate),
              vendorShipping: "",
            }),
        pickupFulfillment: pickupFulfillment
          ? JSON.stringify(pickupFulfillment)
          : "",
      },
      // A Session takes one or the other, never both. The Customer is the more
      // useful of the two when we have it: the hosted page still prefills the
      // address from it, and the payment lands on a person the later balance
      // charge can be made against.
      ...(stripeCustomerId
        ? { customer: stripeCustomerId }
        : { customer_email: customerEmail }),
      success_url: `${origin}/${activeLocale}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/${activeLocale}/checkout?canceled=true`,
    });

    return NextResponse.json({
      success: true,
      data: {
        sessionId: checkoutSession.id,
        url: checkoutSession.url,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Helper to create order
 */
async function createOrder(params: {
  customerId: string;
  /** Email the shopper entered at checkout — set only for guest orders. */
  guestEmail?: string;
  items: CartItem[];
  shippingAddress: CheckoutShippingAddress;
  billingAddress: CheckoutShippingAddress;
  paymentMethod: string;
  paymentStatus: string;
  subtotal: number;
  discount: number;
  shippingCost: number;
  tax: number;
  total: number;
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
  paypalOrderId?: string;
  razorpayOrderId?: string;
  paystackReference?: string;
  pesapalOrderTrackingId?: string;
  pesapalMerchantReference?: string;
  iotecTransactionId?: string;
  iotecExternalId?: string;
  orangeMoneyOrderId?: string;
  mtnMomoReferenceId?: string;
  mtnMomoPhone?: string;
  coupon?: {
    code: string;
    type: string;
    value: number;
    couponId: string;
    /** A scoped coupon's discount by vendor, recorded on each consignment. */
    vendorShares?: Record<string, number>;
    /** A free-shipping coupon's discount by the vendor whose delivery it paid. */
    shippingShares?: Record<string, number>;
    /** Who pays for the goods discount, frozen onto the order. */
    fundedBy?: "platform" | "vendor";
  };
  /** The coupon's use was already taken for this order (`takeCouponUse`). */
  couponUseTaken?: boolean;
  isMultiVendorEnabled: boolean;
  orderPrefix?: string;
  currency?: string;
  /** True when no item on the order needs physical shipping. */
  digitalOnly?: boolean;
  /** The card-on-file agreement, when this order leaves a balance owing. */
  preorderMandateText?: string;
  /** The Stripe PaymentMethod kept for that balance, if one was collected. */
  preorderSavedPaymentMethodId?: string;
  /** The Stripe Customer that card was saved against. */
  stripeCustomerId?: string;
  shippingMethod?: {
    name?: string;
    optionId?: string;
    minDays?: number;
    maxDays?: number;
  };
  customs?: {
    dutyAmount: number;
    dutyMode?: "DDP" | "DDU";
    international?: boolean;
    collectedAtCheckout?: boolean;
  };
  vendorShippingCosts?: Map<
    string,
    {
      cost: number;
      method: { name?: string; optionId?: string; minDays?: number; maxDays?: number };
    }
  >;
  fulfillment?: PickupFulfillmentSnapshot;
  /** The shopper's order note, when the store asks for one. */
  customerNote?: string;
  /** Answers to the store's own checkout fields. */
  checkoutFields?: OrderCheckoutField[];
  /** The phone the shopper asked to be reached on. */
  contactPhone?: string;
}) {
  const {
    customerId,
    guestEmail,
    items,
    shippingAddress,
    billingAddress,
    paymentMethod,
    paymentStatus,
    subtotal,
    discount,
    shippingCost,
    tax,
    total,
    stripeSessionId,
    stripePaymentIntentId,
    paypalOrderId,
    razorpayOrderId,
    paystackReference,
    pesapalOrderTrackingId,
    pesapalMerchantReference,
    iotecTransactionId,
    iotecExternalId,
    orangeMoneyOrderId,
    mtnMomoReferenceId,
    mtnMomoPhone,
    coupon,
    couponUseTaken,
    isMultiVendorEnabled,
    orderPrefix,
    currency,
    digitalOnly,
    shippingMethod,
    customs,
    vendorShippingCosts,
    fulfillment,
    customerNote,
    checkoutFields,
    contactPhone,
  } = params;

  // Each line's balance after the coupon — see `preorderOutstandingAfterCoupon`.
  // A free-shipping coupon discounts delivery, never goods.
  const adjustedOutstanding = preorderOutstandingAfterCoupon(
    preorderSplitLines(items),
    {
      goodsDiscount: isFreeShippingCouponType(coupon?.type) ? 0 : discount,
      vendorShares: coupon?.vendorShares,
    },
    currency || "USD",
  );
  const outstandingByLine = new Map<CartItem, number>(
    items.map((item, index) => [item, adjustedOutstanding[index] ?? 0]),
  );
  const outstandingOf = (item: CartItem) =>
    item.purchaseType === PURCHASE_TYPE.PREORDER
      ? outstandingByLine.get(item) ?? item.preorderOutstandingAmount
      : item.preorderOutstandingAmount;

  // Generate order number atomically (seeds from max(existing) on first call)
  const orderNumber = await getNextOnlineOrderNumber(orderPrefix);

  const vendorContext = await resolveOrderVendorContext({
    isMultiVendorEnabled,
  });
  const vendorGroups = groupItemsByOrderVendor(
    items,
    vendorContext,
    (item) => item.productId.vendorId,
  );
  const hasPreorder = items.some(
    (item) => item.purchaseType === PURCHASE_TYPE.PREORDER,
  );
  const initialOrderStatus = hasPreorder
    ? ORDER_STATUS.PREORDERED
    : ORDER_STATUS.PENDING;
  // `getSettings` is React-cached, so this rides the same read the request has
  // already done rather than threading one more param through every caller.
  const orderSettings = await getSettings();
  const subOrders = await buildVendorSubOrders(vendorGroups, {
    codCollectedByDefault: orderSettings.shipping?.codCollectedBy,
    couponDiscountByVendor: params.coupon?.vendorShares,
    getProductId: (item) => item.productId._id,
    getVariantId: (item) => item.variantId,
    getName: (item) => item.productId.name,
    getSku: (item) => item.productId.sku,
    getQuantity: (item) => item.quantity,
    getPrice: (item) => item.price,
    getCost: (item) =>
      resolveOrderItemCost({
        product: item.productId,
        variantId: item.variantId,
      }),
    getImage: (item) => item.productId.images?.[0],
    getPurchaseType: (item) => item.purchaseType || PURCHASE_TYPE.STANDARD,
    getPreorderReleaseDate: (item) => item.preorderReleaseDate,
    getPreorderMessage: (item) => item.preorderMessage,
    getPreorderStatus: (item) =>
      item.purchaseType === PURCHASE_TYPE.PREORDER
        ? PREORDER_ITEM_STATUS.RESERVED
        : undefined,
    getPreorderPaymentMode: (item) => item.preorderPaymentMode,
    getPreorderDepositAmount: (item) => item.preorderDepositAmount,
    getPreorderOutstandingAmount: (item) => outstandingOf(item),
    getPreorderSupplierEta: (item) => item.preorderSupplierEta,
    getPreorderBatchName: (item) => item.preorderBatchName,
    getCustoms: (item) => {
      const variant = item.variantId
        ? item.productId.variants?.find(
            (candidate) =>
              candidate._id.toString() === String(item.variantId),
          )
        : undefined;
      return buildOrderItemCustomsSnapshot({
        productShipping: item.productId.shipping,
        variantShipping: variant,
      });
    },
    status: initialOrderStatus,
  });

  // Allocate shipping to each sub-order (per-vendor map, or the whole cost to
  // the sole sub-order for single shipments). Shared with the Stripe paths.
  allocateSubOrderShipping(
    subOrders as Array<{
      vendorId: { toString: () => string };
      shippingCost?: number;
      shippingDiscount?: number;
      shippingMethod?: unknown;
    }>,
    {
      vendorShippingCosts: vendorShippingCosts ?? new Map(),
      orderShippingCost: shippingCost,
      orderShippingMethod: shippingMethod,
      shippingDiscountByVendor: params.coupon?.shippingShares,
    },
  );
  if (fulfillment?.method === "pickup") {
    const pickupSubOrder = subOrders.find(
      (subOrder) =>
        subOrder.vendorId.toString() === fulfillment.pickup.vendorId,
    ) as (typeof subOrders)[number] & { fulfillment?: PickupFulfillmentSnapshot };
    if (pickupSubOrder) pickupSubOrder.fulfillment = fulfillment;
  }

  const preorderReleaseDate = getPreorderReleaseDateForOrder(items);
  const preorderItems = items.filter(
    (item) => item.purchaseType === PURCHASE_TYPE.PREORDER,
  );
  const preorderPaymentModes = new Set(
    preorderItems.map((item) => item.preorderPaymentMode || "full"),
  );
  const preorderPaymentMode =
    preorderPaymentModes.size === 1
      ? Array.from(preorderPaymentModes)[0]
      : hasPreorder
        ? "full"
        : undefined;
  const preorderDepositAmount = preorderItems.reduce(
    (sum, item) => sum + Number(item.preorderDepositAmount || 0),
    0,
  );
  // The same split the charge was worked out from, written onto every line,
  // consignment and the order, so the balance asked for later is the one the
  // shopper agreed to at checkout.
  const preorderOutstandingAmount = preorderItems.reduce(
    (sum, item) => sum + Number(outstandingOf(item) || 0),
    0,
  );

  // Create order. A gateway order's coupon use is counted on the capture/verify
  // path, so an abandoned payment doesn't burn one — the checkout holds it
  // meanwhile. Cash on delivery and pay-later took theirs before calling here,
  // the order itself being the commitment.
  const order = await Order.create({
    customerId,
    guestEmail,
    orderNumber,
    currency: currency || "USD",
    items: items.map((item: CartItem) => ({
      productId: item.productId._id,
      variantId: item.variantId,
      vendorId: getOrderItemVendorId(item.productId.vendorId, vendorContext),
      name: item.productId.name,
      sku: item.productId.sku || "",
      quantity: item.quantity,
      price: item.price,
        quoteId: item.quoteId,
        cost: resolveOrderItemCost({
          product: item.productId,
          variantId: item.variantId,
        }),
        image: item.productId.images?.[0],
        purchaseType: item.purchaseType || PURCHASE_TYPE.STANDARD,
        preorderReleaseDate: item.preorderReleaseDate,
        preorderMessage: item.preorderMessage,
        preorderStatus:
          item.purchaseType === PURCHASE_TYPE.PREORDER
            ? PREORDER_ITEM_STATUS.RESERVED
            : undefined,
        preorderPaymentMode: item.preorderPaymentMode,
        preorderDepositAmount: item.preorderDepositAmount,
        preorderOutstandingAmount: outstandingOf(item),
        preorderSupplierEta: item.preorderSupplierEta,
        preorderBatchName: item.preorderBatchName,
        customs: buildOrderItemCustomsSnapshot({
          productShipping: item.productId.shipping,
          variantShipping: item.variantId
            ? item.productId.variants?.find(
                (candidate) =>
                  candidate._id.toString() === String(item.variantId),
              )
            : undefined,
        }),
      })),
    subOrders,
    shippingAddress,
    billingAddress,
    digitalOnly: Boolean(digitalOnly),
    paymentMethod,
    paymentStatus,
    stripeSessionId,
    stripePaymentIntentId,
    paypalOrderId,
    razorpayOrderId,
    paystackReference,
    pesapalOrderTrackingId,
    pesapalMerchantReference,
    iotecTransactionId,
    iotecExternalId,
    orangeMoneyOrderId,
    mtnMomoReferenceId,
    mtnMomoPhone,
    subtotal,
    shippingCost,
    shippingMethod,
    fulfillment,
    customs: customs
      ? {
          dutyAmount: customs.dutyAmount,
          dutyMode: customs.dutyMode,
          international: customs.international,
          collectedAtCheckout: customs.collectedAtCheckout,
        }
      : undefined,
    tax,
    discount,
    coupon: coupon
      ? {
          code: coupon.code,
          type: coupon.type,
          value: coupon.value,
          couponId: coupon.couponId,
          fundedBy: coupon.fundedBy,
          usageIncremented: Boolean(couponUseTaken),
        }
      : undefined,
    total,
    hasPreorder,
    preorderStatus: hasPreorder ? PREORDER_ITEM_STATUS.RESERVED : undefined,
    preorderReleaseDate,
    preorderAcknowledgedAt: hasPreorder ? new Date() : undefined,
    ...(params.preorderMandateText
      ? {
          preorderMandateAcceptedAt: new Date(),
          preorderMandateText: params.preorderMandateText,
          ...(params.preorderSavedPaymentMethodId
            ? {
                preorderSavedPaymentMethodId:
                  params.preorderSavedPaymentMethodId,
                ...(params.stripeCustomerId
                  ? { stripeCustomerId: params.stripeCustomerId }
                  : {}),
              }
            : {}),
        }
      : {}),
    preorderPaymentMode,
    preorderDepositAmount,
    preorderOutstandingAmount,
    // Pickup orders used to be created CANCELLED and activated only once slot
    // capacity was confirmed. With no capacity to claim there is nothing to
    // wait for — and the old dance was fragile besides, since every non-Stripe
    // finalizer refuses to touch a CANCELLED order, so a failed activation
    // stranded a paid-for order permanently.
    status: initialOrderStatus,
    customerNote,
    contactPhone,
    checkoutFields: checkoutFields?.length ? checkoutFields : undefined,
  });

  // Spend the quote offers this order was placed against, so the same
  // negotiated price cannot be taken twice. Bound at placement rather than at
  // capture — an unbound offer is a live one, and a shopper sitting on a
  // gateway page could otherwise start a second checkout at the same price.
  // The quote is only marked *won* where there is no capture step to wait for;
  // for every prepaid gateway settleCapturedOrder does that once the money is
  // actually in. A cancelled order releases the offer again, at no cost:
  // lib/quotes/quote-offer.ts derives that from the order's own status.
  await bindOffersToOrder(
    items
      .map((item) => (item.quoteId ? String(item.quoteId) : ""))
      .filter(Boolean),
    String(order._id),
    { won: paymentMethod === "cod" },
  ).catch((err) => console.error("Failed to close quote offers on order:", err));

  // Every checkout leaves a customer record behind, the Shopify way: a guest
  // order upserts an email-keyed guest row in the customers collection at the
  // moment the order exists — not when payment lands — so COD guests appear
  // in the admin list immediately. Best-effort: the stats refresh on payment
  // re-upserts the same row, so a miss here heals itself.
  if (guestEmail) {
    const { upsertGuestCustomerProfile } = await import("@/lib/customers/customer");
    await upsertGuestCustomerProfile({
      email: guestEmail,
      name: shippingAddress.fullName,
    }).catch((err) =>
      console.error("Failed to upsert guest customer profile:", err),
    );
  }

  return order;
}
