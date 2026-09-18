/**
 * Everything a return is, worked out before anything is written.
 *
 * This used to live inside `POST /api/returns`, which meant the only way to
 * find out what a return was worth was to create one. So the shopper picked a
 * reason, submitted, and only then discovered the figure — even though the
 * reason they picked is exactly what moves it.
 *
 * Now the same planner answers both: `POST /api/returns/preview` calls it and
 * shows the breakdown, `POST /api/returns` calls it and creates from the
 * result. That sharing is the point. A preview computed a second way could
 * quote a number the real submission then disagrees with, which is worse than
 * quoting nothing at all.
 *
 * Deliberately NOT included here: the per-order lock, the return numbers, and
 * the writes. A preview must not take a lock other shoppers wait on, and it
 * must not burn a return number for a return that may never be submitted.
 */

import { Order, Product, ReturnRequest } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import { QUANTITY_CONSUMING_RETURN_STATUSES } from "@/lib/returns/returns";
import { isFreeShippingCouponType } from "@/lib/catalog/discounts";
import {
  DEFAULT_RETURN_WINDOW_DAYS,
  isMerchantFaultReturn,
  resolveReturnPolicy,
  shouldRefundReturnShipping,
  shouldRefundReturnShippingForFault,
  type ReturnPolicySettingsLike,
} from "@/lib/returns/return-policy";
import {
  buildReturnRefundEstimate,
  type ReturnRefundEstimate,
} from "@/lib/returns/return-estimate";
import { refundSettlesOutOfBand } from "@/lib/returns/refund-settlement";
import {
  isSubOrderPaid,
  SETTLED_ORDER_PAYMENT_STATUSES,
  type SubOrderPaymentShape,
} from "@/lib/orders/order-payment-status";
import { roundMoney } from "@/lib/intl/money";

type OrderItemLike = {
  productId: unknown;
  variantId?: unknown;
  vendorId: unknown;
  name?: string;
  sku?: string;
  price?: number;
  quantity?: number;
  image?: string;
};

/** The order fields the planner reads — loose, so a lean doc can be passed. */
interface ReturnPlanOrder {
  _id: unknown;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  channel?: string;
  deliveredAt?: Date;
  shippedAt?: Date;
  createdAt?: Date;
  items?: OrderItemLike[];
  subOrders?: Array<
    SubOrderPaymentShape & {
      vendorId?: unknown;
      subtotal?: number;
      couponDiscount?: number | null;
    }
  > | null;
  subtotal?: number;
  tax?: number;
  discount?: number;
  shippingCost?: number;
  coupon?: { type?: string } | null;
}

/** One returned line, shaped for `ReturnRequest.items`. */
interface ReturnPlanItem {
  productId: unknown;
  variantId?: unknown;
  vendorId: unknown;
  orderItemIndex: number;
  name: string;
  sku: string;
  quantityOrdered: number;
  quantityRequested: number;
  quantityApproved: number;
  quantityReceived: number;
  unitPrice: number;
  image?: string;
}

/**
 * One request-to-be. A return spanning two sellers becomes two of these,
 * because each seller receives, inspects and refunds their own parcel.
 */
interface ReturnPlanGroup {
  ownerType: "admin" | "vendor";
  ownerVendorId?: string;
  vendorIds: string[];
  items: ReturnPlanItem[];
  estimatedRefund: ReturnRefundEstimate;
}

interface ReturnPlan {
  groups: ReturnPlanGroup[];
  currency: string;
  /** Whether the reason puts this return on the merchant. */
  merchantAtFault: boolean;
  /** Whether the policy hands the original delivery back. */
  refundsShipping: boolean;
  /**
   * Whether no gateway can carry this refund, so somebody has to send the
   * money by hand and needs to be told where.
   *
   * Reported rather than enforced here: the shopper needs the figure BEFORE
   * they decide to hand over bank details, so a preview must still answer for
   * an order whose destination has not been filled in yet. The submission is
   * where it becomes a requirement.
   */
  settlesOutOfBand: boolean;
  /** What the shopper gets back across every group. */
  total: number;
}

type SelectedReturnItem = {
  requestItem: { orderItemIndex: number; quantity: number };
  orderItem: OrderItemLike;
  orderedQuantity: number;
  ownerType: "admin" | "vendor";
  ownerVendorId?: string;
};

