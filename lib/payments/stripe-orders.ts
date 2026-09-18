import { Cart, Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import {
  fetchStripePaymentFee,
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
  stripeFeeFromIntent,
  toStripeAmount,
} from "@/lib/payments/stripe";
import { checkoutCartFingerprint } from "@/lib/checkout/checkout-cart-fingerprint";
import { isFreeShippingCouponType } from "@/lib/catalog/discounts";
import { preorderOutstandingAfterCoupon } from "@/lib/orders/preorder-coupon-split";
import { gatewayFeeUpdate } from "@/lib/payments/gateway-fee";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import {
  getPreorderReleaseDateForOrder,
  PREORDER_ITEM_STATUS,
  PURCHASE_TYPE,
  } from "@/lib/orders/preorders";
import { getNextOnlineOrderNumber } from "@/lib/orders/order-number";
import { CANONICAL_CART_WEIGHT_UNIT } from "@/lib/shipping/shipping";
import { DEFAULT_VENDOR_COMMISSION_RATE } from "@/lib/orders/order-settings";
import {
  systemActor,
} from "@/lib/orders/audit-order";
import {
  buildVendorSubOrders,
  getOrderItemVendorId,
  groupItemsByOrderVendor,
  resolveOrderVendorContext,
} from "@/lib/orders/order-vendors";
import {
  parseShippingMetadata,
  allocateSubOrderShipping,
} from "@/lib/checkout/checkout-shipping";
import {
  parsePickupFulfillmentMetadata,
  pickupVendorIdForCartItems,
  type PickupFulfillmentSnapshot,
} from "@/lib/checkout/checkout-pickup";
import type Stripe from "stripe";
import {
  buildOrderItemCustomsSnapshot,
  resolveItemShipping,
  type ProductShippingData,
  type VariantShippingData,
} from "@/lib/catalog/product-shipping";
import { resolveOrderItemCost } from "@/lib/products/item-cost";
import {
  settleCapturedOrder,
  type PendingOrderDocument,
} from "@/lib/payments/finalize-order";

type SettingsDocument = Awaited<ReturnType<typeof getSettings>>;

/** True when no line on the order needs physical shipping. */
function isDigitalOnlyOrder(
  items: Array<{
    productId: {
      shipping?: ProductShippingData;
      variants?: Array<
        { _id: { toString(): string } } & VariantShippingData
      >;
    };
    variantId?: unknown;
  }>,
): boolean {
  return !items.some(
    (item) =>
      resolveItemShipping({
        productShipping: item.productId.shipping,
        variantShipping: item.variantId
          ? item.productId.variants?.find(
              (candidate) =>
                candidate._id.toString() === String(item.variantId),
            )
          : undefined,
      }).requiresShipping,
  );
}

type StripeOrderShippingAddress = { fullName?: string } & Record<
  string,
  unknown
>;

type StripeOrderCartItem = {
  productId: {
    _id: string;
    name: string;
    sku?: string;
    images?: string[];
    vendorId: string | { _id: string };
    shipping?: ProductShippingData;
    variants?: Array<
      VariantShippingData & { _id: { toString: () => string } }
    >;
  };
  variantId?: string;
  quantity: number;
  price: number;
  /**
   * Set when the line was priced by a quote offer. The price it carries was
   * already re-read from that offer when the payment was quoted, so this is
   * only carried through to the order — it is not re-resolved here.
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
};

/**
 * A captured payment that no order could be built from, and whether it was
 * sent back. The success page reads it to tell the shopper where their money
 * went instead of waiting on an order that is never coming.
 */
export type StripePaymentRejection = { refunded: boolean };

type FinalizeStripeOrderResult = {
  created: boolean;
  orderId?: string;
  orderNumber?: string;
  rejected?: StripePaymentRejection;
};

function pickupSnapshotMatchesCurrentCart(
  fulfillment: PickupFulfillmentSnapshot,
  items: StripeOrderCartItem[],
) {
  const fulfillmentVendor = pickupVendorIdForCartItems(
    items.map((item) => {
      const variant = item.variantId
        ? item.productId.variants?.find(
            (candidate) => candidate._id.toString() === String(item.variantId),
          )
        : undefined;
      const shipping = resolveItemShipping({
        productShipping: item.productId.shipping,
        variantShipping: variant,
        quantity: item.quantity,
        targetWeightUnit: CANONICAL_CART_WEIGHT_UNIT,
      });
      return {
        vendorId: String(
          (item.productId.vendorId as { _id?: string })._id ||
            item.productId.vendorId,
        ),
        requiresShipping: shipping.requiresShipping,
      };
    }),
  );
  // A cart that no longer resolves to exactly one physical-item vendor cannot
  // match the snapshot the hold was taken against, whatever the reason.
  return (
    "vendorId" in fulfillmentVendor &&
    fulfillmentVendor.vendorId === fulfillment.pickup.vendorId
  );
}

/**
 * Anti-tampering guard for Stripe finalization. The order is rebuilt from the
 * CURRENT cart, but the amount charged was frozen in metadata when the
 * PaymentIntent/Checkout Session was created. If the live cart no longer sums to
 * the quoted subtotal, the cart was changed after payment was quoted and the
 * order must NOT be fulfilled (otherwise a $5 intent could ship a $2000 cart).
 */
function stripeCartMatchesQuote(
  items: Array<{ price?: number; quantity?: number }>,
  metadataSubtotal?: string,
): boolean {
  const computed = items.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  );
  const quoted = parseFloat(metadataSubtotal || "0");
  return Math.abs(computed - quoted) <= 0.01;
}

/**
 * The same guard for everything the subtotal cannot see: lines swapped for
 * others that add up to the same figure — see `checkoutCartFingerprint`.
 *
 * A payment quoted before the fingerprint existed carries none, and is left to
 * the subtotal check and, for a PaymentIntent, to {@link stripeChargeMatchesOrder}.
 */
function stripeCartMatchesFingerprint(
  items: StripeOrderCartItem[],
  metadataFingerprint?: string,
): boolean {
  if (!metadataFingerprint) return true;
  return checkoutCartFingerprint(items) === metadataFingerprint;
}

/**
 * A scoped coupon's discount by vendor, as the payment carried it. Anything
 * unreadable is treated as absent, which shares the discount by sales — the
 * behaviour an order had before the split was recorded at all.
 */
function parseCouponVendorShares(
  raw: string | undefined,
): Record<string, number> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const shares: Record<string, number> = {};
    for (const [vendorId, amount] of Object.entries(parsed)) {
      const value = Number(amount);
      if (Number.isFinite(value) && value >= 0) shares[vendorId] = value;
    }
    return shares;
  } catch {
    return undefined;
  }
}

