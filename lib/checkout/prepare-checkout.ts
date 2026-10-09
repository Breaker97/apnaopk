import "server-only";
import type * as z from "zod";
import { buildLocalePath } from "@/lib/i18n/locale-prefix";
import { getLocaleRouting } from "@/lib/i18n/locale-routing";
import { assertWholeQuantities } from "@/lib/cart/cart-item-quantity";
import { afterResponse } from "@/lib/after-response";
import { Cart, Product } from "@/models";
import { findAccountForGuestCheckout } from "@/lib/customers/customer";
import { assertGuestEmailAllowed } from "@/lib/checkout/shopper-account";
import { getSettings } from "@/models/settings.model";
import {
  PURCHASE_TYPE,
  getPreorderReleaseDateForOrder,
  resolvePurchaseType,
  type PreorderSettingsShape,
} from "@/lib/orders/preorders";
import { carriedEligibleProductIds } from "@/lib/orders/coupon-line-split";
import {
  DEFAULT_FREE_SHIPPING_THRESHOLD,
  DEFAULT_ORDER_SHIPPING_COST,
  DEFAULT_ORDER_TAX_RATE,
} from "@/lib/orders/order-settings";
import {
  couponHoldKey,
  holdCouponUse,
  splitCouponDiscount,
  validateAndCalculateCoupon,
} from "@/lib/catalog/coupons";
import {
  CANONICAL_CART_WEIGHT_UNIT,
  SHIPPING_UNAVAILABLE_MESSAGE,
  type ShippingSettings,
} from "@/lib/shipping/shipping";
import { resolveCheckoutShipping } from "@/lib/checkout/checkout-shipping";
import { calculateCheckoutTotals } from "@/lib/catalog/discounts";
import { sumPreorderOutstandingAfterCoupon } from "@/lib/orders/preorder-coupon-split";
import { ConflictError, ValidationError } from "@/lib/api/errors";
import {
  CART_PRICES_CHANGED_MESSAGE,
  CART_PRICES_CHANGED_REASON,
  cartLinePriceChanged,
  type CartPriceChange,
} from "@/lib/checkout/cart-price-change";
import {
  assertCartPreorderQuota,
  preorderLineCartSet,
  refreshPreorderCartLine,
} from "@/lib/checkout/preorder-cart-lines";
import { checkoutAttemptFingerprint } from "@/lib/checkout/checkout-attempts";
import { MARKETING_CONSENT_STATE } from "@/config/app.config";
import type { CheckoutSchema } from "@/lib/validations";
import {
  enforceCheckoutSubmission,
  reviewCheckoutSubmission,
} from "@/lib/checkout/checkout-submission";
import { assertCartVendorsSellable } from "@/lib/checkout/sellable-vendors";
import { isStorefrontProductSourceAllowed } from "@/lib/catalog/product-visibility";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import {
  loadShopperOffers,
  matchOffersToLines,
  quoteOfferLineKey,
} from "@/lib/quotes/quote-offer";
import {
  groupItemsByOrderVendor,
  resolveOrderVendorContext,
} from "@/lib/orders/order-vendors";
import {
  assertDeferredBalanceCollectable,
  assertPreorderMandateAccepted,
} from "@/lib/payments/deferred-balance";
import {
  buildPreorderMandateText,
  preorderMandateRequired,
} from "@/lib/payments/preorder-mandate";
import { updateCheckoutSnapshot } from "@/lib/orders/abandoned-checkouts";
import { assertStorefrontWriteAllowed } from "@/lib/maintenance";
import {
  resolveItemShipping,
  type ProductShippingData,
} from "@/lib/catalog/product-shipping";
import {
  pickupCheckoutCharges,
  resolvePickupCheckoutFulfillment,
  type PickupFulfillmentSnapshot,
} from "@/lib/checkout/checkout-pickup";
import { isCountryAllowed } from "@/lib/intl/country-availability";
import {
  assertPaymentMethodSettles,
  storeCurrencyCode,
} from "@/lib/payments/gateway-currencies";
import {
  assessCardTesting,
  CARD_TESTING_BLOCKED_MESSAGE,
  CARD_TESTING_CAPTCHA_MESSAGE,
} from "@/lib/checkout/card-testing-guard";
import { verifyTurnstileToken } from "@/lib/checkout/turnstile";
import { quantizeToCurrency } from "@/lib/intl/money";
import { checkoutStoreCredit } from "@/lib/store-credit/checkout-credit";
import {
  checkoutCreditAvailable,
  holdCheckoutCredit,
} from "@/lib/store-credit/store-credit";
import {
  preorderSplitLines,
  type CheckoutCartItem,
  type CheckoutShippingAddress,
} from "@/lib/checkout/checkout-order-document";
import {
  checkoutFiguresOf,
  checkoutQuoteHash,
  CheckoutQuoteChangedError,
} from "@/lib/checkout/checkout-quote";

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
 * The checkout's common phase: everything the storefront checkout works out
 * before it hands the order to a way of paying. Who is buying, from which
 * cart, at what live price, delivered how and for how much, under which
 * coupon and which form — and, when placing, the writes every way of paying
 * shares: the consents, the abandoned-checkout record, the card-testing
 * check, the coupon's hold and the store credit's.
 *
 * Moved here from app/api/payments/checkout/route.ts, which still runs every
 * gateway branch on what this returns; its answers must not change
 * (tests/checkout-characterization.db.test.ts holds them). The shopper app's
 * checkout (lib/api-core/shop/checkout/) calls it too, first as a quote and
 * then to place the order.
 *
 * Two modes:
 * - `place` is the web checkout, exactly: it refuses what it always refused
 *   and writes what it always wrote.
 * - `quote` writes nothing at all — no re-priced cart, no consent, no
 *   snapshot, no hold — and reports instead of refusing what a shopper is
 *   still filling in: an address not given yet (`awaitingAddress`), a form
 *   not complete (`formErrors`), a coupon that does not apply
 *   (`couponError`), a delivery that is not possible (`shippingUnavailable`).
 *   It refuses only what no form can fix (an empty cart, a sold-out line).
 */