function getDateBasis(order: ReturnPlanOrder) {
  return order.deliveredAt || order.shippedAt || order.createdAt || new Date();
}

/**
 * @param settings the store's settings, for the return window it has chosen.
 *   Omitted, the window is the 30 days it was hardcoded to — so a caller that
 *   has no settings to hand rejects exactly what it always rejected, rather
 *   than admitting everything.
 */
export function assertReturnEligible(
  order: ReturnPlanOrder,
  settings?: ReturnPolicySettingsLike | null,
) {
  if (order.status !== "delivered") {
    throw new ValidationError("Only delivered orders can be returned");
  }
  // `partially_paid` is admitted because a split order sits there while one
  // vendor's cash is still outstanding — the OTHER vendor's goods are paid for
  // and returnable. Which items that actually covers is enforced per item
  // below; this only rules out an order nobody has paid anything on.
  if (!SETTLED_ORDER_PAYMENT_STATUSES.includes(String(order.paymentStatus))) {
    throw new ValidationError("Only paid orders can be returned");
  }

  const windowDays = settings
    ? resolveReturnPolicy(settings).windowDays
    : DEFAULT_RETURN_WINDOW_DAYS;
  const basis = getDateBasis(order);
  const elapsedMs = Date.now() - new Date(basis).getTime();
  const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
  if (elapsedDays > windowDays) {
    throw new ValidationError(
      `The ${windowDays}-day return window has closed for this order`,
    );
  }
}

function buildRequestedByIndex(
  returns: Array<{ items?: Array<{ orderItemIndex?: number; quantityRequested?: number }> }>,
) {
  const map = new Map<number, number>();
  for (const request of returns) {
    for (const item of request.items || []) {
      const index = Number(item.orderItemIndex);
      map.set(index, (map.get(index) || 0) + Number(item.quantityRequested || 0));
    }
  }
  return map;
}

/**
 * Validate the selection and work out what each seller's parcel is worth.
 *
 * Throws `ValidationError` for anything the shopper can act on — an item that
 * is already spoken for, a consignment nobody has paid for yet. A preview
 * shows those messages in place of the figure, which is the same answer the
 * submission would have given, just sooner.
 */