/**
 * What each pre-order line leaves to be paid later, after the coupon — the
 * figure the order records and the one the intent charged the rest of. Worked
 * out from the same cart and the same coupon the intent was quoted from, so
 * the two cannot disagree. See `preorderOutstandingAfterCoupon`.
 */
function preorderOutstandingByLine(
  items: StripeOrderCartItem[],
  metadata: { discount?: string; couponType?: string; couponVendorShares?: string },
  currency: string,
): (item: StripeOrderCartItem) => number | undefined {
  const adjusted = preorderOutstandingAfterCoupon(
    items.map((item) => {
      const vendor = item.productId.vendorId;
      return {
        price: item.price,
        quantity: item.quantity,
        purchaseType: item.purchaseType,
        preorderOutstandingAmount: item.preorderOutstandingAmount,
        vendorId: vendor
          ? String(typeof vendor === "object" ? (vendor as { _id: unknown })._id : vendor)
          : null,
      };
    }),
    {
      goodsDiscount: isFreeShippingCouponType(metadata.couponType)
        ? 0
        : parseFloat(metadata.discount || "0") || 0,
      vendorShares: parseCouponVendorShares(metadata.couponVendorShares),
    },
    currency,
  );
  const byLine = new Map(items.map((item, index) => [item, adjusted[index]]));
  return (item) =>
    item.purchaseType === PURCHASE_TYPE.PREORDER
      ? (byLine.get(item) ?? item.preorderOutstandingAmount)
      : item.preorderOutstandingAmount;
}

/** What the pre-order lines leave to be paid later — the figure the order records. */
function preorderOutstandingOf(
  items: StripeOrderCartItem[],
  outstandingOf: (item: StripeOrderCartItem) => number | undefined,
): number {
  return items
    .filter((item) => item.purchaseType === PURCHASE_TYPE.PREORDER)
    .reduce((sum, item) => sum + Number(outstandingOf(item) || 0), 0);
}

