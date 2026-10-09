import "server-only";
import { Cart } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import { getSettings } from "@/models/settings.model";
import { ORDER_STATUS } from "@/config/app.config";
import type { OrderCheckoutField } from "@/types";
import {
  getPreorderReleaseDateForOrder,
  PREORDER_ITEM_STATUS,
  PURCHASE_TYPE,
} from "@/lib/orders/preorders";
import { persistOrderFromDocument } from "@/lib/orders/persist-order";
import {
  couponVendorKey,
  remapVendorShares,
} from "@/lib/orders/coupon-line-split";
import { DEFAULT_VENDOR_COMMISSION_RATE } from "@/lib/orders/order-settings";
import { returnTermsForNewOrder } from "@/lib/returns/return-policy";
import { returnRuleCollections } from "@/lib/returns/final-sale-lines";
import {
  finalSaleCollectionIdsOf,
  isFinalSaleProduct,
} from "@/lib/returns/final-sale";
import {
  productReturnWindowDays,
  returnWindowOverridesOf,
} from "@/lib/returns/return-window";
import { resolveCouponLineDiscounts } from "@/lib/catalog/coupons";
import { allocateSubOrderShipping } from "@/lib/checkout/checkout-shipping";
import { isFreeShippingCouponType } from "@/lib/catalog/discounts";
import {
  preorderOutstandingAfterCoupon,
  type PreorderSplitLine,
} from "@/lib/orders/preorder-coupon-split";
import {
  buildVendorSubOrders,
  getOrderItemVendorId,
  groupItemsByOrderVendor,
  resolveOrderVendorContext,
  type SubOrderVendor,
} from "@/lib/orders/order-vendors";
import { resolveOrderItemCost } from "@/lib/products/item-cost";
import {
  buildOrderItemCustomsSnapshot,
  type ProductShippingData,
  type VariantShippingData,
} from "@/lib/catalog/product-shipping";
import type { PickupFulfillmentSnapshot } from "@/lib/checkout/checkout-pickup";
import { linkStoreCreditHold } from "@/lib/store-credit/store-credit";

/**
 * The order a checkout writes, as a value and as a write: the cart line it is
 * built from, the document every checkout path places (or a checkout attempt
 * stores until the money arrives), and the claim that keeps one cart from
 * being placed twice. Shared by the checkout's own branches
 * (app/api/payments/checkout/route.ts) and lib/checkout/place-cod-order.ts.
 */