export async function planReturnRequest(params: {
  order: ReturnPlanOrder;
  items: Array<{ orderItemIndex: number; quantity: number }>;
  reason: string;
  settings: ReturnPolicySettingsLike & {
    general?: { defaultCurrency?: string } | null;
  };
}): Promise<ReturnPlan> {
  const { order, reason, settings } = params;

  const existingOpenReturns = await ReturnRequest.find({
    orderId: order._id,
    status: { $in: QUANTITY_CONSUMING_RETURN_STATUSES },
  })
    .select("items")
    .lean();
  const alreadyRequestedByIndex = buildRequestedByIndex(existingOpenReturns);
  const orderItems = (order.items || []) as OrderItemLike[];
  const productIds = Array.from(
    new Set(
      params.items
        .map((requestItem) => String(orderItems[requestItem.orderItemIndex]?.productId || ""))
        .filter(Boolean),
    ),
  );
  const products = await Product.find({ _id: { $in: productIds } })
    .select("_id productSource vendorId")
    .lean();
  const productById = new Map(products.map((product) => [String(product._id), product]));

  // On a split order the per-item half of the payment gate: a consignment
  // whose cash never arrived has nothing to refund, so its items are not
  // returnable even though a sibling vendor's are.
  const isSplitOrder = (order.subOrders || []).length > 1;
  const settledVendorIds = new Set(
    (order.subOrders || [])
      .filter((subOrder) => isSubOrderPaid(order, subOrder))
      .map((subOrder) => String(subOrder.vendorId || "")),
  );

  const selectedItems: SelectedReturnItem[] = params.items.map((requestItem) => {
    const orderItem = orderItems[requestItem.orderItemIndex];
    if (!orderItem) {
      throw new ValidationError("Selected return item was not found on the order");
    }
    if (isSplitOrder && !settledVendorIds.has(String(orderItem.vendorId || ""))) {
      throw new ValidationError(
        `"${orderItem.name || "Item"}" has not been paid for yet and cannot be returned`,
      );
    }

    const orderedQuantity = Number(orderItem.quantity || 0);
    const alreadyRequested =
      alreadyRequestedByIndex.get(requestItem.orderItemIndex) || 0;
    const availableQuantity = orderedQuantity - alreadyRequested;
    if (requestItem.quantity > availableQuantity) {
      throw new ValidationError(
        `"${orderItem.name || "Item"}" only has ${Math.max(availableQuantity, 0)} returnable quantity left`,
      );
    }

    const product = productById.get(String(orderItem.productId));
    const ownerType = product?.productSource === "vendor" ? "vendor" : "admin";
    const ownerVendorId =
      ownerType === "vendor" ? String(product?.vendorId || orderItem.vendorId) : undefined;

    return { requestItem, orderItem, orderedQuantity, ownerType, ownerVendorId };
  });

  const subtotal = Number(order.subtotal || 0);
  const currency = settings.general?.defaultCurrency || "USD";
  const policy = resolveReturnPolicy(settings);

  // A free-shipping coupon discounts DELIVERY, not the goods — the same
  // distinction `decomposeOrder` draws for the ledger. Taken off the goods
  // here, it shrank the shopper's refund by the saving they had been given,
  // and it would now shrink the delivery refund the policy may hand back.
  const orderDiscount = Math.max(0, Number(order.discount || 0));
  const isShippingCoupon = isFreeShippingCouponType(order.coupon?.type);
  const goodsDiscount = isShippingCoupon ? 0 : orderDiscount;
  const ratedShipping = Math.max(0, Number(order.shippingCost || 0));
  // What delivery the shopper was actually charged, which is the most that
  // can come back to them.
  const chargedShipping = isShippingCoupon
    ? Math.max(0, ratedShipping - orderDiscount)
    : ratedShipping;
  const refundsShipping = shouldRefundReturnShipping(
    policy.shippingRefund,
    reason,
  );
  // Decided by the reason alone, never by the shipping mode: `always` is a
  // store choosing to hand delivery back, not a store agreeing that every
  // return is its own failure. See `isMerchantFaultReturn`.
  const merchantAtFault = isMerchantFaultReturn(reason);

  const groupedItems = new Map<string, SelectedReturnItem[]>();
  for (const item of selectedItems) {
    const key =
      item.ownerType === "vendor" ? `vendor:${item.ownerVendorId}` : "admin";
    if (!groupedItems.has(key)) groupedItems.set(key, []);
    groupedItems.get(key)!.push(item);
  }

  const groups: ReturnPlanGroup[] = [];
  for (const [key, groupItems] of groupedItems.entries()) {
    const ownerType = key.startsWith("vendor:") ? "vendor" : "admin";
    const ownerVendorId =
      ownerType === "vendor" ? key.slice("vendor:".length) : undefined;
    const itemsSubtotal = roundMoney(
      groupItems.reduce(
        (sum, item) =>
          sum + Number(item.orderItem.price || 0) * item.requestItem.quantity,
        0,
      ),
    );
    // Built per owner group rather than per request: a shopper returning items
    // to two different sellers ships two parcels back, and pays for two. A
    // single-seller return — the ordinary case — is charged once.
    const estimatedRefund = buildReturnRefundEstimate({
      itemsSubtotal,
      orderSubtotal: subtotal,
      orderTax: Number(order.tax || 0),
      goodsDiscount,
      ownGoodsDiscount: isShippingCoupon
        ? null
        : ownCouponDiscount(
            order,
            groupItems.map((item) => item.orderItem.vendorId),
          ),
      chargedShipping,
      refundsShipping,
      merchantAtFault,
      policy,
      currency,
    });

    groups.push({
      ownerType,
      ownerVendorId,
      vendorIds: Array.from(
        new Set(groupItems.map((item) => String(item.orderItem.vendorId))),
      ),
      items: groupItems.map(({ requestItem, orderItem, orderedQuantity }) => ({
        productId: orderItem.productId,
        variantId: orderItem.variantId,
        vendorId: orderItem.vendorId,
        orderItemIndex: requestItem.orderItemIndex,
        name: orderItem.name || "Item",
        sku: orderItem.sku || "",
        quantityOrdered: orderedQuantity,
        quantityRequested: requestItem.quantity,
        quantityApproved: requestItem.quantity,
        quantityReceived: 0,
        unitPrice: Number(orderItem.price || 0),
        image: orderItem.image,
      })),
      estimatedRefund,
    });
  }

  return {
    groups,
    currency,
    merchantAtFault,
    refundsShipping,
    settlesOutOfBand: refundSettlesOutOfBand(order),
    total: roundMoney(
      groups.reduce((sum, group) => sum + group.estimatedRefund.total, 0),
    ),
  };
}