/**
 * Did Stripe actually take what this order is about to say was paid?
 *
 * The order records `total` as the price and `preorderOutstandingAmount` as
 * still owed, and everything downstream reads the difference as money in.
 * Nothing compared that difference with the charge, so the order could record
 * a pre-order paid in full on a deposit's worth of card payment — or, the other
 * way round, a balance still owed on a charge that had already taken all of it,
 * which the balance flow would then take a second time.
 *
 * PaymentIntents only. A hosted Checkout Session charges line by line and
 * rounds each deposit per unit, so its total is not an exact mirror of the
 * order's; its cart is held to the fingerprint instead.
 */
function stripeChargeMatchesOrder(params: {
  amountReceived: number | null | undefined;
  chargedCurrency: string | null | undefined;
  total: number;
  outstanding: number;
  currency: string;
}): boolean {
  if (
    String(params.chargedCurrency || "").toLowerCase() !==
    params.currency.toLowerCase()
  ) {
    return false;
  }
  if (typeof params.amountReceived !== "number") return false;
  const dueNow = toStripeAmount(
    Math.max(0, params.total - params.outstanding),
    params.currency,
  );
  // One minor unit of slack for float residue; a real mismatch is a deposit.
  return Math.abs(params.amountReceived - dueNow) <= 1;
}

/**
 * Handle a captured payment whose quote no longer matches the live cart:
 * write a permanent do-not-fulfil marker for the PaymentIntent on the cart,
 * auto-refund the payment, and alert admins.
 *
 * The marker is written FIRST and the refund only issued if it persisted —
 * refunding without the marker would let the cart be edited back to the
 * quoted sum, at which point a later webhook/verify retry would happily
 * create an order for an already-REFUNDED payment. If the marker write
 * fails, the money simply stays captured for an admin to resolve (safe).
 */
async function rejectTamperedStripePayment(params: {
  paymentIntentId: string;
  cartId: string;
  settings: SettingsDocument;
  /** Why no order can be built; the default is the quote mismatch. */
  why?: string;
}): Promise<StripePaymentRejection> {
  const { paymentIntentId, cartId, settings } = params;
  const why = params.why ?? "the cart changed after checkout was quoted";
  console.error(
    `Stripe order rejected — ${why}:`,
    cartId,
    paymentIntentId,
  );

  let marked = false;
  if (paymentIntentId) {
    try {
      await Cart.updateOne(
        { _id: cartId },
        { $addToSet: { rejectedPaymentIntentIds: paymentIntentId } },
      );
      marked = true;
    } catch (err) {
      console.error("Failed to record rejected Stripe intent:", err);
    }
  }

  let refunded = false;
  if (marked) {
    try {
      const credentials = resolveStripeCredentials(settings.payment?.stripe);
      if (isStripeSecretKeyConfigured(credentials.secretKey)) {
        // Full refund (covers deposit-only pre-order charges too). The
        // idempotency key makes the webhook + /verify double-invocation safe.
        await getStripeForSecretKey(credentials.secretKey).refunds.create(
          {
            payment_intent: paymentIntentId,
            metadata: { reason: "cart_changed_after_quote", cartId },
          },
          { idempotencyKey: `tamper-refund-${paymentIntentId}` },
        );
        refunded = true;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/already been refunded|charge_already_refunded/i.test(message)) {
        refunded = true;
      } else {
        console.error("Failed to auto-refund rejected Stripe payment:", err);
      }
    }
  }
  const refundNote = refunded
    ? "auto-refunded in full"
    : "NOT auto-refunded — refund it manually from the Stripe dashboard";

  await import("@/lib/notifications/notifications")
    .then(({ notifyAdminsPaymentAnomaly }) =>
      notifyAdminsPaymentAnomaly({
        title: "Stripe payment rejected (cart mismatch)",
        message: `Stripe payment ${paymentIntentId || "(unknown intent)"} was captured, but ${why}. No order was created; the payment was ${refundNote}.`,
        paymentIntentId,
        cartId,
      }),
    )
    .catch((err) => console.error("Failed to send payment anomaly alert:", err));

  return { refunded };
}

