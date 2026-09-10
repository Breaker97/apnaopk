import { Cart, Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import {
  fetchStripePaymentFee,
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
} from "@/lib/payments/stripe";
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
  purchaseType?: string;
  preorderReleaseDate?: Date;
  preorderMessage?: string;
  preorderPaymentMode?: "full" | "deposit" | "pay_later";
  preorderDepositAmount?: number;
  preorderOutstandingAmount?: number;
  preorderSupplierEta?: Date;
  preorderBatchName?: string;
};

type FinalizeStripeOrderResult = {
  created: boolean;
  orderId?: string;
  orderNumber?: string;
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
}): Promise<void> {
  const { paymentIntentId, cartId, settings } = params;
  console.error(
    "Stripe order rejected — cart changed after checkout was quoted:",
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

  let refundNote =
    "NOT auto-refunded — refund it manually from the Stripe dashboard";
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
        refundNote = "auto-refunded in full";
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/already been refunded|charge_already_refunded/i.test(message)) {
        refundNote = "auto-refunded in full";
      } else {
        console.error("Failed to auto-refund rejected Stripe payment:", err);
      }
    }
  }

  await import("@/lib/notifications/notifications")
    .then(({ notifyAdminsPaymentAnomaly }) =>
      notifyAdminsPaymentAnomaly({
        title: "Stripe payment rejected (cart mismatch)",
        message: `Stripe payment ${paymentIntentId || "(unknown intent)"} was captured, but the cart changed after checkout was quoted. No order was created; the payment was ${refundNote}.`,
        paymentIntentId,
        cartId,
      }),
    )
    .catch((err) => console.error("Failed to send payment anomaly alert:", err));
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
 * Best-effort by design: it costs one API call inside a webhook, and an order
 * must never fail to be created because a reporting figure was unavailable.
 */
async function resolveStripeFee(
  settings: SettingsDocument,
  paymentIntentId: string,
) {
  if (!paymentIntentId) return undefined;
  try {
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
    }
  | {
      kind: "checkout_session";
      sessionId: string;
      /** Empty when the session never produced an intent. */
      paymentIntentId: string;
      metadata: Record<string, string | undefined>;
      guestEmail?: string;
    };

type StripeOrderCreation =
  | { created: true; order: PendingOrderDocument }
  | { created: false; orderId?: string; orderNumber?: string };

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
    console.error("Cart not found or empty:", cartId);
    return { created: false };
  }

  const items = cart.items as StripeOrderCartItem[];
  const paymentIntentId = source.paymentIntentId;

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
    await rejectTamperedStripePayment({
      paymentIntentId,
      cartId: String(cart._id),
      settings,
    });
    return { created: false };
  }

  if (!stripeCartMatchesQuote(items, subtotal)) {
    await rejectTamperedStripePayment({
      paymentIntentId,
      cartId: String(cart._id),
      settings,
    });
    return { created: false };
  }
  if (
    pickupFulfillment &&
    !pickupSnapshotMatchesCurrentCart(pickupFulfillment, items)
  ) {
    await rejectTamperedStripePayment({
      paymentIntentId,
      cartId: String(cart._id),
      settings,
    });
    return { created: false };
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
    getPreorderOutstandingAmount: (item) => item.preorderOutstandingAmount,
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
    status: items.some((item) => item.purchaseType === PURCHASE_TYPE.PREORDER)
      ? ORDER_STATUS.PREORDERED
      : ORDER_STATUS.PENDING,
  });

  // Apply shipping captured at PaymentIntent/Checkout creation so the
  // Stripe-created order matches the other payment paths (per-vendor split,
  // selected method, duties).
  const parsedShipping = parseShippingMetadata(metadata);
  allocateSubOrderShipping(
    subOrders as Array<{
      vendorId: { toString: () => string };
      shippingCost?: number;
      shippingMethod?: unknown;
    }>,
    {
      vendorShippingCosts: parsedShipping.vendorShippingCosts,
      orderShippingCost: parseFloat(shipping || "0"),
      orderShippingMethod: parsedShipping.shippingMethod,
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
      return { created: false };
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
  const preorderOutstandingAmount = preorderItems.reduce(
    (sum, item) => sum + Number(item.preorderOutstandingAmount || 0),
    0,
  );

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
        preorderOutstandingAmount: item.preorderOutstandingAmount,
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
      ...(source.kind === "checkout_session"
        ? { stripeSessionId: source.sessionId }
        : {}),
      stripePaymentIntentId: paymentIntentId,
      paymentId: paymentIntentId,
      ...gatewayFeeUpdate(await resolveStripeFee(settings, paymentIntentId)),
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
              usageIncremented: false,
            }
          : undefined,
      total: parseFloat(total || "0"),
      channel: "online",
      hasPreorder,
      preorderStatus: hasPreorder ? PREORDER_ITEM_STATUS.RESERVED : undefined,
      preorderReleaseDate,
      preorderAcknowledgedAt: hasPreorder ? new Date() : undefined,
      preorderPaymentMode,
      preorderDepositAmount,
      preorderOutstandingAmount,
      status: hasPreorder ? ORDER_STATUS.PREORDERED : ORDER_STATUS.PROCESSING,
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
