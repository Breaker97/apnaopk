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
import { checkoutCartFingerprint } from "@/lib/checkout/checkout-cart-fingerprint";
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
import {
  resolveGuestStripeCustomerId,
  resolveStripeCustomerId,
} from "@/lib/payments/stripe-customer";
import {
  couponHoldKey,
  holdCouponUse,
  splitCouponDiscount,
  validateAndCalculateCoupon,
} from "@/lib/catalog/coupons";
import { validateBody } from "@/lib/api/validate";
import { PRODUCT_STATUS } from "@/config/app.config";
import { isStorefrontProductSourceAllowed } from "@/lib/catalog/product-visibility";
import {
  PURCHASE_TYPE,
  getPreorderReleaseDateForOrder,
  resolvePurchaseType,
  type PreorderSettingsShape,
} from "@/lib/orders/preorders";
import {
  PREORDER_CARD_SETUP_KIND,
  buildPreorderMandateText,
  preorderMandateRequired,
} from "@/lib/payments/preorder-mandate";
import {
  assertDeferredBalanceCollectable,
  assertPreorderMandateAccepted,
} from "@/lib/payments/deferred-balance";
import {
  rateLimitByIP,
  rateLimitBySession,
  rateLimitByUser,
} from "@/lib/api/rate-limit-middleware";
import { ConflictError, ValidationError } from "@/lib/api/errors";
import {
  CART_PRICES_CHANGED_MESSAGE,
  CART_PRICES_CHANGED_REASON,
  cartLinePriceChanged,
  type CartPriceChange,
} from "@/lib/checkout/cart-price-change";
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
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import {
  loadShopperOffers,
  matchOffersToLines,
  quoteOfferLineKey,
} from "@/lib/quotes/quote-offer";
import { isCountryAllowed } from "@/lib/intl/country-availability";
import { enforceCheckoutSubmission } from "@/lib/checkout/checkout-submission";
import { sumPreorderOutstandingAfterCoupon } from "@/lib/orders/preorder-coupon-split";

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
      postalCode: z.string().optional().default(""),
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
      postalCode: z.string().optional().default(""),
      country: z.string().min(1),
      phone: z.string().optional(),
    })
    .optional(),
  locale: z.string().optional(),
  email: z.string().email().optional(),
  couponCode: z.string().min(3).max(20).optional(),
  preorderAcknowledged: z.boolean().optional(),
  /**
   * The card-on-file authorisation, as a bare boolean. The words it agrees to
   * are composed here rather than sent — see `lib/payments/preorder-mandate.ts`.
   */
  preorderMandateAccepted: z.boolean().optional(),
  selectedShippingOptionId: z.string().max(100).optional(),
  vendorShippingSelections: z.record(z.string(), z.string().max(100)).optional(),
  fulfillmentMethod: z.enum(["delivery", "pickup"]).optional().default("delivery"),
  pickupLocationId: z.string().min(1).optional(),
  // Same contact phone / note / store fields as the online-checkout route.
  phone: z.string().trim().max(30).optional(),
  customerNote: z.string().max(2000).optional(),
  customFields: z
    .record(
      z.string().max(50),
      z.union([z.string().max(2000), z.boolean(), z.number()]),
    )
    .optional(),
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
  /** The offer that priced this line, when the product is sold by quote. */
  quoteId?: string;
  purchaseType?: string;
  preorderOutstandingAmount?: number;
  preorderReleaseDate?: Date | string;
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
      preorderMandateAccepted,
      selectedShippingOptionId,
      vendorShippingSelections,
      fulfillmentMethod,
      pickupLocationId,
      phone,
      customerNote,
      customFields,
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
    // May be absent on a phone-first store; the checkout settings decide,
    // enforced below once the cart is known.
    const customerEmail =
      typeof email === "string" && email.trim().length > 0
        ? email.trim()
        : session?.user?.email;

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
    // Lines whose live price differs from the one the shopper was shown.
    const priceChanges: CartPriceChange[] = [];

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
    // The offers this shopper still holds, matched to lines at the quantity
    // they were quoted for — the same resolution the checkout route runs.
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

      // Priced as the checkout route prices it. This route charged the price
      // stored on the cart line when it was added — carts live up to 30 days —
      // so a raised price, an ended sale, or a quote that was withdrawn, spent
      // on another order or quoted for a different quantity was still charged
      // at the old figure by card.
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
      if (lineOffer) {
        // Not a price change: the cart already shows the shopper the offer
        // (GET /api/cart prices quoted lines from it), so this is the figure
        // on their screen.
        item.price = lineOffer.unitPrice;
      } else if (
        (item.purchaseType || PURCHASE_TYPE.STANDARD) !== PURCHASE_TYPE.PREORDER
      ) {
        // Pre-order lines keep their price: the deposit and balance on the
        // line were worked out against it when it was reserved.
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

    // Written back before anything is charged: the Stripe order builder reads
    // the cart, and its quote guards compare the cart against what this route
    // charges. A line left at its stored price would read as a tampered cart
    // and refund a payment taken at the right one. Awaited, not best-effort,
    // for the same reason — a charge the cart does not agree with is refunded.
    const repriceOps = items
      .filter((item) => (item as unknown as { _id?: unknown })._id)
      .map((item) => ({
        updateOne: {
          filter: { _id: cart._id },
          update: item.quoteId
            ? {
                $set: {
                  "items.$[el].price": item.price,
                  "items.$[el].quoteId": item.quoteId,
                },
              }
            : {
                $set: { "items.$[el].price": item.price },
                $unset: { "items.$[el].quoteId": "" },
              },
          arrayFilters: [
            { "el._id": (item as unknown as { _id: unknown })._id },
          ],
        },
      }));
    if (repriceOps.length > 0) {
      await Cart.bulkWrite(repriceOps);
    }

    // The card is confirmed against the total on the shopper's screen, and
    // that total was built from the prices stored on the cart. A live price
    // that moved since would be charged without their ever seeing it — so stop
    // here, before any intent exists, with the cart already holding the new
    // prices for the page to show.
    if (priceChanges.length > 0) {
      throw new ConflictError(CART_PRICES_CHANGED_MESSAGE, {
        reason: CART_PRICES_CHANGED_REASON,
        items: priceChanges,
      });
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

    // The configured checkout form, held to exactly as the online-checkout
    // route holds it — see enforceCheckoutSubmission.
    const submission = enforceCheckoutSubmission({
      settings,
      user: session?.user
        ? {
            email: session.user.email,
            phone: (session.user as { phone?: string | null }).phone,
          }
        : null,
      digitalOnly: !hasShippableItems,
      body: { email, phone, paymentMethod: "card", customerNote, customFields },
      shippingAddress: shippingAddressInput,
      billingAddress: billingAddressInput,
    });
    if (submission.contactPhone) {
      normalizedShippingAddress.phone ||= submission.contactPhone;
      normalizedBillingAddress.phone ||= submission.contactPhone;
    }

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
    // What each seller's delivery costs, for a seller's own free-shipping coupon.
    const shippingByVendor = shippingResolution
      ? Object.fromEntries(
          [...shippingResolution.vendorShippingCosts].map(([vendorId, entry]) => [
            vendorId,
            entry.cost,
          ]),
        )
      : undefined;
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

    // Coupons/discounts are computed from the selected shipping cost; duties are
    // added on top of the discounted total (never discounted).
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
    // Carried to the order builder so a scoped coupon comes off the vendor
    // whose items earned it — see `couponDiscount` on the sub-order.
    const couponVendorShares = appliedCoupon?.vendorShares
      ? discount === appliedCoupon.discount
        ? appliedCoupon.vendorShares
        : splitCouponDiscount(discount, appliedCoupon.vendorShares)
      : undefined;
    // The same, for a free-shipping coupon: whose delivery it actually paid
    // for — see `shippingDiscount` on the sub-order.
    const couponShippingShares = appliedCoupon?.shippingShares
      ? discount === appliedCoupon.discount
        ? appliedCoupon.shippingShares
        : splitCouponDiscount(discount, appliedCoupon.shippingShares)
      : undefined;
    // For deposit-mode pre-orders only the deposit is due now; the outstanding
    // balance is collected later. Charging the full `total` here (as before)
    // takes the whole amount up front yet the order is still marked
    // partially_paid, so the balance flow would charge the customer twice.
    // After the coupon, which comes off the deposit and the balance in
    // proportion — see `preorderOutstandingAfterCoupon`. The order builder
    // works the same figure out from the same cart and metadata.
    const preorderOutstandingAmount = sumPreorderOutstandingAfterCoupon(
      items.map((item: CartItem) => {
        const vendor = item.productId.vendorId;
        return {
          price: item.price,
          quantity: item.quantity,
          purchaseType: item.purchaseType,
          preorderOutstandingAmount: item.preorderOutstandingAmount,
          vendorId: vendor
            ? String(typeof vendor === "object" ? vendor._id : vendor)
            : null,
        };
      }),
      { goodsDiscount: totals.subtotalDiscount, vendorShares: couponVendorShares },
      settings.general?.defaultCurrency || "USD",
    );
    const paymentDueNow = Math.max(0, total - preorderOutstandingAmount);

    /** No user account behind this order — its customer id will be the cart. */
    const isGuestCheckout = !session?.user?.id && !guestAccount;

    // Stripe can collect the balance later either way, so nothing here fails
    // for a card checkout: a guest is reached through the signed balance link
    // instead of the account page.
    assertDeferredBalanceCollectable({
      paymentMethod: "stripe",
      outstandingAmount: preorderOutstandingAmount,
    });

    // Keeping a shopper's card for a charge they will not be present for needs
    // their say-so, so the balance arms of this route refuse without it. This
    // route is card-only, so a card is always what is at stake — for a guest
    // too, now that a guest's card has a Customer to live on. The text is
    // built here and never taken from the request: the client agrees to a
    // sentence, and the sentence the order records has to be the one the
    // server can vouch for.
    assertPreorderMandateAccepted({
      outstandingAmount: preorderOutstandingAmount,
      accepted: preorderMandateAccepted,
      savesCard: true,
    });
    const preorderMandateText =
      preorderMandateRequired(preorderOutstandingAmount)
      ? buildPreorderMandateText({
          outstandingAmount: preorderOutstandingAmount,
          currency: settings.general?.defaultCurrency || "USD",
          releaseDate: getPreorderReleaseDateForOrder(items),
        })
      : "";

    const activeLocale =
      typeof locale === "string" && locale.length > 0 ? locale : "en";
    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";

    const stripe = getStripeForSecretKey(stripeSecretKey);
    const currency = (settings.general?.defaultCurrency || "USD").toLowerCase();

    // Give the charge a Customer to belong to. Nothing is saved by attaching
    // one — that needs `setup_future_usage` and the shopper's consent — but a
    // pre-order whose balance is meant to be charged later has to have had a
    // Customer on the deposit in the first place.
    //
    // A signed-in shopper's lives on their account. A true guest has no
    // account, so theirs is minted for this cart and carried to the order on
    // the intent's metadata — minted only when there is a balance to keep a
    // card for, so an ordinary guest sale leaves no Customer behind.
    const stripeCustomerId =
      (await resolveStripeCustomerId({
        secretKey: stripeSecretKey,
        userId: customerId,
        email: customerEmail,
        name: session?.user?.name,
      })) ||
      (isGuestCheckout && preorderMandateText
        ? await resolveGuestStripeCustomerId({
            secretKey: stripeSecretKey,
            cartId: String(cart._id),
            email: customerEmail,
          })
        : undefined);

    // Nothing is due today: a pay-later pre-order whose shipping and tax came
    // to nothing. There is no charge for `setup_future_usage` to ride on, and
    // Stripe will not create a zero-amount PaymentIntent — this arm used to
    // reach `paymentIntents.create` with an amount of 0 and simply fail there,
    // which is how a pure pay-later cart has been unbuyable. A SetupIntent is
    // the right primitive: it collects and keeps the card without charging it.
    //
    // No webhook builds an order out of one. The client confirms it and then
    // places the order through /api/payments/checkout, which reads the card
    // off the SetupIntent — so this arm returns early, before the abandoned
    // checkout snapshot that only describes a payment.
    if (paymentDueNow <= 0) {
      if (!stripeCustomerId) {
        throw new ValidationError({
          paymentMethod: [
            "We could not set up your card for this pre-order just now. Please try again in a moment.",
          ],
        });
      }
      const setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomerId,
        payment_method_types: ["card"],
        // The card will be charged with nobody at the keyboard, and Stripe
        // authenticates it differently on that promise.
        usage: "off_session",
        metadata: {
          kind: PREORDER_CARD_SETUP_KIND,
          userId: customerId,
          cartId: String(cart._id),
          preorderMandate: preorderMandateText,
        },
      });
      if (!setupIntent.client_secret) {
        return NextResponse.json(
          { success: false, message: "Failed to start card setup" },
          { status: 500 },
        );
      }
      return NextResponse.json({
        success: true,
        data: {
          mode: "setup",
          setupIntentId: setupIntent.id,
          clientSecret: setupIntent.client_secret,
        },
      });
    }

    // A balance is owed and there is a charge to ride on, so keep the card in
    // the same confirmation that takes the deposit — one card entry, one
    // authentication, and the shopper is not asked twice.
    //
    // Both halves are required: without a Customer there is nowhere for Stripe
    // to put the card, and without the mandate there is no permission to keep
    // it. A balance order can only reach here signed in, so a missing Customer
    // means the mint failed and is worth saying out loud — the order still
    // works, the shopper just has to come back and pay the balance by hand.
    const saveCardForBalance = Boolean(preorderMandateText && stripeCustomerId);
    if (preorderMandateText && !stripeCustomerId) {
      console.error(
        "Pre-order balance mandate accepted but no Stripe customer to save the card against",
      );
    }

    // One use of a limited coupon, kept for this shopper while the card is
    // charged; capture turns it into the use. Refused before Stripe is asked for
    // anything when the coupon has no use to spare.
    if (appliedCoupon) {
      await holdCouponUse({
        couponId: appliedCoupon.couponId,
        holdKey: couponHoldKey(customerId),
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: toStripeAmount(paymentDueNow, currency),
      currency,
      payment_method_types: ["card"],
      receipt_email: customerEmail,
      ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
      ...(saveCardForBalance
        ? { setup_future_usage: "off_session" as const }
        : {}),
      metadata: {
        preorderMandate: preorderMandateText,
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
        // What these figures were worked out from, so the order builder can
        // refuse a cart whose lines changed but still add up to the subtotal.
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
      // The order is created later by the Stripe finalizer, which copies
      // these from the cart — they are too free-form for intent metadata.
      cartDoc.checkoutDetails = {
        customerNote: submission.customerNote,
        checkoutFields: submission.checkoutFields,
        contactPhone: submission.contactPhone,
      };
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
        mode: "payment",
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
      },
    });
  },
);