/** True when this intent was previously tamper-rejected (and refunded). */
function isRejectedIntentForCart(
  cart: { rejectedPaymentIntentIds?: string[] },
  paymentIntentId: string,
): boolean {
  return Boolean(
    paymentIntentId &&
      (cart.rejectedPaymentIntentIds || []).includes(paymentIntentId),
  );
}

/**
 * Stripe's cut, read from the balance transaction behind the intent.
 *
 * Free when the caller already holds the intent with the fee expanded (/verify
 * retrieves it that way). Otherwise one API call: a webhook payload names the
 * charge by id only, and with async capture the balance transaction can still
 * be unset when the intent is read, so a missing fee is asked for again.
 * Best-effort by design: an order must never fail to be created because a
 * reporting figure was unavailable.
 */
async function resolveStripeFee(
  settings: SettingsDocument,
  source: StripeOrderSource,
) {
  const { paymentIntentId, intent } = source;
  if (!paymentIntentId) return undefined;
  try {
    const held = intent ? await stripeFeeFromIntent(intent) : undefined;
    if (held) return held;
    const credentials = resolveStripeCredentials(settings.payment?.stripe);
    if (!isStripeSecretKeyConfigured(credentials.secretKey)) return undefined;
    return await fetchStripePaymentFee(
      getStripeForSecretKey(credentials.secretKey),
      paymentIntentId,
    );
  } catch {
    return undefined;
  }
}

/**
 * The card Stripe kept, for a deposit that was confirmed with
 * `setup_future_usage`.
 *
 * Read off the intent when the caller already has it expanded, and fetched
 * otherwise — the id cannot come from metadata, because at the moment the
 * intent was created the shopper had not typed a card yet.
 *
 * Best-effort by design: this runs inside the webhook that turns a captured
 * payment into an order, and an order that exists without its saved card is a
 * balance the shopper pays by hand. An order that never got built because
 * Stripe was briefly unreachable is a payment with nothing to show for it.
 */
async function resolveSavedCard(
  settings: SettingsDocument,
  source: StripeOrderSource,
): Promise<{ paymentMethodId?: string; customerId?: string }> {
  const idOf = (value: unknown) =>
    typeof value === "string"
      ? value
      : (value as { id?: string } | null | undefined)?.id;

  // Both halves come off the same intent, because they are only useful as a
  // pair: Stripe charges a saved card off-session only when the Customer it
  // was saved against is named alongside it. A guest's Customer was minted for
  // their cart and is recorded nowhere else, so this read is the one chance to
  // keep it.
  const held = source.intent;
  if (held?.payment_method) {
    return {
      paymentMethodId: idOf(held.payment_method),
      customerId: idOf(held.customer),
    };
  }
  if (!source.paymentIntentId) return {};
  try {
    const credentials = resolveStripeCredentials(settings.payment?.stripe);
    if (!isStripeSecretKeyConfigured(credentials.secretKey)) return {};
    const intent = await getStripeForSecretKey(
      credentials.secretKey,
    ).paymentIntents.retrieve(source.paymentIntentId);
    return {
      paymentMethodId: idOf(intent.payment_method),
      customerId: idOf(intent.customer),
    };
  } catch (err) {
    console.error("Failed to read the card saved on a pre-order deposit:", err);
    return {};
  }
}

/**
 * Where a paid Stripe order comes from: a succeeded PaymentIntent (the
 * embedded checkout) or a completed Checkout Session (the hosted one). The
 * two carry the same quoted metadata; only their ids, the guest's email and
 * the columns they stamp on the order differ.
 */
type StripeOrderSource =
  | {
      kind: "payment_intent";
      paymentIntentId: string;
      metadata: Record<string, string | undefined>;
      /** Stripe's receipt email, falling back to the metadata's customerEmail. */
      guestEmail?: string;
      /** The intent itself, read for its fee when it was retrieved expanded. */
      intent?: Stripe.PaymentIntent;
    }
  | {
      kind: "checkout_session";
      sessionId: string;
      /** Empty when the session never produced an intent. */
      paymentIntentId: string;
      metadata: Record<string, string | undefined>;
      guestEmail?: string;
      /** The session's intent, when it was retrieved expanded. */
      intent?: Stripe.PaymentIntent;
    };