/** The request, as `CheckoutSchema` reads it. A quote may leave the method out. */
export type CheckoutInput = Omit<z.infer<typeof CheckoutSchema>, "paymentMethod"> & {
  paymentMethod?: z.infer<typeof CheckoutSchema>["paymentMethod"];
};

/** Who is checking out, and what the request says about where it came from. */
export interface CheckoutIdentity {
  /** The signed-in shopper, or null for a guest. */
  user: {
    id: string;
    email?: string;
    name?: string;
    phone?: string | null;
  } | null;
  /** A guest's cart: the web's `cart_session` cookie, the app's `X-Cart-Token`. */
  cartSessionId?: string;
  /**
   * The address the request came from, for the card-testing counters and
   * Turnstile: `getClientIP`'s answer, "unknown" when there is none.
   */
  clientIp: string;
  /** The store's origin, for the links a gateway or the answer sends back. */
  origin: string;
}

/** What a caller's own cart rules read of a line (`admitCart`). */
export type AdmissibleCartItem = {
  productId: {
    _id: unknown;
    name: string;
    shipping?: ProductShippingData;
    variants?: Array<{ _id: { toString(): string }; requiresShipping?: boolean }>;
  };
  variantId?: unknown;
  purchaseType?: string;
};

export interface PrepareCheckoutOptions {
  /**
   * Called with the cart's lines as soon as the cart is read, before anything
   * else is judged: a caller's own rules about what it may check out (the
   * shopper app's, lib/api-core/shop/checkout/app-checkout.ts).
   */
  admitCart?: (items: AdmissibleCartItem[]) => void;
  /**
   * Place only: the hash of the quote the shopper accepted
   * (`checkoutQuoteHash`). A cart price that moved since it was stored is then
   * not refused — the shopper saw the live one on the quote — and instead the
   * figures must still hash to this, or `CheckoutQuoteChangedError` is thrown
   * before anything is written.
   */
  acceptedQuote?: string;
}

type Mode = "quote" | "place";

/**
 * The address a quote is priced against before the shopper has given one:
 * nothing to deliver to, so nothing is charged for delivery.
 */
const NO_ADDRESS_YET: CheckoutShippingAddress = {
  fullName: "",
  street: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
};

/**
 * Whether an address says enough to be priced for delivery: the street, the
 * city and the country — the request's names for the checkout form's
 * DELIVERY_DESTINATION_FIELDS (components/checkout/checkout-helpers.tsx),
 * which the form waits for before it asks for rates. Change both together.
 */
function hasDeliveryDestination(
  address: { street?: string; city?: string; country?: string } | undefined,
): boolean {
  return Boolean(
    address?.street?.trim() && address.city?.trim() && address.country?.trim(),
  );
}

export function prepareCheckout(
  input: CheckoutInput,
  identity: CheckoutIdentity,
  options: PrepareCheckoutOptions & { mode: "quote" },
): Promise<PricedCheckout>;
export function prepareCheckout(
  input: CheckoutInput,
  identity: CheckoutIdentity,
  options: PrepareCheckoutOptions & { mode: "place" },
): Promise<CheckoutDraft>;
export function prepareCheckout(
  input: CheckoutInput,
  identity: CheckoutIdentity,
  options: PrepareCheckoutOptions & { mode: Mode },
): Promise<PricedCheckout | CheckoutDraft> {
  return runCheckout(input, identity, options);
}