/**
 * The estimate this return would have had, had the fault been known at the
 * time.
 *
 * Rebuilt from the same inputs `planReturnRequest` uses rather than adjusted in
 * place, so a reclassified return and a freshly-created one with the same facts
 * produce identical figures. Adjusting the stored breakdown instead — adding a
 * delivery line, zeroing a fee — would drift from the planner the moment either
 * changed.
 *
 * Goods value comes from `quantityApproved`, so a line the merchant approved
 * down to nothing contributes nothing.
 */
export function recomputeReturnEstimate(params: {
  items: Array<{
    vendorId?: unknown;
    unitPrice?: number | null;
    quantityApproved?: number | null;
    quantityRequested?: number | null;
  }>;
  order: ReturnPlanOrder;
  settings: ReturnPolicySettingsLike & {
    general?: { defaultCurrency?: string } | null;
  };
  merchantAtFault: boolean;
}): ReturnRefundEstimate {
  const { order, settings } = params;
  const policy = resolveReturnPolicy(settings);

  const itemsSubtotal = roundMoney(
    (params.items || []).reduce((sum, item) => {
      const quantity = Number(
        item?.quantityApproved ?? item?.quantityRequested ?? 0,
      );
      return sum + Number(item?.unitPrice || 0) * Math.max(0, quantity);
    }, 0),
  );

  const orderDiscount = Math.max(0, Number(order.discount || 0));
  const isShippingCoupon = isFreeShippingCouponType(order.coupon?.type);
  const ratedShipping = Math.max(0, Number(order.shippingCost || 0));

  return buildReturnRefundEstimate({
    itemsSubtotal,
    orderSubtotal: Number(order.subtotal || 0),
    orderTax: Number(order.tax || 0),
    goodsDiscount: isShippingCoupon ? 0 : orderDiscount,
    ownGoodsDiscount: isShippingCoupon
      ? null
      : ownCouponDiscount(
          params.order,
          (params.items || []).map((item) => item?.vendorId),
        ),
    chargedShipping: isShippingCoupon
      ? Math.max(0, ratedShipping - orderDiscount)
      : ratedShipping,
    refundsShipping: shouldRefundReturnShippingForFault(
      policy.shippingRefund,
      params.merchantAtFault,
    ),
    merchantAtFault: params.merchantAtFault,
    policy,
    currency: settings.general?.defaultCurrency || "USD",
  });
}

/** Load the order a shopper is returning from, or refuse. */
export async function loadReturnableOrder(params: {
  orderId: string;
  customerId: string;
}) {
  const order = await Order.findOne({
    _id: params.orderId,
    customerId: params.customerId,
  }).lean();
  if (!order) {
    throw new ValidationError("Order not found");
  }
  return order as unknown as ReturnPlanOrder & {
    orderNumber?: string;
    customerId?: unknown;
  };
}

/**
 * The returning seller's own slice of a scoped coupon, when the order recorded
 * whose coupon it was and every line coming back belongs to one consignment.
 * Null otherwise, which keeps the order-wide share.
 */
function ownCouponDiscount(
  order: ReturnPlanOrder,
  vendorIds: unknown[],
): { amount: number; subtotal: number } | null {
  const subOrders = order.subOrders || [];
  if (!subOrders.some((sub) => typeof sub.couponDiscount === "number")) {
    return null;
  }
  const vendors = new Set(vendorIds.map(String));
  if (vendors.size !== 1) return null;
  const [vendorId] = [...vendors];
  const sub = subOrders.find((candidate) => String(candidate.vendorId) === vendorId);
  if (!sub) return null;
  return {
    amount: Math.max(0, Number(sub.couponDiscount || 0)),
    subtotal: Math.max(0, Number(sub.subtotal || 0)),
  };
}