export interface CheckoutCartItem {
  productId: {
    _id: string;
    name: string;
    price: number;
    images?: string[];
    vendorId: string | { _id: string };
    sku?: string;
    slug?: string;
    shipping?: ProductShippingData;
    variants?: Array<
      VariantShippingData & { _id: { toString: () => string }; finalSale?: boolean }
    >;
    /**
     * Read to mark the order line final sale — see lib/returns/final-sale.ts —
     * and to give it its own return window (lib/returns/return-window.ts).
     */
    returns?: { finalSale?: boolean; windowDays?: number | null };
    collectionIds?: unknown[];
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
export function preorderSplitLines(items: CheckoutCartItem[]): PreorderSplitLine[] {
  return items.map((item) => {
    const vendor = item.productId.vendorId;
    return {
      price: item.price,
      quantity: item.quantity,
      purchaseType: item.purchaseType,
      preorderOutstandingAmount: item.preorderOutstandingAmount,
      vendorId: vendor ? String(typeof vendor === "object" ? vendor._id : vendor) : null,
      productId: String(item.productId._id),
    };
  });
}

export type CheckoutShippingAddress = {
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
 * One order per cart on the paths that write the order before any gateway is
 * involved — cash on delivery, store credit, pay-later. Nothing is charged
 * there, so nothing stops a second click: a double submit placed the cart
 * twice, took its stock twice, and let both orders count the same store
 * credit hold. A claim left by a crashed request goes stale.
 */
export async function claimCartForOrder(cartId: unknown): Promise<() => Promise<void>> {
  const claimed = await Cart.findOneAndUpdate(
    {
      _id: cartId,
      "items.0": { $exists: true },
      $or: [
        { checkoutClaimedAt: null },
        { checkoutClaimedAt: { $exists: false } },
        { checkoutClaimedAt: { $lt: new Date(Date.now() - 30_000) } },
      ],
    },
    { $set: { checkoutClaimedAt: new Date() } },
  ).lean();
  if (!claimed) {
    throw new ValidationError("This order is already being placed. Please wait a moment.");
  }
  return () =>
    Cart.updateOne({ _id: cartId }, { $unset: { checkoutClaimedAt: "" } })
      .then(() => undefined)
      .catch((err) => console.error("Failed to release a checkout claim:", err));
}

/**
 * Everything the order IS, priced and agreed, with nothing written.
 *
 * Two callers want this: the paths that place an order straight away (cash on
 * delivery, pay-later, and every gateway not yet switched over), and the
 * checkout-attempt path, which stores the very same document on an attempt
 * while the shopper is away at the gateway and turns it into an order only
 * once the money has arrived.
 */
export async function buildOrderDocument(params: {
  customerId: string;
  /** Email the shopper entered at checkout — set only for guest orders. */
  guestEmail?: string;
  items: CheckoutCartItem[];
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
  /** Which cart this gateway attempt came from, and what it was for. */
  checkoutCartId?: unknown;
  checkoutFingerprint?: string;
  /** The gateway's payment page, kept so a retry can send the shopper back to it. */
  gatewayCheckoutUrl?: string;
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
    /** The products a scoped coupon applied to — see `preorderOutstandingAfterCoupon`. */
    eligibleProductIds?: string[];
    /** A free-shipping coupon's discount by the vendor whose delivery it paid. */
    shippingShares?: Record<string, number>;
    /** Who pays for the goods discount, frozen onto the order. */
    fundedBy?: "platform" | "vendor";
  };
  /** The coupon's use was already taken for this order (`takeCouponUse`). */
  couponUseTaken?: boolean;
  isMultiVendorEnabled: boolean;
  /** The consignments' vendor records, when the caller started the read. */
  subOrderVendors?: Promise<SubOrderVendor[]>;
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
  /** Store credit that pays part or all of the order, and its hold (R8). */
  storeCredit?: { applied: number; holdKey: string; state: "held" | "spent" };
  /** When an order written already paid was paid. */
  paidAt?: Date;
  /** The shopper app's scoped Idempotency-Key that placed it. */
  idempotencyKey?: string;
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
    checkoutCartId,
    checkoutFingerprint,
    gatewayCheckoutUrl,
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
      eligibleProductIds: coupon?.eligibleProductIds,
    },
    currency || "USD",
  );
  const outstandingByLine = new Map<CheckoutCartItem, number>(
    items.map((item, index) => [item, adjustedOutstanding[index] ?? 0]),
  );
  const outstandingOf = (item: CheckoutCartItem) =>
    item.purchaseType === PURCHASE_TYPE.PREORDER
      ? outstandingByLine.get(item) ?? item.preorderOutstandingAmount
      : item.preorderOutstandingAmount;

  // Each line's share of the coupon, so a return of one line gives back what
  // that line sold for — see `splitCouponAcrossLines`.
  const couponLineShares = await resolveCouponLineDiscounts({
    coupon,
    goodsDiscount: isFreeShippingCouponType(coupon?.type) ? 0 : discount,
    lines: items.map((item) => ({
      productId: String(item.productId._id),
      vendorId: couponVendorKey(item.productId.vendorId),
      price: item.price,
      quantity: item.quantity,
    })),
    currency: currency || "USD",
  });
  const couponShareByLine = new Map<CheckoutCartItem, number | undefined>(
    items.map((item, index) => [item, couponLineShares?.[index]]),
  );

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
  // The automated collections the return settings name, which a product joins
  // by their rules and never lists itself — read fresh for the order, and
  // alongside the consignments rather than before them. A store without such
  // a collection reads nothing.
  const ruleCollectionsRead = returnRuleCollections(
    items.map((item) => String(item.productId._id)),
    orderSettings,
  );
  ruleCollectionsRead.catch(() => undefined);
  const subOrders = await buildVendorSubOrders(vendorGroups, {
    vendors: params.subOrderVendors,
    codCollectedByDefault: orderSettings.shipping?.codCollectedBy,
    currency: orderSettings.general?.defaultCurrency || "USD",
    // Keyed by the consignments the order is split into — see
    // `remapVendorShares`.
    couponDiscountByVendor: remapVendorShares(
      params.coupon?.vendorShares,
      items.map((item) => ({
        from: couponVendorKey(item.productId.vendorId),
        to: getOrderItemVendorId(item.productId.vendorId, vendorContext),
      })),
      orderSettings.general?.defaultCurrency || "USD",
    ),
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
    getCouponDiscount: (item) => couponShareByLine.get(item),
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
    // The store's configured rate, as every other order path passes. Left out,
    // a vendor with no cached rate paid the built-in 10% here and the settings
    // rate at POS.
    fallbackCommissionPercent:
      orderSettings.orders?.commission?.vendorRate ??
      DEFAULT_VENDOR_COMMISSION_RATE,
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
      currency: currency || "USD",
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

  // Everything the order IS, as a value — no number on it yet, nothing
  // written. That separation is the whole point: the same document is what a
  // checkout attempt stores as its snapshot while the shopper is away at the
  // gateway, and what `createOrderFromAttempt` turns into an order once the
  // money has actually arrived.
  //
  // A gateway order's coupon use is counted on the capture/verify path, so an
  // abandoned payment doesn't burn one — the checkout holds it meanwhile. Cash
  // on delivery and pay-later took theirs before calling here, the order
  // itself being the commitment.
  const ruleCollections = await ruleCollectionsRead;
  const orderDocument = {
    customerId,
    guestEmail,
    currency: currency || "USD",
    items: items.map((item: CheckoutCartItem) => ({
      productId: item.productId._id,
      variantId: item.variantId,
      vendorId: getOrderItemVendorId(item.productId.vendorId, vendorContext),
      name: item.productId.name,
      sku: item.productId.sku || "",
      quantity: item.quantity,
      price: item.price,
        // As the shopper was shown it at checkout; an order made from this
        // attempt later keeps it.
        finalSale: isFinalSaleProduct(
          item.productId,
          item.variantId,
          finalSaleCollectionIdsOf(orderSettings),
          ruleCollections.get(String(item.productId._id)),
        ),
        // Its own return window, from its product or a collection (R6).
        returnWindowDays: productReturnWindowDays(
          item.productId,
          returnWindowOverridesOf(orderSettings),
          ruleCollections.get(String(item.productId._id)),
        ),
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
        couponDiscount: couponShareByLine.get(item),
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
    checkoutCartId,
    checkoutFingerprint,
    gatewayCheckoutUrl,
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
    // The return rules of the moment the shopper paid, which an order made
    // from a checkout attempt days later must keep.
    returnTerms: returnTermsForNewOrder(orderSettings),
    ...(params.storeCredit ? { storeCredit: params.storeCredit } : {}),
    ...(params.paidAt ? { paidAt: params.paidAt } : {}),
    ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
  };

  return orderDocument;
}

/**
 * Build the document and place the order — what every path that commits at
 * checkout does. The write and the three things placing an order always does
 * live in `lib/orders/persist-order.ts`, which a checkout attempt's promotion
 * calls with the very same document days later.
 */
export async function createOrder(
  params: Parameters<typeof buildOrderDocument>[0],
) {
  const order = await persistOrderFromDocument(await buildOrderDocument(params), {
    orderPrefix: params.orderPrefix,
  });
  // The credit's hold now belongs to this order, which decides what becomes
  // of it (R8).
  if (params.storeCredit?.holdKey) {
    await linkStoreCreditHold({
      holdKey: params.storeCredit.holdKey,
      orderId: String(order._id),
    }).catch((err) => console.error("Failed to tie a store credit hold to its order:", err));
  }
  return order;
}