async function runCheckout(
  input: CheckoutInput,
  identity: CheckoutIdentity,
  options: PrepareCheckoutOptions & { mode: Mode },
) {
  const quote = options.mode === "quote";
  const { user, cartSessionId, clientIp } = identity;
  const {
    shippingAddress,
    billingAddress,
    paymentMethod,
    locale,
    email,
    couponCode,
    buyerAcceptsMarketing,
    smsAcceptsMarketing,
    preorderAcknowledged,
    preorderMandateAccepted,
    selectedShippingOptionId,
    vendorShippingSelections,
    fulfillmentMethod,
    pickupLocationId,
    iotecChannel,
    phone,
    customerNote,
    customFields,
    turnstileToken,
    useStoreCredit,
  } = input;
  // May be absent: a store that reaches shoppers by phone does not collect
  // an email. Whether this request needed one is the checkout settings'
  // call, enforced below once the cart is known.
  const customerEmail =
    typeof email === "string" && email.trim().length > 0
      ? email.trim()
      : user?.email;
  // Nor may a guest check out under an admin, team or seller email — refused
  // before the cart is claimed, any stock is held or a gateway is asked. See
  // lib/checkout/shopper-account.ts.
  if (!user?.id) await assertGuestEmailAllowed(customerEmail);

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

  const cartQuery = user?.id
    ? { userId: user.id }
    : cartSessionId
      ? { sessionId: cartSessionId }
      : null;
  // The cart (customer or guest) is read alongside the settings: neither
  // needs the other. Awaited below, after the store-level checks.
  const cartRead = cartQuery
    ? Cart.findOne(cartQuery)
        .populate({
          path: "items.productId",
          // `shipping` + `inventory` decide whether `stock` is a limit at all
          // (lib/products/stock-policy.ts) — resolvePurchaseType() reads them.
          // `returns` + `collectionIds` mark a final-sale line on the order.
          select:
            "name price images vendorId stock inventory sku slug shipping variants returns collectionIds",
          populate: { path: "vendorId", select: "_id" },
        })
        .lean()
        .exec()
    : null;
  cartRead?.catch(() => undefined);

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

  // Checkout offers only the gateways that settle the store currency, but a
  // page opened before the currency changed still posts the old choice.
  // Refused here, before the cart is used or any stock is held, and in words
  // meant for the shopper — the per-gateway checks this replaces told them
  // to change the store's settings. (A quote may not have chosen one yet.)
  if (paymentMethod) {
    assertPaymentMethodSettles(paymentMethod, storeCurrencyCode(settings));
  }

  if (!cartRead) {
    throw new ValidationError({ cart: ["Cart is empty"] });
  }

  const cart = await cartRead;

  if (!cart || !cart.items || cart.items.length === 0) {
    throw new ValidationError({ cart: ["Cart is empty"] });
  }

  const items = cart.items as unknown as CheckoutCartItem[];
  assertWholeQuantities(items);
  options.admitCart?.(items);
  // The shopper's spendable store credit (R8), read alongside the product
  // and seller reads that follow: it needs only the shopper, the store
  // currency and this cart. `checkoutStoreCredit` below decides what of it
  // this order takes. A shopper who unticked it, and a guest, read nothing.
  const storeCreditAvailable =
    user?.id && (useStoreCredit !== false || paymentMethod === "store_credit")
      ? checkoutCreditAvailable({
          customerId: user.id,
          currency: settings.general?.defaultCurrency || "USD",
          cartId: cart._id,
        })
      : null;
  storeCreditAvailable?.catch(() => undefined);
  // A guest checkout whose email belongs to a shopper's verified account is
  // attached to that account, the way Shopify attaches orders by email —
  // the order shows up in their history immediately instead of waiting for
  // the login-time claim. Any other email stays a guest order; see
  // `findAccountForGuestCheckout`.
  const guestAccount =
    !user?.id && customerEmail
      ? await findAccountForGuestCheckout(customerEmail)
      : null;
  const customerId =
    user?.id ||
    (guestAccount ? String(guestAccount._id) : String(cart._id));
  // With no user account behind customerId, the order itself must carry the
  // guest's email or the public tracking/invoice lookups have nothing to
  // match against once the cart is gone.
  const guestEmail =
    user?.id || guestAccount ? undefined : customerEmail;
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

  // Before any gateway is asked for money: has this shopper's card been
  // refused so often that the refusals look like a script's? Read now, in
  // parallel with everything below, and acted on where it always was — the
  // verdict only needs the cart and the email, which are settled here.
  // See `lib/checkout/card-testing-guard.ts`.
  const cardTestingVerdict = assessCardTesting({
    checkoutToken: cart.checkoutToken,
    email: customerEmail,
    clientIp,
  }).catch((err) => {
    // A counter that cannot be read must not stop a sale.
    console.error("Failed to assess repeated payment failures:", err);
    return null;
  });
  // The hydrated cart the checkout snapshot is written to, fetched alongside
  // the reads below. Read again further down if the re-pricing writes to the
  // cart, since the snapshot copies its lines.
  // A quote writes no snapshot, so it reads no cart for one.
  let cartDocForSnapshot = quote ? null : Cart.findById(cart._id).exec();
  cartDocForSnapshot?.catch(() => undefined);

  const couponCartItems: Array<{
    productId: string;
    price: number;
    quantity: number;
    categoryId?: string;
    /** Priced by a quote offer — a discount code never comes off it. */
    quoted?: boolean;
  }> = [];
  // Lines whose live price differs from the one the shopper was shown.
  const priceChanges: CartPriceChange[] = [];
  const preorderQuotaLines: Parameters<typeof assertCartPreorderQuota>[0] = [];

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
  const itemVendorId = (item: CheckoutCartItem) =>
    String(
      (item.productId.vendorId as { _id?: string })?._id ||
        item.productId.vendorId ||
        "",
    );

  // Three reads that depend only on the cart, made together rather than one
  // after another: whether its sellers may sell, every product's live stock
  // and price (one query, not one per item — validated against the selected
  // variant to match the inventory decrement rules), and the quote offers.
  //
  // Quoted lines are priced by the merchant's offer, not by the catalogue —
  // a "price on request" product carries price 0, so the re-pricing below
  // would hand the shopper the whole order for nothing. Offers belong to an
  // account, so a guest checkout resolves none and any quoted line in it is
  // refused (a shopper who was quoted signs in; that is how the price found
  // them in the first place).
  const [, stockCheckProducts, shopperOffers] = await Promise.all([
    isMultiVendorEnabled
      ? assertCartVendorsSellable(
          Array.from(new Set(items.map(itemVendorId).filter(Boolean))),
        )
      : undefined,
    Product.find({
      _id: { $in: items.map((item) => item.productId._id) },
    }).lean<Array<StockCheckProduct & { _id: { toString: () => string } }>>(),
    loadShopperOffers(user?.id, {
      productIds: items.map((item) => String(item.productId._id)),
    }),
  ]);
  const stockCheckProductById = new Map(
    stockCheckProducts.map((product) => [product._id.toString(), product]),
  );
  const quoteOffers = matchOffersToLines(
    items.map((item) => ({
      productId: item.productId._id,
      variantId: item.variantId,
      quantity: item.quantity,
    })),
    shopperOffers,
  );
  // The price each line was stored with, so the re-pricing below writes back
  // only the lines whose price actually moved.
  const storedLinePrice = new Map(items.map((item) => [item, item.price]));

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
      quoted: Boolean(lineOffer),
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
    // Pre-order lines get the same, terms and date included — see
    // `refreshPreorderCartLine`.
    if (lineOffer) {
      // Not a price change: GET /api/cart already shows the shopper the
      // offer, so this is the figure on their screen.
      item.price = lineOffer.unitPrice;
    } else if (purchase.purchaseType === PURCHASE_TYPE.PREORDER) {
      const refreshed = refreshPreorderCartLine({
        item,
        product: product as unknown as Parameters<typeof refreshPreorderCartLine>[0]["product"],
        purchase,
        currency: settings.general?.defaultCurrency || "USD",
      });
      if (refreshed.changed) {
        priceChanges.push({
          productId: String(item.productId._id),
          variantId: item.variantId ? String(item.variantId) : undefined,
          name: item.productId.name,
          previousPrice: refreshed.previousPrice,
          price: refreshed.price,
        });
      }
      preorderQuotaLines.push({
        productId: String(item.productId._id),
        product: product as unknown as Parameters<typeof refreshPreorderCartLine>[0]["product"],
        variantId: item.variantId ? String(item.variantId) : undefined,
        quantity: item.quantity,
        name: item.productId.name,
      });
    } else {
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
      quoted: Boolean(lineOffer),
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
  //
  // A quote asked before the address is complete has nothing to deliver to
  // yet: it is priced without delivery and says so, the way the web checkout
  // waits for the same three fields before it asks for rates
  // (DELIVERY_DESTINATION_FIELDS).
  const awaitingAddress =
    quote && hasShippableItems && !hasDeliveryDestination(shippingAddressInput);
  const addressErrors: Record<string, string[]> = {};
  if (hasShippableItems && !shippingAddressInput) {
    if (!quote) {
      throw new ValidationError({
        shippingAddress: ["Shipping address is required"],
      });
    }
    addressErrors.shippingAddress = ["Shipping address is required"];
  }
  if (!shippingAddressInput && !billingAddressInput) {
    if (!quote) {
      throw new ValidationError({
        billingAddress: ["Billing address is required"],
      });
    }
    addressErrors.billingAddress = ["Billing address is required"];
  }
  const normalizedShippingAddress = (shippingAddressInput ??
    billingAddressInput ??
    NO_ADDRESS_YET)!;
  const normalizedBillingAddress =
    billingAddressInput ?? normalizedShippingAddress;
  const digitalOnly = !hasShippableItems;

  // The form the admin configured — contact method, required fields, the
  // store's own questions — held to on the server too. A quote reports what
  // is missing instead of refusing it: the shopper may not have reached it.
  const submission = (quote ? reviewCheckoutSubmission : enforceCheckoutSubmission)({
    settings,
    user: user
      ? {
          email: user.email,
          phone: user.phone,
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
  // Only the lines whose stored price moved (or pre-order lines, whose terms
  // are worked out again): an unchanged cart used to be rewritten on every
  // checkout.
  const repriceOps = items
    .filter((item) => (item as unknown as { _id?: unknown })._id)
    .filter(
      (item) =>
        item.price !== storedLinePrice.get(item) ||
        (item.purchaseType || PURCHASE_TYPE.STANDARD) === PURCHASE_TYPE.PREORDER,
    )
    .map((item) => ({
      updateOne: {
        filter: { _id: cart._id },
        update: {
        $set: {
          "items.$[el].price": item.price,
          // A pre-order line's terms were worked out again with its price.
          ...((item.purchaseType || PURCHASE_TYPE.STANDARD) ===
          PURCHASE_TYPE.PREORDER
            ? preorderLineCartSet(item, (field) => `items.$[el].${field}`)
            : {}),
        },
      },
        arrayFilters: [
          { "el._id": (item as unknown as { _id: unknown })._id },
        ],
      },
    }));
  // A price that moved since the shopper's summary was drawn is not charged
  // or ordered unseen: stop before any gateway is asked for anything. The
  // new prices are written first — and awaited, since the page re-reads the
  // cart to show them and the next attempt must find them there.
  // Every option of a product sharing one pre-order counter, together.
  //
  // A quote shows the live prices and writes none of them. An order placed
  // against an accepted quote was shown them already, so a moved price is no
  // reason to stop it: the quote's hash, checked below, is what holds the
  // shopper to what they saw — and the new prices are written only once it
  // has, so a refused order leaves the cart as it was.
  assertCartPreorderQuota(preorderQuotaLines);
  const persistRepricedLines = async () => {
    if (repriceOps.length === 0) return;
    await Cart.bulkWrite(repriceOps).catch((err) =>
      console.error("Failed to persist re-priced cart items:", err),
    );
    cartDocForSnapshot = Cart.findById(cart._id).exec();
    cartDocForSnapshot.catch(() => undefined);
  };
  if (!quote && options.acceptedQuote === undefined) {
    if (priceChanges.length > 0) {
      await Cart.bulkWrite(repriceOps);
      throw new ConflictError(CART_PRICES_CHANGED_MESSAGE, {
        reason: CART_PRICES_CHANGED_REASON,
        items: priceChanges,
      });
    }
    await persistRepricedLines();
  }

  // Calculate totals
  const subtotal = items.reduce(
    (sum: number, item: CheckoutCartItem) => sum + item.price * item.quantity,
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
        eligibleProductIds?: string[];
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
            owner: { userId: user?.id, sessionId: cartSessionId },
            pickupLocationId,
          })
        : (() => {
            throw new ValidationError("A pickup location is required");
          })()
      : undefined;
  const shippingResolution = pickupFulfillment || awaitingAddress
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
        currency: settings.general?.defaultCurrency,
      });
  // A quote reports a delivery that is not possible; placing refuses it.
  const shippingUnavailable = Boolean(
    shippingResolution && !shippingResolution.available,
  );
  if (shippingUnavailable && !quote) {
    throw new ValidationError(SHIPPING_UNAVAILABLE_MESSAGE);
  }
  const pickupCharges = pickupFulfillment
    ? pickupCheckoutCharges({ shippingCost: 0, dutyAmount: 0 })
    : null;
  // Without a resolution (a quote still waiting for its address) nothing is
  // charged for delivery yet and nothing is assessed at a border.
  const shippingCost =
    pickupCharges?.shippingCost ?? shippingResolution?.shippingCost ?? 0;
  const selectedShippingMethod = pickupFulfillment
    ? { name: "Local pickup", optionId: "pickup" }
    : shippingResolution?.selectedShippingMethod;
  const vendorShippingCosts = pickupFulfillment
    ? new Map()
    : (shippingResolution?.vendorShippingCosts ?? new Map());
  const customsEstimate = pickupFulfillment || !shippingResolution
    ? {
        dutyAmount: 0,
        dutyMode: "DDU" as const,
        international: false,
        collectedAtCheckout: false,
      }
    : shippingResolution.customs;
  const dutyAmount = pickupCharges?.dutyAmount ?? customsEstimate.dutyAmount;

  // What each seller's delivery costs, for a seller's own free-shipping coupon.
  const shippingByVendor = Object.fromEntries(
    [...vendorShippingCosts].map(([vendorId, entry]) => [vendorId, entry.cost]),
  );
  // A quote shows a code that does not apply next to the code, and prices
  // the order without it; placing refuses it.
  let couponError: ValidationError | undefined;
  if (couponCode) {
    try {
      appliedCoupon = await validateAndCalculateCoupon({
        code: couponCode,
        subtotal,
        shippingCost,
        shippingByVendor,
        cartItems: couponCartItems,
        userId: user?.id || (guestAccount ? String(guestAccount._id) : undefined),
        currency: settings.general?.defaultCurrency,
        email: customerEmail,
      });
    } catch (error) {
      if (!quote || !(error instanceof ValidationError)) throw error;
      couponError = error;
    }
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
      : splitCouponDiscount(
          discount,
          appliedCoupon.vendorShares,
          settings.general?.defaultCurrency,
        )
    : undefined;
  // The same for a free-shipping coupon: whose delivery it actually paid
  // for — see `shippingDiscount` on the sub-order.
  const couponShippingShares = appliedCoupon?.shippingShares
    ? discount === appliedCoupon.discount
      ? appliedCoupon.shippingShares
      : splitCouponDiscount(
          discount,
          appliedCoupon.shippingShares,
          settings.general?.defaultCurrency,
        )
    : undefined;
  // The products a scoped coupon applied to, as the card payment will carry
  // them — see `carriedEligibleProductIds`.
  const couponEligibleProductIds = couponVendorShares
    ? carriedEligibleProductIds(appliedCoupon?.eligibleProductIds)
    : undefined;
  // What is owed later, after the coupon — which comes off the deposit and
  // the balance in proportion rather than all off the deposit. See
  // `preorderOutstandingAfterCoupon`.
  const preorderOutstandingAmount = sumPreorderOutstandingAfterCoupon(
    preorderSplitLines(items),
    {
      goodsDiscount: totals.subtotalDiscount,
      vendorShares: couponVendorShares,
      eligibleProductIds: couponEligibleProductIds,
    },
    settings.general?.defaultCurrency || "USD",
  );
  const dueBeforeStoreCredit = Math.max(0, total - preorderOutstandingAmount);
  // What the shopper's store credit pays of this order (R8), held for it
  // below and spent when its payment lands. The gateway is asked for the
  // rest; a cash courier collects the rest.
  const storeCreditApplied = await checkoutStoreCredit({
    userId: user?.id,
    useStoreCredit,
    currency: settings.general?.defaultCurrency || "USD",
    cartId: cart._id,
    dueNow: dueBeforeStoreCredit,
    hasPreorder,
    paymentMethod: paymentMethod ?? "",
    vendorIds:
      paymentMethod === "cod"
        ? [
            ...groupItemsByOrderVendor(
              items,
              await resolveOrderVendorContext({ isMultiVendorEnabled }),
              (item) => item.productId.vendorId,
            ).keys(),
          ]
        : undefined,
    codCollectedByDefault: settings.shipping?.codCollectedBy,
    available: storeCreditAvailable,
  });
  const paymentDueNow = quantizeToCurrency(
    Math.max(0, dueBeforeStoreCredit - storeCreditApplied),
    settings.general?.defaultCurrency || "USD",
  );
  // How the order is paid is the shopper's last choice, so a quote judges
  // none of it; placing does, before anything is written.
  if (!quote) {
    if (paymentMethod === "store_credit" && paymentDueNow > 0) {
      throw new ValidationError({
        paymentMethod: [
          "Your store credit doesn't cover this order. Choose how to pay the rest.",
        ],
      });
    }
    // Nothing left for the chosen method to take: the checkout places such an
    // order as paid with store credit, and a gateway asked for nothing fails.
    if (paymentMethod !== "store_credit" && storeCreditApplied > 0 && !(paymentDueNow > 0)) {
      throw new ValidationError({
        paymentMethod: [
          "Your store credit covers this order. Place it without choosing a payment method.",
        ],
      });
    }

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
  }

  // The permission to keep the shopper's card, for the same reason and in
  // the same place: every card branch below either saves a card or hands the
  // balance to a page that will, and none of them may do it unasked. Only a
  // card checkout keeps one — guest or not, now that a guest's card has a
  // Customer to live on — so only a card checkout is asked. The wording is
  // composed here, never accepted from the request.
  const isCardCheckout = paymentMethod === "card";
  if (!quote) {
    assertPreorderMandateAccepted({
      outstandingAmount: preorderOutstandingAmount,
      accepted: preorderMandateAccepted,
      savesCard: isCardCheckout,
    });
  }
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

  // Everything the order is, priced — what a quote shows, and what every way
  // of paying below works from.
  const priced = {
    settings,
    cart,
    items,
    customerEmail,
    customerId,
    guestEmail,
    isMultiVendorEnabled,
    orderSettings,
    hasPreorder,
    hasDigitalItems,
    hasShippableItems,
    digitalOnly,
    normalizedShippingAddress,
    normalizedBillingAddress,
    submission,
    checkoutDetails,
    priceChanges,
    subtotal,
    discount,
    tax,
    total,
    shippingCost,
    dutyAmount,
    selectedShippingMethod,
    vendorShippingCosts,
    customsEstimate,
    shippingResolution,
    pickupFulfillment,
    appliedCoupon,
    couponVendorShares,
    couponShippingShares,
    couponEligibleProductIds,
    preorderOutstandingAmount,
    storeCreditApplied,
    paymentDueNow,
    preorderMandateText,
    itemVendorId,
  };

  if (quote) {
    const formErrors = {
      ...addressErrors,
      ...(submission as { errors?: Record<string, string[]> }).errors,
    };
    return {
      mode: "quote" as const,
      ...priced,
      awaitingAddress,
      shippingUnavailable,
      couponError,
      formErrors,
      // Whether the next payment will be asked for the human check, or not
      // taken at all — read, not acted on.
      cardTesting: await cardTestingVerdict,
    };
  }

  // The quote the shopper accepted must still be the order: one figure that
  // moved since — a price, a rate, a coupon's worth — and nothing is written.
  if (options.acceptedQuote !== undefined) {
    if (checkoutQuoteHash(checkoutFiguresOf(priced)) !== options.acceptedQuote) {
      throw new CheckoutQuoteChangedError();
    }
    await persistRepricedLines();
  }

  const activeLocale =
    typeof locale === "string" && locale.length > 0 ? locale : "en";

  const origin = identity.origin;
  // Where a gateway, or this answer, sends the shopper back — in the store's
  // own spelling of the path: the default language has no prefix, and
  // `/en/checkout/success` cost every default-language checkout a redirect.
  const { storeDefault } = await getLocaleRouting();
  const checkoutUrl = (path: string) =>
    `${origin}${buildLocalePath(activeLocale, path, storeDefault)}`;

  // "Email me with news and offers", but only where the store actually
  // offers the box — a tampered payload may not subscribe a shopper who was
  // never shown it. Written to the customer record rather than left on the
  // cart snapshot, which is all it used to reach: a shopper who completed
  // the order lost the consent, and with abandoned tracking off nothing kept
  // it at all. See `recordCheckoutMarketingConsent` for why it never
  // unsubscribes.
  const marketingConsented =
    buyerAcceptsMarketing === true &&
    submission.checkout.contact.marketingOptIn.enabled;
  if (marketingConsented) {
    const { recordCheckoutMarketingConsent } = await import(
      "@/lib/customers/customer"
    );
    const doubleOptIn =
      submission.checkout.contact.marketingOptIn.doubleOptIn;
    const consent = await recordCheckoutMarketingConsent({
      accepted: true,
      // Where they were when they agreed — the country decides whether a
      // pre-ticked box was lawful, which is the first thing an audit asks.
      sourceCountry: normalizedShippingAddress?.country,
      doubleOptIn,
      userId: user?.id || (guestAccount ? String(guestAccount._id) : null),
      guestEmail: customerEmail,
    }).catch((err) => {
      console.error("Failed to record checkout marketing consent:", err);
      return null;
    });
    // Pending is not a subscriber: ask for the confirmation that makes it
    // one. Sent after the response, because it is an SMTP round trip and
    // the shopper is waiting on an order — the comment above used to claim
    // this and the `await` said otherwise, so a slow mail server delayed
    // every checkout and a failing one could lose the order to a timeout.
    const confirmationEmail = customerEmail;
    // Owed once, on the way INTO pending: a shopper already on the list is
    // left there (`setMarketingConsent`, rule 4), and one who is still
    // pending already holds a link that works — a declined card retried
    // three times must not send three of them.
    if (
      doubleOptIn &&
      confirmationEmail &&
      consent?.state === MARKETING_CONSENT_STATE.PENDING &&
      consent.previousState !== MARKETING_CONSENT_STATE.PENDING
    ) {
      afterResponse(async () => {
        const { sendMarketingConfirmationEmail } = await import(
          "@/lib/customers/marketing-confirmation"
        );
        await sendMarketingConfirmationEmail({
          email: confirmationEmail,
          settings,
          locale: activeLocale,
        });
      });
    }
  }

  // The same for "text me with news and offers", which is shown instead of
  // the email box when the shopper's contact is a number. The number is
  // resolved to E.164 here rather than taken from the browser, so a consent
  // is only ever recorded against something the store can actually text.
  if (
    smsAcceptsMarketing === true &&
    submission.checkout.contact.smsOptIn.enabled
  ) {
    const [{ recordCheckoutSmsConsent }, { normalizePhoneNumber }] =
      await Promise.all([
        import("@/lib/customers/customer"),
        import("@/lib/sms/phone"),
      ]);
    await recordCheckoutSmsConsent({
      accepted: true,
      userId:
        user?.id || (guestAccount ? String(guestAccount._id) : null),
      guestEmail: customerEmail,
      phone:
        normalizePhoneNumber(
          submission.contactPhone || normalizedShippingAddress?.phone,
          {
            country: normalizedShippingAddress?.country,
            defaultCountry:
              settings.sms?.defaultCountry ||
              settings.shipping?.origin?.country,
          },
        ) ?? null,
      sourceCountry: normalizedShippingAddress?.country,
    }).catch((err) =>
      console.error("Failed to record checkout SMS consent:", err),
    );
  }

  // Stripe's hosted page creates the order later, from the webhook, and only
  // the cart survives until then — so every method but cash on delivery waits
  // for this write before the shopper is sent to pay. A COD order is created
  // right here, and for it the snapshot is only the abandoned-checkout list's
  // record of the attempt: written while the stock moves and waited for just
  // before the answer — or, should the order fail first, finished after it.
  const snapshotWritten = (async () => {
    const cartDoc = await cartDocForSnapshot;
    if (!cartDoc) return;
    cartDoc.checkoutDetails = checkoutDetails;
    await updateCheckoutSnapshot(cartDoc, {
      trackAbandoned: submission.checkout.abandonedCheckouts.enabled,
      locale: activeLocale,
      email: customerEmail,
      phone: normalizedShippingAddress.phone,
      customerName: normalizedShippingAddress.fullName,
      customerLocale: activeLocale,
      buyerAcceptsMarketing: marketingConsented,
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
  })();
  const codSnapshotWritten =
    paymentMethod === "cod"
      ? snapshotWritten.catch((err) =>
          console.error("Failed to record the COD checkout snapshot:", err),
        )
      : undefined;
  if (codSnapshotWritten) afterResponse(() => codSnapshotWritten);
  else await snapshotWritten;

  // One use of a limited coupon, kept for this shopper while they pay. Every
  // branch below either takes a payment or commits the order, and each is
  // refused here, before any of that, when the coupon has no use to spare.
  // The card-testing verdict (read in parallel since the cart loaded), acted
  // on here: after the cart and the prices are settled and before the first
  // gateway call, so a paused checkout costs nobody a gateway request — and
  // so the answer is the same whichever payment method was chosen. See
  // `lib/checkout/card-testing-guard.ts` for why the pause follows the
  // session and the email rather than the address.
  const cardTesting = await cardTestingVerdict;

  if (cardTesting?.blocked) {
    throw new ValidationError({
      payment: [CARD_TESTING_BLOCKED_MESSAGE],
    });
  }

  if (cardTesting?.requireCaptcha) {
    const check = await verifyTurnstileToken({
      settings,
      token: turnstileToken,
      clientIp,
    });
    if (!check.ok) {
      throw new ValidationError({
        turnstile: [CARD_TESTING_CAPTCHA_MESSAGE],
      });
    }
  }

  // Everything a redirect-gateway order is written from. The same hash on a
  // retry from the same cart means the order already made can stand in for
  // a new one — see `lib/checkout/checkout-attempts.ts`.
  const attemptFingerprint = checkoutAttemptFingerprint({
    customerId,
    guestEmail,
    currency: settings.general?.defaultCurrency || "USD",
    items: items.map((item) => ({
      productId: item.productId._id,
      variantId: item.variantId,
      quantity: item.quantity,
      price: item.price,
      quoteId: item.quoteId,
      purchaseType: item.purchaseType,
      deposit: item.preorderDepositAmount,
      outstanding: item.preorderOutstandingAmount,
    })),
    subtotal,
    discount,
    shippingCost,
    tax,
    total,
    paymentDueNow,
    storeCredit: storeCreditApplied,
    coupon: appliedCoupon?.code,
    shippingAddress: normalizedShippingAddress,
    billingAddress: normalizedBillingAddress,
    shippingMethod: selectedShippingMethod,
    customs: customsEstimate,
    fulfillment: pickupFulfillment,
    checkoutDetails,
  });
  const attemptFields = {
    checkoutCartId: cart._id,
    checkoutFingerprint: attemptFingerprint,
  };

  const checkoutCouponHoldKey = couponHoldKey(customerId);
  if (appliedCoupon) {
    await holdCouponUse({
      couponId: appliedCoupon.couponId,
      holdKey: checkoutCouponHoldKey,
    });
  }

  // The shopper's store credit, held for this checkout until its payment
  // lands (R8) — one hold per cart, picked up again by a retry of the same
  // checkout. See `holdCheckoutCredit`.
  const orderStoreCredit =
    storeCreditApplied > 0 && user?.id
      ? {
          applied: storeCreditApplied,
          holdKey: (
            await holdCheckoutCredit({
              customerId: user.id,
              currency: settings.general?.defaultCurrency || "USD",
              amount: storeCreditApplied,
              cartId: cart._id,
              // Placing refused a request without one, above.
              method: paymentMethod!,
              fingerprint: attemptFingerprint,
            })
          ).holdKey,
          state: "held" as const,
        }
      : undefined;

  return {
    mode: "place" as const,
    ...priced,
    activeLocale,
    origin,
    checkoutUrl,
    codSnapshotWritten,
    attemptFingerprint,
    attemptFields,
    checkoutCouponHoldKey,
    orderStoreCredit,
  };
}

/** A checkout priced and nothing written: what a quote answers. */
export type PricedCheckout = Extract<Awaited<ReturnType<typeof runCheckout>>, { mode: "quote" }>;

/** A checkout priced and its shared writes done: what every way of paying takes. */
export type CheckoutDraft = Extract<Awaited<ReturnType<typeof runCheckout>>, { mode: "place" }>;