type StripeOrderCreation =
  | { created: true; order: PendingOrderDocument }
  | {
      created: false;
      orderId?: string;
      orderNumber?: string;
      rejected?: StripePaymentRejection;
    };

function stripeSourceLabel(source: StripeOrderSource) {
  return source.kind === "payment_intent" ? "payment intent" : "checkout session";
}

/** The column that makes a source idempotent: one order per intent, or per session. */
function stripeSourceKey(source: StripeOrderSource) {
  return source.kind === "payment_intent"
    ? { stripePaymentIntentId: source.paymentIntentId }
    : { stripeSessionId: source.sessionId };
}

/**
 * Idempotently create the order a Stripe payment was quoted for.
 *
 * Safe to call from both the Stripe webhook and the /verify polling endpoint:
 * it returns the existing order if one already exists and guards against
 * duplicate-key races. The order is rebuilt from the CURRENT cart, so the
 * anti-tampering checks refuse (and refund) a payment whose cart no longer
 * matches what was quoted.
 */
async function createStripeOrderFromCart(
  source: StripeOrderSource,
  settings: SettingsDocument,
): Promise<StripeOrderCreation> {
  const { metadata } = source;
  const {
    userId,
    cartId,
    shippingAddress: shippingAddressStr,
    billingAddress: billingAddressStr,
    subtotal,
    shipping,
    tax,
    discount,
    total,
    couponCode,
    couponType,
    couponValue,
    couponId,
    preorderMandate,
  } = metadata;
  const pickupFulfillment = parsePickupFulfillmentMetadata(
    metadata.pickupFulfillment,
  );
  const label = stripeSourceLabel(source);

  if (!userId || !cartId || !shippingAddressStr) {
    console.error(`Missing metadata in ${label}:`, source.paymentIntentId);
    return { created: false };
  }

  const existingOrder = await Order.findOne(stripeSourceKey(source)).lean();
  if (existingOrder) {
    return {
      created: false,
      orderId: String(existingOrder._id),
      orderNumber: existingOrder.orderNumber,
    };
  }

  let shippingAddress: StripeOrderShippingAddress;
  try {
    shippingAddress = JSON.parse(shippingAddressStr);
  } catch {
    console.error(`Failed to parse shipping address from ${label}`);
    return { created: false };
  }
  let billingAddress: StripeOrderShippingAddress = shippingAddress;
  if (billingAddressStr) {
    try {
      billingAddress = JSON.parse(billingAddressStr);
    } catch {
      billingAddress = shippingAddress;
    }
  }

  const cart = await Cart.findById(cartId)
    .populate({
      path: "items.productId",
      select: "name price images vendorId stock sku slug shipping variants",
      populate: { path: "vendorId", select: "_id" },
    })
    .lean();

  if (!cart || !cart.items || cart.items.length === 0) {
    // An empty cart is usually a race the call beside this one already won:
    // the webhook and /verify for one intent run together, and the winner
    // clears the cart only AFTER creating its order. So the order is looked
    // for again first, and only a payment with no order at all goes back.
    const raced = await Order.findOne(stripeSourceKey(source)).lean();
    if (raced) {
      return {
        created: false,
        orderId: String(raced._id),
        orderNumber: raced.orderNumber,
      };
    }
    // Otherwise the money has nothing to become: a second intent confirmed
    // for a cart the first already turned into an order, or a guest cart that
    // expired before the payment landed. Returning quietly left it captured,
    // and the webhook marked the event done, so nothing ever retried.
    const rejected = await rejectTamperedStripePayment({
      paymentIntentId: source.paymentIntentId,
      cartId,
      settings,
      why: cart
        ? "its cart had already been emptied, so there was nothing to build an order from"
        : "its cart no longer exists, so there was nothing to build an order from",
    });
    return { created: false, rejected };
  }

  const items = cart.items as StripeOrderCartItem[];
  const paymentIntentId = source.paymentIntentId;
  const outstandingOf = preorderOutstandingByLine(
    items,
    metadata,
    settings.general?.defaultCurrency || "USD",
  );

  // A previously tamper-rejected (and refunded) intent must never fulfil an
  // order, even if the cart has since been edited back to the quoted sum.
  // Re-run the rejection: every step is idempotent ($addToSet no-ops, the
  // refund has a fixed idempotency key, the alert dedupes per admin), and it
  // completes the refund if a crash landed between the marker write and the
  // refund on the first attempt.
  if (isRejectedIntentForCart(cart, paymentIntentId)) {
    console.error(
      "Refusing to fulfil previously rejected Stripe intent:",
      paymentIntentId,
    );
    const rejected = await rejectTamperedStripePayment({
      paymentIntentId,
      cartId: String(cart._id),
      settings,
    });
    return { created: false, rejected };
  }

  if (
    !stripeCartMatchesQuote(items, subtotal) ||
    !stripeCartMatchesFingerprint(items, metadata.cartFingerprint) ||
    (source.kind === "payment_intent" &&
      !stripeChargeMatchesOrder({
        amountReceived: source.intent?.amount_received,
        chargedCurrency: source.intent?.currency,
        total: parseFloat(total || "0"),
        outstanding: preorderOutstandingOf(items, outstandingOf),
        currency: settings.general?.defaultCurrency || "USD",
      }))
  ) {
    const rejected = await rejectTamperedStripePayment({
      paymentIntentId,
      cartId: String(cart._id),
      settings,
    });
    return { created: false, rejected };
  }
  if (
    pickupFulfillment &&
    !pickupSnapshotMatchesCurrentCart(pickupFulfillment, items)
  ) {
    const rejected = await rejectTamperedStripePayment({
      paymentIntentId,
      cartId: String(cart._id),
      settings,
    });
    return { created: false, rejected };
  }

  const orderNumber = await getNextOnlineOrderNumber(settings.orders?.prefix);

  const vendorContext = await resolveOrderVendorContext({
    isMultiVendorEnabled: Boolean(settings.multiVendorMode?.enabled),
  });
  const vendorGroups = groupItemsByOrderVendor(
    items,
    vendorContext,
    (item) => item.productId.vendorId,
  );
  const subOrders = await buildVendorSubOrders(vendorGroups, {
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
    getCustoms: (item) => buildOrderItemCustomsSnapshot({
      productShipping: item.productId.shipping,
      variantShipping: item.variantId
        ? item.productId.variants?.find(
            (candidate) => candidate._id.toString() === String(item.variantId),
          )
        : undefined,
    }),
    fallbackCommissionPercent:
      settings.orders?.commission?.vendorRate ?? DEFAULT_VENDOR_COMMISSION_RATE,
    couponDiscountByVendor: parseCouponVendorShares(metadata.couponVendorShares),
    // This order is only ever written once Stripe has taken the money, and it
    // is written `processing` — its consignments have to say the same, or the
    // first vendor to touch theirs re-derives the paid order back to `pending`.
    status: items.some((item) => item.purchaseType === PURCHASE_TYPE.PREORDER)
      ? ORDER_STATUS.PREORDERED
      : ORDER_STATUS.PROCESSING,
  });

  // Apply shipping captured at PaymentIntent/Checkout creation so the
  // Stripe-created order matches the other payment paths (per-vendor split,
  // selected method, duties).
  const parsedShipping = parseShippingMetadata(metadata);
  allocateSubOrderShipping(
    subOrders as Array<{
      vendorId: { toString: () => string };
      shippingCost?: number;
      shippingDiscount?: number;
      shippingMethod?: unknown;
    }>,
    {
      vendorShippingCosts: parsedShipping.vendorShippingCosts,
      orderShippingCost: parseFloat(shipping || "0"),
      orderShippingMethod: parsedShipping.shippingMethod,
      shippingDiscountByVendor: parseCouponVendorShares(
        metadata.couponShippingShares,
      ),
    },
  );
  if (pickupFulfillment) {
    const pickupSubOrder = subOrders.find(
      (subOrder) =>
        subOrder.vendorId.toString() === pickupFulfillment.pickup.vendorId,
    ) as (typeof subOrders)[number] & {
      fulfillment?: PickupFulfillmentSnapshot;
    };
    if (!pickupSubOrder) {
      console.error(`Pickup vendor is missing from Stripe ${label} order`);
      const rejected = await rejectTamperedStripePayment({
        paymentIntentId,
        cartId: String(cart._id),
        settings,
        why: "the pickup seller is no longer in the cart",
      });
      return { created: false, rejected };
    }
    pickupSubOrder.fulfillment = pickupFulfillment;
  }

  const hasPreorder = items.some(
    (item) => item.purchaseType === PURCHASE_TYPE.PREORDER,
  );
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
  const preorderOutstandingAmount = preorderOutstandingOf(items, outstandingOf);

  // Only looked up where a card was actually asked to be kept: an ordinary
  // sale, and a pre-order paid in full, never pay for the round trip.
  const savedCard =
    preorderOutstandingAmount > 0 && preorderMandate
      ? await resolveSavedCard(settings, source)
      : {};
  const savedPaymentMethodId = savedCard.paymentMethodId;

  try {
    const order = (await Order.create({
      customerId: userId,
      // A guest checkout stamps its cart id into the userId metadata — the one
      // signal that no User backs the order. Snapshot the email the guest paid
      // with so the public tracking/invoice lookups can match the order.
      guestEmail: userId === cartId ? source.guestEmail || undefined : undefined,
      orderNumber,
      currency: settings.general?.defaultCurrency || "USD",
      items: items.map((item) => ({
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
      fulfillment: pickupFulfillment,
      shippingAddress,
      billingAddress,
      digitalOnly: isDigitalOnlyOrder(items),
      paymentMethod: "card",
      paymentStatus:
        preorderOutstandingAmount > 0
          ? PAYMENT_STATUS.PARTIALLY_PAID
          : PAYMENT_STATUS.PAID,
      // Written once Stripe has the money, so the order's own creation is the
      // moment it arrived.
      paidAt: new Date(),
      ...(source.kind === "checkout_session"
        ? { stripeSessionId: source.sessionId }
        : {}),
      stripePaymentIntentId: paymentIntentId,
      paymentId: paymentIntentId,
      ...gatewayFeeUpdate(await resolveStripeFee(settings, source)),
      // "0" fallbacks: a missing metadata key would yield NaN, fail Order
      // validation, and put the webhook into a 500 retry loop.
      subtotal: parseFloat(subtotal || "0"),
      shippingCost: parseFloat(shipping || "0"),
      shippingMethod: parsedShipping.shippingMethod,
      customs: parsedShipping.customs,
      tax: parseFloat(tax || "0"),
      discount: parseFloat(discount || "0"),
      coupon:
        couponCode && couponCode.trim()
          ? {
              code: couponCode.trim().toUpperCase(),
              type: couponType || undefined,
              value: couponValue ? Number(couponValue) : undefined,
              couponId: couponId || undefined,
              // Who pays for the goods discount, as checkout resolved it. An
              // intent from before this was carried reads as the old rule:
              // the sellers whose items it discounted.
              fundedBy:
                metadata.couponFundedBy === "platform" ? "platform" : "vendor",
              usageIncremented: false,
            }
          : undefined,
      total: parseFloat(total || "0"),
      channel: "online",
      hasPreorder,
      preorderStatus: hasPreorder ? PREORDER_ITEM_STATUS.RESERVED : undefined,
      preorderReleaseDate,
      preorderAcknowledgedAt: hasPreorder ? new Date() : undefined,
      // The card-on-file agreement, carried on the intent's metadata because
      // that is the only thing that crosses from the checkout the shopper saw
      // to the webhook that builds their order. Stamped only where there is a
      // balance to authorise — a pre-order paid in full carries neither.
      ...(preorderOutstandingAmount > 0 && preorderMandate
        ? {
            preorderMandateAcceptedAt: new Date(),
            preorderMandateText: preorderMandate,
            ...(savedPaymentMethodId
              ? {
                  preorderSavedPaymentMethodId: savedPaymentMethodId,
                  ...(savedCard.customerId
                    ? { stripeCustomerId: savedCard.customerId }
                    : {}),
                }
              : {}),
          }
        : {}),
      preorderPaymentMode,
      preorderDepositAmount,
      preorderOutstandingAmount,
      status: hasPreorder ? ORDER_STATUS.PREORDERED : ORDER_STATUS.PROCESSING,
      // Stashed on the cart when the payment was quoted (the intent and
      // online-checkout routes); already validated against the checkout
      // settings there.
      customerNote: cart.checkoutDetails?.customerNote || undefined,
      contactPhone: cart.checkoutDetails?.contactPhone || undefined,
      checkoutFields: cart.checkoutDetails?.checkoutFields?.length
        ? cart.checkoutDetails.checkoutFields
        : undefined,
    })) as PendingOrderDocument;
    return { created: true, order };
  } catch (err: unknown) {
    // Concurrent webhook + verify race: another caller already created it.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: number }).code === 11000
    ) {
      const raced = await Order.findOne(stripeSourceKey(source)).lean();
      if (raced) {
        return {
          created: false,
          orderId: String(raced._id),
          orderNumber: raced.orderNumber,
        };
      }
    }
    throw err;
  }
}

/**
 * Settles an order Stripe created already paid: the placement and payment
 * are audited together, the quoted cart is closed, and the shopper hears
 * about it.
 */
async function settleStripeOrder(params: {
  creation: StripeOrderCreation;
  cartId: string | undefined;
  paymentId: string;
  recoveryMessage: string;
  customerEmail?: string;
  settings: SettingsDocument;
}): Promise<FinalizeStripeOrderResult> {
  const { creation } = params;
  if (!creation.created) return creation;
  const { order } = creation;

  const settled = await settleCapturedOrder({
    order,
    provider: { label: "Stripe", recoveryGateway: "stripe" },
    paymentId: params.paymentId,
    auditTransactionId: order.stripePaymentIntentId || null,
    // Stripe creates the order already paid, so both facts are recorded here.
    // The duplicate-key catch above means reaching this point implies THIS
    // call created the order — a replayed webhook returned early.
    recordPlacement: true,
    guestProfile: order.guestEmail
      ? { email: order.guestEmail, name: order.shippingAddress?.fullName }
      : undefined,
    settings: params.settings,
    actor: systemActor(),
    cart: { cartId: params.cartId },
    recoveryMessage: params.recoveryMessage,
    customerEmail: params.customerEmail,
  });

  if (!settled.ok) {
    return {
      created: false,
      orderId: String(order._id),
      orderNumber: order.orderNumber,
    };
  }

  console.log("Order created successfully:", order.orderNumber);

  return {
    created: true,
    orderId: String(order._id),
    orderNumber: order.orderNumber,
  };
}

/**
 * Idempotently create an order for a succeeded Stripe PaymentIntent.
 *
 * Safe to call from both the Stripe webhook and the /verify polling
 * endpoint: it returns the existing order if one already exists and
 * guards against duplicate-key races.
 */
export async function finalizeStripePaymentIntentOrder(
  paymentIntent: Stripe.PaymentIntent,
  settings: SettingsDocument,
): Promise<FinalizeStripeOrderResult> {
  const metadata = (paymentIntent.metadata || {}) as Record<
    string,
    string | undefined
  >;
  const email = paymentIntent.receipt_email || metadata.customerEmail || undefined;

  const creation = await createStripeOrderFromCart(
    {
      kind: "payment_intent",
      paymentIntentId: paymentIntent.id,
      metadata,
      guestEmail: email,
      intent: paymentIntent,
    },
    settings,
  );

  return settleStripeOrder({
    creation,
    cartId: metadata.cartId,
    paymentId: paymentIntent.id,
    recoveryMessage: "Stripe PaymentIntent succeeded",
    customerEmail: email,
    settings,
  });
}

/**
 * Idempotently create an order for a completed Stripe Checkout Session.
 */
export async function finalizeStripeCheckoutSessionOrder(
  session: Stripe.Checkout.Session,
  settings: SettingsDocument,
): Promise<FinalizeStripeOrderResult> {
  const { metadata } = session;

  if (!metadata) {
    console.error("No metadata in checkout session");
    return { created: false };
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || "";

  const creation = await createStripeOrderFromCart(
    {
      kind: "checkout_session",
      sessionId: session.id,
      paymentIntentId,
      intent:
        typeof session.payment_intent === "object"
          ? (session.payment_intent ?? undefined)
          : undefined,
      metadata,
      // Same guest rule as the payment-intent path: userId doubling as the
      // cart id means no User backs the order, so keep the guest's email.
      guestEmail:
        session.customer_email || session.customer_details?.email || undefined,
    },
    settings,
  );

  return settleStripeOrder({
    creation,
    cartId: metadata.cartId,
    paymentId: paymentIntentId || session.id,
    recoveryMessage: "Stripe Checkout completed",
    customerEmail: session.customer_email || undefined,
    settings,
  });
}
