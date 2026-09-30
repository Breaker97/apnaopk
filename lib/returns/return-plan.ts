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

import { Types } from "mongoose";
import { Order, PaymentTransaction, Product, ReturnRequest, Vendor } from "@/models";
import { appConfig } from "@/config/app.config";
import { ValidationError } from "@/lib/api/errors";
import {
  QUANTITY_CONSUMING_RETURN_STATUSES,
  RETURN_ITEM_LISTED_TWICE,
  returnClaimedQuantity,
} from "@/lib/returns/returns";
import { isFreeShippingCouponType } from "@/lib/catalog/discounts";
import {
  isMerchantFaultReturn,
  resolveOrderReturnPolicy,
  resolveReturnFault,
  resolveReturnPolicy,
  shouldRefundReturnShipping,
  shouldRefundReturnShippingForFault,
  type ReturnPolicy,
  type ReturnPolicySettingsLike,
  type ReturnTermsLike,
} from "@/lib/returns/return-policy";
import {
  lineReturnWindowClosed,
  lineReturnWindowDays,
} from "@/lib/returns/return-window";
import {
  applyReturnOverrides,
  buildMarginalReturnRefundEstimate,
  type ReturnPriceOverrides,
  type ReturnRefundEstimate,
} from "@/lib/returns/return-estimate";
import {
  refundSettlesOutOfBand,
  resolveRefundPayer,
  type RefundPayer,
} from "@/lib/returns/refund-settlement";
import {
  getPreorderBalanceDue,
  isSubOrderPaid,
  SETTLED_ORDER_PAYMENT_STATUSES,
  type SubOrderPaymentShape,
} from "@/lib/orders/order-payment-status";
import { quantizeToCurrency, roundMoney } from "@/lib/intl/money";

type OrderItemLike = {
  productId: unknown;
  variantId?: unknown;
  vendorId: unknown;
  /** This line's own window, when it was sold with one — see return-window.ts. */
  returnWindowDays?: number | null;
  name?: string;
  sku?: string;
  price?: number;
  quantity?: number;
  image?: string;
  /** This line's recorded share of the coupon — see `returnedGoodsDiscount`. */
  couponDiscount?: number | null;
  /** A till markdown on this line alone (POS). */
  lineDiscount?: { amount?: number | null } | null;
  /** Sold as final sale — see lib/returns/final-sale.ts. */
  finalSale?: boolean | null;
};

/** The order fields the planner reads — loose, so a lean doc can be passed. */
interface ReturnPlanOrder {
  _id: unknown;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  channel?: string;
  currency?: string | null;
  deliveredAt?: Date;
  shippedAt?: Date;
  createdAt?: Date;
  items?: OrderItemLike[];
  subOrders?: Array<
    SubOrderPaymentShape & {
      vendorId?: unknown;
      status?: string | null;
      /** When this seller's parcel was handed over — its own return window. */
      deliveredAt?: Date | null;
      shippedAt?: Date | null;
      subtotal?: number;
      couponDiscount?: number | null;
      shippingCost?: number | null;
      shippingDiscount?: number | null;
    }
  > | null;
  subtotal?: number;
  tax?: number;
  discount?: number;
  shippingCost?: number;
  total?: number;
  coupon?: { type?: string } | null;
  /** A pre-order's balance, read to refuse a return while it is still owed. */
  preorderOutstandingAmount?: number | null;
  /** The return rules it was sold under — see `resolveOrderReturnPolicy`. */
  returnTerms?: ReturnTermsLike | null;
}

/**
 * The parts of the store's return policy that price a return, as they stood
 * when the shopper asked. Kept on the return so a fee the store adds later is
 * not charged on a return quoted without it — approving used to re-price
 * under whatever the settings said that day.
 */
type ReturnAppliedPolicy = Pick<
  ReturnPolicy,
  "shippingRefund" | "restockingFeePercent" | "returnShippingFee"
>;

/**
 * The policy a return is priced under: its own, where it kept one, and
 * otherwise the terms its order was sold under.
 */
function pricingPolicy(
  settings: ReturnPolicySettingsLike | null | undefined,
  applied: Partial<ReturnAppliedPolicy> | null | undefined,
  order: ReturnPlanOrder,
): ReturnPolicy {
  const current = resolveOrderReturnPolicy(order, settings);
  if (!applied) return current;
  return {
    ...current,
    ...(applied.shippingRefund ? { shippingRefund: applied.shippingRefund } : {}),
    ...(typeof applied.restockingFeePercent === "number"
      ? { restockingFeePercent: applied.restockingFeePercent }
      : {}),
    ...(typeof applied.returnShippingFee === "number"
      ? { returnShippingFee: applied.returnShippingFee }
      : {}),
  };
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
  /**
   * Whose money this parcel's refund comes out of. A vendor who delivered with
   * their own van took the shopper's cash at the door, so they are the one who
   * hands it back — the store never held it. See `resolveRefundPayer`.
   */
  refundPayer: RefundPayer;
  /** The policy this return was priced under — see `ReturnAppliedPolicy`. */
  policyApplied: ReturnAppliedPolicy;
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

/**
 * @param settings the store's settings, for the window of an order that
 *   predates stored terms (an order that has them keeps its own — see
 *   `resolveOrderReturnPolicy`).
 */
export function assertReturnEligible(
  order: ReturnPlanOrder,
  settings?: ReturnPolicySettingsLike | null,
  options: {
    /**
     * The store opening a return the rules refuse — past the window, or on a
     * final-sale line — having said why (`eligibilityOverride`). Everything
     * else still applies.
     */
    override?: boolean;
  } = {},
) {
  // A split order is returnable seller by seller: each consignment from its
  // own delivery, with its own window — see `planReturnRequest`. Asked of the
  // whole order, one seller's goods could not be returned until the slowest
  // seller had delivered, and then stayed returnable for as long again.
  const split = isSplitReturnOrder(order);
  const delivered = split
    ? (order.subOrders || []).some((sub) => sub?.status === "delivered")
    : order.status === "delivered";
  if (!delivered) {
    throw new ValidationError("Only delivered orders can be returned");
  }
  // `partially_paid` is admitted because a split order sits there while one
  // vendor's cash is still outstanding — the OTHER vendor's goods are paid for
  // and returnable. Which items that actually covers is enforced per item
  // below; this only rules out an order nobody has paid anything on.
  if (!SETTLED_ORDER_PAYMENT_STATUSES.includes(String(order.paymentStatus))) {
    throw new ValidationError("Only paid orders can be returned");
  }
  // A pre-order handed over before its balance was paid: the shopper was
  // quoted the full price for goods they had paid a deposit on, and the refund
  // screen refuses the order until it is paid in full anyway.
  if (getPreorderBalanceDue(order) > 0.005) {
    throw new ValidationError(
      "This order still has a balance to pay, so it cannot be returned yet. Contact the store.",
    );
  }
  if (split || options.override) return;

  // Closed for the order only once it has closed on every line: a line sold
  // with a longer window of its own is still returnable (R6), and the planner
  // holds each line to its own.
  const terms = resolveOrderReturnPolicy(order, settings);
  const lines = (order.items || []).map((_, index) => index);
  if (lines.length === 0) return;
  if (lines.every((index) => lineReturnWindowClosed(order, index, terms))) {
    const longest = Math.max(
      ...lines.map((index) => lineReturnWindowDays(order, index, terms) ?? 0),
    );
    throw new ValidationError(
      `The ${longest}-day return window has closed for this order`,
    );
  }
}

/**
 * Refuse a shopper asking for a return themselves when the store takes them
 * only through its team (`selfServe` off, R6). The store and its sellers
 * still open returns for them (R3), and the shopper still sees and cancels
 * the ones they have.
 */
export function assertReturnSelfServe(
  settings: ReturnPolicySettingsLike | null | undefined,
): void {
  if (!resolveReturnPolicy(settings).selfServe) {
    throw new ValidationError(
      "This store takes returns through its team. Contact the store to return an item.",
    );
  }
}

function isSplitReturnOrder(order: ReturnPlanOrder): boolean {
  return (order.subOrders || []).filter(Boolean).length > 1;
}

/**
 * The lines whose return window has closed — for the return form to leave
 * out, counted from the same day the planner counts from. The form offered
 * them anyway, and every preview of one came back refused.
 */
export function returnWindowClosedItemIndexes(
  order: ReturnPlanOrder,
  settings?: ReturnPolicySettingsLike | null,
): number[] {
  const terms = resolveOrderReturnPolicy(order, settings);
  return (order.items || []).flatMap((_, index) =>
    lineReturnWindowClosed(order, index, terms) ? [index] : [],
  );
}

type ClaimingReturn = {
  items?: Array<{
    orderItemIndex?: number;
    quantityRequested?: number;
    quantityApproved?: number;
  }>;
};

/** Units of each line the given returns hold — see `returnClaimedQuantity`. */
function buildRequestedByIndex(returns: ClaimingReturn[]) {
  const map = new Map<number, number>();
  for (const request of returns) {
    for (const item of request.items || []) {
      const index = Number(item.orderItemIndex);
      map.set(index, (map.get(index) || 0) + returnClaimedQuantity(item));
    }
  }
  return map;
}

/**
 * Units of each line returned or refunded before a return — the ones its
 * estimate is priced on top of, so the shares of tax, discount and delivery
 * add up to exactly what was charged (see `buildMarginalReturnRefundEstimate`).
 *
 * "Before" is by creation: a return re-priced later must stand on the same
 * ground it was quoted on, or two returns would each count the other as
 * earlier and their shares would stop adding up.
 */
export async function loadPriorReturnUnits(params: {
  orderId: unknown;
  /** The return being priced was created at this moment; omitted, all of it. */
  before?: Date | string | null;
  excludeReturnId?: unknown;
}): Promise<Map<number, number>> {
  const before = params.before ? new Date(params.before) : null;
  const returns = await ReturnRequest.find({
    orderId: params.orderId,
    status: { $in: QUANTITY_CONSUMING_RETURN_STATUSES },
    ...(params.excludeReturnId ? { _id: { $ne: params.excludeReturnId } } : {}),
    ...(before ? { createdAt: { $lt: before } } : {}),
  })
    .select("items.orderItemIndex items.quantityRequested items.quantityApproved")
    .lean<ClaimingReturn[]>();
  const prior = buildRequestedByIndex(returns || []);
  const refunded = await refundedQuantitiesByIndex(params.orderId, before);
  for (const [index, quantity] of refunded) {
    prior.set(index, (prior.get(index) || 0) + quantity);
  }
  return prior;
}

/**
 * Units of each line an order-level refund has already paid back.
 *
 * A return used to claim its quantity from other RETURNS and from nothing
 * else, so an item refunded from the order screen could be returned
 * afterwards and refunded all over again: the only other ceiling is the order
 * TOTAL, which a part-refunded order is nowhere near. On a 250 order the
 * shopper could be paid 100 for an item and then 115 more for sending the same
 * item back, and every guard in the refund path would agree.
 *
 * The lines an admin named are kept on the refund row as `metadata.refundedLines`
 * (see `PUT /api/admin/orders/[id]`), and only a row that still STANDS counts:
 * a refund the gateway later failed is marked `failed`, and its units become
 * returnable again — which is exactly right, because the shopper never got
 * that money.
 *
 * A refund nobody itemised says nothing about which goods it was for, so it
 * claims no units. That is the honest answer rather than a guess: the amount
 * is still held to the order's total by the refund cap.
 */
/**
 * Units of each line an OPEN (or already refunded) return has claimed.
 *
 * The mirror of `refundedQuantitiesByIndex`, for the other direction: the
 * order refund screen could pay for goods a return was already going to pay
 * for, and then the return paid for them too. Rejected and cancelled returns
 * release their units, which is why the status list is the same one the
 * planner counts against.
 */
export async function openReturnQuantitiesByIndex(orderId: unknown) {
  const returns = await ReturnRequest.find({
    orderId,
    status: { $in: QUANTITY_CONSUMING_RETURN_STATUSES },
  })
    .select("returnNumber items")
    .lean<
      Array<{
        returnNumber?: string;
        items?: Array<{
          orderItemIndex?: number;
          quantityRequested?: number;
          quantityApproved?: number;
        }>;
      }>
    >();

  const map = new Map<number, { quantity: number; returnNumber: string }>();
  for (const request of returns || []) {
    for (const item of request.items || []) {
      const index = Number(item?.orderItemIndex);
      const quantity = returnClaimedQuantity(item);
      if (!Number.isInteger(index) || index < 0 || quantity <= 0) continue;
      const seen = map.get(index);
      map.set(index, {
        quantity: (seen?.quantity || 0) + quantity,
        returnNumber: seen?.returnNumber || String(request.returnNumber || ""),
      });
    }
  }
  return map;
}

/**
 * Delivery already handed back by refunds that said so — what
 * `unrefundableDeliveryFor` takes off the delivery a dispatched order still
 * cannot refund. Left out, a delivery refunded once was deducted again: the
 * "Full refund" of a delivered order fell short by it, and the server refused
 * the whole figure unless the delivery was named a second time.
 */
export async function refundedDeliveryTotal(orderId: unknown): Promise<number> {
  const id = String(orderId || "");
  if (!Types.ObjectId.isValid(id)) return 0;
  const [row] = await PaymentTransaction.aggregate([
    {
      $match: {
        orderId: new Types.ObjectId(id),
        type: "refund",
        status: "succeeded",
      },
    },
    { $unwind: "$refundAllocation" },
    {
      $group: {
        _id: null,
        shipping: { $sum: { $ifNull: ["$refundAllocation.shipping", 0] } },
      },
    },
  ]);
  return Math.max(0, Number(row?.shipping || 0));
}

/**
 * The most delivery one return may hand back — what the "Refund delivery"
 * field of its refund reaches (R5a).
 *
 * What the shopper paid for the parcel this return's goods travelled in, less
 * what refunds other than this return's own have already handed back of it.
 * On an order that shipped as one parcel, the order's delivery. The charge,
 * not the rate: delivery a free-shipping coupon covered took no money.
 */
export async function returnDeliveryCeiling(params: {
  order: ReturnPlanOrder;
  returnRequest: {
    vendorIds?: unknown[] | null;
    items?: Array<{ vendorId?: unknown }> | null;
    actualRefund?: {
      paymentTransactionId?: unknown;
      paymentTransactionIds?: unknown[] | null;
    } | null;
  };
}): Promise<number> {
  const { order, returnRequest } = params;
  const currency = String(order.currency || "USD");
  const vendorIds = new Set(
    [
      ...(returnRequest.vendorIds || []),
      ...(returnRequest.items || []).map((item) => item?.vendorId),
    ]
      .map((id) => String(id || ""))
      .filter(Boolean),
  );
  const orderDiscount = Math.max(0, Number(order.discount || 0));
  const freeShipping = isFreeShippingCouponType(order.coupon?.type);
  const ratedShipping = Math.max(0, Number(order.shippingCost || 0));
  const orderCharged = freeShipping
    ? Math.max(0, ratedShipping - orderDiscount)
    : ratedShipping;

  const split = isSplitReturnOrder(order);
  let charged = orderCharged;
  if (split) {
    charged = 0;
    for (const sub of order.subOrders || []) {
      if (!vendorIds.has(String(sub?.vendorId || ""))) continue;
      const rated = Math.max(0, Number(sub.shippingCost || 0));
      if (typeof sub.shippingDiscount === "number") {
        charged += Math.max(0, rated - Math.max(0, sub.shippingDiscount));
      } else if (freeShipping) {
        // The coupon was not recorded parcel by parcel: its share of what the
        // shopper paid, by what each parcel was rated at.
        charged += ratedShipping > 0 ? (orderCharged * rated) / ratedShipping : 0;
      } else {
        charged += rated;
      }
    }
  }

  const ownRows = [
    ...(returnRequest.actualRefund?.paymentTransactionIds || []),
    returnRequest.actualRefund?.paymentTransactionId,
  ]
    .map((id) => String(id || ""))
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
  const orderId = String(order._id || "");
  if (!Types.ObjectId.isValid(orderId)) return quantizeToCurrency(charged, currency);
  const rows = await PaymentTransaction.aggregate<{ _id: unknown; shipping: number }>([
    {
      $match: {
        orderId: new Types.ObjectId(orderId),
        type: "refund",
        status: "succeeded",
        ...(ownRows.length > 0 ? { _id: { $nin: ownRows } } : {}),
      },
    },
    { $unwind: "$refundAllocation" },
    {
      $group: {
        _id: "$refundAllocation.vendorId",
        shipping: { $sum: { $ifNull: ["$refundAllocation.shipping", 0] } },
      },
    },
  ]);
  const refundedByOthers = rows
    .filter((row) => !split || vendorIds.has(String(row._id || "")))
    .reduce((sum, row) => sum + Math.max(0, Number(row.shipping || 0)), 0);
  return quantizeToCurrency(Math.max(0, charged - refundedByOthers), currency);
}

export async function refundedQuantitiesByIndex(
  orderId: unknown,
  /** Only refunds made before this moment. */
  before?: Date | null,
) {
  const rows = await PaymentTransaction.find({
    orderId,
    type: "refund",
    status: "succeeded",
    "metadata.refundedLines.0": { $exists: true },
    ...(before ? { createdAt: { $lt: before } } : {}),
  })
    .select("metadata.refundedLines")
    .lean<
      Array<{
        metadata?: {
          refundedLines?: Array<{ orderItemIndex?: number; quantity?: number }>;
        };
      }>
    >();

  const map = new Map<number, number>();
  for (const row of rows || []) {
    for (const line of row?.metadata?.refundedLines || []) {
      const index = Number(line?.orderItemIndex);
      const quantity = Math.max(0, Number(line?.quantity || 0));
      if (!Number.isInteger(index) || index < 0 || quantity <= 0) continue;
      map.set(index, (map.get(index) || 0) + quantity);
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
  /**
   * See `assertReturnEligible`: the store opening it past the window, or on a
   * final-sale line.
   */
  override?: boolean;
}): Promise<ReturnPlan> {
  const { order, reason, settings } = params;

  // One entry per order line. The quantity check below weighs each entry
  // against what OTHER returns have claimed, so the same line listed twice
  // passed it twice: one kettle sent back, priced as two, and with the ratio
  // capped at the whole order, a single unit could carry every line's tax and
  // delivery with it.
  const listed = new Set<number>();
  for (const requestItem of params.items) {
    if (listed.has(requestItem.orderItemIndex)) {
      throw new ValidationError(RETURN_ITEM_LISTED_TWICE);
    }
    listed.add(requestItem.orderItemIndex);
  }

  const existingOpenReturns = await ReturnRequest.find({
    orderId: order._id,
    status: { $in: QUANTITY_CONSUMING_RETURN_STATUSES },
  })
    .select("items")
    .lean();
  const alreadyRequestedByIndex = buildRequestedByIndex(existingOpenReturns);
  const alreadyRefundedByIndex = await refundedQuantitiesByIndex(order._id);
  const orderItems = (order.items || []) as OrderItemLike[];
  const productIds = Array.from(
    new Set(
      params.items
        .map((requestItem) => String(orderItems[requestItem.orderItemIndex]?.productId || ""))
        .filter(Boolean),
    ),
  );
  const products = await Product.find({ _id: { $in: productIds } })
    .select(
      "_id productSource vendorId shipping.isPhysicalProduct variants._id variants.requiresShipping",
    )
    .lean();
  const productById = new Map(products.map((product) => [String(product._id), product]));

  // The store's own vendor records among the sellers on these lines — see
  // below. Asked of the sellers named on the order, not of the products.
  const lineVendorIds = Array.from(
    new Set(
      params.items
        .map((requestItem) => String(orderItems[requestItem.orderItemIndex]?.vendorId || ""))
        .filter(Boolean),
    ),
  );
  const houseVendorIds = new Set(
    lineVendorIds.length > 0
      ? (
          await Vendor.find({ _id: { $in: lineVendorIds } })
            .select("_id isDefault slug")
            .lean<Array<{ _id: unknown; isDefault?: boolean; slug?: string }>>()
        )
          .filter(
            (vendor) =>
              vendor.isDefault === true ||
              String(vendor.slug || "").toLowerCase() === appConfig.defaultVendorSlug,
          )
          .map((vendor) => String(vendor._id))
      : [],
  );

  // On a split order the per-item half of the payment gate: a consignment
  // whose cash never arrived has nothing to refund, so its items are not
  // returnable even though a sibling vendor's are.
  const isSplitOrder = (order.subOrders || []).length > 1;
  const settledVendorIds = new Set(
    (order.subOrders || [])
      .filter((subOrder) => isSubOrderPaid(order, subOrder))
      .map((subOrder) => String(subOrder.vendorId || "")),
  );

  // A called-off consignment was refunded and restocked when it was
  // cancelled. Its sub-order still reads paid, so without this its items could
  // be returned and refunded a second time.
  const cancelledVendorIds = new Set(
    (order.subOrders || [])
      .filter((subOrder) => subOrder?.status === "cancelled")
      .map((subOrder) => String(subOrder.vendorId || "")),
  );

  // The window the order was sold with, and when it starts counting.
  const windowTerms = resolveOrderReturnPolicy(order, settings);

  const selectedItems: SelectedReturnItem[] = params.items.map((requestItem) => {
    const orderItem = orderItems[requestItem.orderItemIndex];
    if (!orderItem) {
      throw new ValidationError("Selected return item was not found on the order");
    }
    if (cancelledVendorIds.has(String(orderItem.vendorId || ""))) {
      throw new ValidationError(
        `"${orderItem.name || "Item"}" was cancelled and refunded, so it cannot be returned`,
      );
    }
    if (isSplitOrder && !settledVendorIds.has(String(orderItem.vendorId || ""))) {
      throw new ValidationError(
        `"${orderItem.name || "Item"}" has not been paid for yet and cannot be returned`,
      );
    }
    // On a split order each seller's goods are returnable once their own
    // parcel has arrived.
    if (isSplitOrder) {
      const consignment = (order.subOrders || []).find(
        (sub) => String(sub?.vendorId || "") === String(orderItem.vendorId || ""),
      );
      if (consignment?.status !== "delivered") {
        throw new ValidationError(
          `"${orderItem.name || "Item"}" has not been delivered yet, so it cannot be returned`,
        );
      }
    }
    // Each line for its own window: the order's, or the one its product or a
    // collection gave it (R6), counted from its own parcel or the order's last.
    if (
      !params.override &&
      lineReturnWindowClosed(order, requestItem.orderItemIndex, windowTerms)
    ) {
      throw new ValidationError(
        `The ${lineReturnWindowDays(order, requestItem.orderItemIndex, windowTerms)}-day return window has closed for "${orderItem.name || "Item"}"`,
      );
    }

    // Digital goods do not come back: there is nothing to post, and a file
    // once downloaded cannot be taken back. The store refunds one from the
    // order screen if something is wrong with it, which closes its downloads.
    if (
      isDigitalLine(productById.get(String(orderItem.productId)), orderItem.variantId)
    ) {
      throw new ValidationError(
        `"${orderItem.name || "Item"}" is a digital item and cannot be returned. Contact the store if something is wrong with it.`,
      );
    }

    // Sold as final sale — read off the line, as it was sold. Only the store
    // opens one anyway, having said why.
    if (orderItem.finalSale === true && !params.override) {
      throw new ValidationError(
        `"${orderItem.name || "Item"}" was sold as final sale and cannot be returned. Contact the store if something is wrong with it.`,
      );
    }

    const orderedQuantity = Number(orderItem.quantity || 0);
    const alreadyRequested =
      alreadyRequestedByIndex.get(requestItem.orderItemIndex) || 0;
    // Units the shopper has already been paid for from the order refund
    // screen. They are gone in exactly the sense an open return's units are
    // gone — see `refundedQuantitiesByIndex`.
    const alreadyRefunded =
      alreadyRefundedByIndex.get(requestItem.orderItemIndex) || 0;
    const availableQuantity = orderedQuantity - alreadyRequested - alreadyRefunded;
    if (requestItem.quantity > availableQuantity) {
      throw new ValidationError(
        availableQuantity <= 0 && alreadyRefunded > 0
          ? `"${orderItem.name || "Item"}" has already been refunded on this order, so it cannot be returned`
          : `"${orderItem.name || "Item"}" only has ${Math.max(availableQuantity, 0)} returnable quantity left`,
      );
    }

    // Whose goods these were when they were SOLD: the seller the order line
    // names, not the product as it stands today. Read off the live product, a
    // listing deleted since sent its return to the store with the store as the
    // payer — though a seller's own van had taken the cash — and one moved to
    // another seller sent it to the wrong seller's queue. The product only
    // answers for an old line that names no seller.
    const product = productById.get(String(orderItem.productId));
    const saleVendorId = String(orderItem.vendorId || "");
    const ownerType = saleVendorId
      ? houseVendorIds.has(saleVendorId)
        ? "admin"
        : "vendor"
      : product?.productSource === "vendor"
        ? "vendor"
        : "admin";
    const ownerVendorId =
      ownerType === "vendor"
        ? saleVendorId || String(product?.vendorId || "")
        : undefined;

    return { requestItem, orderItem, orderedQuantity, ownerType, ownerVendorId };
  });

  // The order's own currency: the store default may have changed since.
  const currency = order.currency || settings.general?.defaultCurrency || "USD";
  // The terms the order was sold under, not today's: a restocking fee the
  // store added since is not one this shopper agreed to.
  const policy = resolveOrderReturnPolicy(order, settings);

  // What earlier returns and order-screen refunds already took, which this
  // return's shares are priced on top of — see `loadPriorReturnUnits`. Grown
  // group by group below, so two sellers' parcels in one request stack too.
  const priorByIndex = new Map<number, number>(alreadyRequestedByIndex);
  for (const [index, quantity] of alreadyRefundedByIndex) {
    priorByIndex.set(index, (priorByIndex.get(index) || 0) + quantity);
  }

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
    const groupUnits: ReturningUnits[] = groupItems.map(({ requestItem, orderItem }) => ({
      orderItemIndex: requestItem.orderItemIndex,
      quantity: requestItem.quantity,
      vendorId: orderItem.vendorId,
      value: Number(orderItem.price || 0) * requestItem.quantity,
    }));
    // Built per owner group rather than per request: a shopper returning items
    // to two different sellers ships two parcels back, and pays for two. A
    // single-seller return — the ordinary case — is charged once.
    const estimatedRefund = estimateReturnedUnits({
      order,
      units: groupUnits,
      prior: unitsOnLines(order, priorByIndex),
      refundsShipping,
      merchantAtFault,
      policy,
      currency,
    });
    for (const unit of groupUnits) {
      const index = Number(unit.orderItemIndex);
      priorByIndex.set(index, (priorByIndex.get(index) || 0) + unit.quantity);
    }

    groups.push({
      ownerType,
      ownerVendorId,
      // Asked of the consignment these goods were sold on, which is where
      // custody is recorded — one seller's van and another's platform courier
      // can sit on the same order.
      //
      // Only ever asked for a SELLER's goods. The store's own stock is sold
      // through a vendor record of its own, and a cash sale of it is the
      // shopkeeper's own till: asking this of it answered "vendor" and told
      // the store that some seller owed the refund, which on its own goods is
      // itself.
      refundPayer: resolveRefundPayer({
        order: order as Parameters<typeof resolveRefundPayer>[0]["order"],
        vendorId: ownerType === "vendor" ? ownerVendorId : undefined,
      }),
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
      policyApplied: {
        shippingRefund: policy.shippingRefund,
        restockingFeePercent: policy.restockingFeePercent,
        returnShippingFee: policy.returnShippingFee,
      },
    });
  }

  return {
    groups,
    currency,
    merchantAtFault,
    refundsShipping,
    settlesOutOfBand: refundSettlesOutOfBand(order),
    total: quantizeToCurrency(
      groups.reduce((sum, group) => sum + group.estimatedRefund.total, 0),
      currency,
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
    orderItemIndex?: number | null;
    unitPrice?: number | null;
    quantityApproved?: number | null;
    quantityRequested?: number | null;
  }>;
  order: ReturnPlanOrder;
  settings: ReturnPolicySettingsLike & {
    general?: { defaultCurrency?: string } | null;
  };
  merchantAtFault: boolean;
  /** The policy the return was quoted under, when it kept one. */
  policyApplied?: Partial<ReturnAppliedPolicy> | null;
  /**
   * Units returned or refunded before this return — see
   * `loadPriorReturnUnits`. Omitted, the return is priced as if it were the
   * only one, which is how every return was priced before.
   */
  priorUnitsByIndex?: ReadonlyMap<number, number> | null;
  /**
   * The fees and delivery the store set on this return by hand — see
   * `ReturnPriceOverrides`. Re-applied on every re-pricing, so a count or a
   * change of what was approved never quietly puts a waived fee back.
   */
  overrides?: ReturnPriceOverrides | null;
}): ReturnRefundEstimate {
  const { order, settings } = params;
  const policy = pricingPolicy(settings, params.policyApplied, order);

  const units: ReturningUnits[] = (params.items || []).map((item) => {
    const quantity = Math.max(
      0,
      Number(item?.quantityApproved ?? item?.quantityRequested ?? 0),
    );
    return {
      orderItemIndex: item?.orderItemIndex,
      quantity,
      vendorId: item?.vendorId,
      value: Number(item?.unitPrice || 0) * quantity,
    };
  });

  return applyReturnOverrides(
    estimateReturnedUnits({
      order,
      units,
      prior: params.priorUnitsByIndex
        ? unitsOnLines(order, params.priorUnitsByIndex)
        : null,
      refundsShipping: shouldRefundReturnShippingForFault(
        policy.shippingRefund,
        params.merchantAtFault,
      ),
      merchantAtFault: params.merchantAtFault,
      policy,
      currency: order.currency || settings.general?.defaultCurrency || "USD",
    }),
    params.overrides,
  );
}

/** The given units of each order line, priced as that line sold. */
function unitsOnLines(
  order: ReturnPlanOrder,
  byIndex: ReadonlyMap<number, number>,
): ReturningUnits[] {
  const lines = order.items || [];
  const units: ReturningUnits[] = [];
  for (const [index, quantity] of byIndex) {
    const line = lines[index];
    const count = Math.max(0, Number(quantity) || 0);
    if (!line || count <= 0) continue;
    units.push({
      orderItemIndex: index,
      quantity: count,
      vendorId: line.vendorId,
      value: Number(line.price || 0) * count,
    });
  }
  return units;
}

/**
 * What these units are worth back, on top of `prior` — the one place the
 * planner and every re-pricing turn units into an estimate.
 *
 * A free-shipping coupon discounts DELIVERY, not the goods — the same
 * distinction `decomposeOrder` draws for the ledger. Taken off the goods, it
 * shrank the shopper's refund by the saving they had been given.
 */
function estimateReturnedUnits(params: {
  order: ReturnPlanOrder;
  units: ReturningUnits[];
  prior?: ReturningUnits[] | null;
  refundsShipping: boolean;
  merchantAtFault: boolean;
  policy: ReturnPolicy;
  currency: string;
}): ReturnRefundEstimate {
  const { order, currency } = params;
  const orderDiscount = Math.max(0, Number(order.discount || 0));
  const isShippingCoupon = isFreeShippingCouponType(order.coupon?.type);
  const goodsDiscount = isShippingCoupon ? 0 : orderDiscount;
  const ratedShipping = Math.max(0, Number(order.shippingCost || 0));
  // What delivery the shopper was actually charged, which is the most that
  // can come back to them.
  const chargedShipping = isShippingCoupon
    ? Math.max(0, ratedShipping - orderDiscount)
    : ratedShipping;
  // Delivery a split order booked per parcel comes back per parcel — the
  // parcel THIS return's goods travelled in, whatever earlier returns took.
  const unitVendorIds = params.units.map((unit) => String(unit.vendorId || ""));
  const shippingBasis = consignmentShippingBasis(order, unitVendorIds);
  const basisVendor = shippingBasis
    ? Array.from(new Set(unitVendorIds.filter(Boolean)))[0] ?? null
    : null;
  const valueOf = (set: ReturningUnits[]) =>
    set.reduce((sum, unit) => sum + Math.max(0, Number(unit.value) || 0), 0);

  const inputFor = (set: ReturningUnits[]) => ({
    itemsSubtotal: valueOf(set),
    basisItemsSubtotal: basisVendor
      ? valueOf(set.filter((unit) => String(unit.vendorId || "") === basisVendor))
      : null,
    orderSubtotal: Number(order.subtotal || 0),
    orderTax: Number(order.tax || 0),
    goodsDiscount,
    recordedGoodsDiscount: returnedGoodsDiscount(order, goodsDiscount, set),
    chargedShipping,
    shippingBasis,
    refundsShipping: params.refundsShipping,
    merchantAtFault: params.merchantAtFault,
    policy: params.policy,
    currency,
  });

  const prior = (params.prior || []).filter((unit) => unit.quantity > 0);
  return buildMarginalReturnRefundEstimate({
    through: inputFor([...prior, ...params.units]),
    before: prior.length > 0 ? inputFor(prior) : null,
  });
}

/**
 * The delivery one seller's parcel charged, and the goods it charged it for.
 *
 * Null for everything that is not a plain split order — and then the estimate
 * falls back to the order-wide share it has always used, which is exactly
 * right when there is only one parcel.
 *
 * Refused when a free-shipping coupon is in play and the consignment did not
 * record its own share of it: the order-level figure is then the only one that
 * is known to be net of the coupon, and quoting a gross parcel charge would
 * hand back delivery the shopper never paid.
 */
function consignmentShippingBasis(
  order: ReturnPlanOrder,
  vendorIds: string[],
): { charged: number; subtotal: number } | null {
  const subOrders = order.subOrders || [];
  if (subOrders.length <= 1) return null;

  const vendors = Array.from(new Set(vendorIds.filter(Boolean)));
  if (vendors.length !== 1) return null;

  const sub = subOrders.find(
    (candidate) => String(candidate?.vendorId || "") === vendors[0],
  );
  if (!sub) return null;

  const subtotal = Math.max(0, Number(sub.subtotal || 0));
  if (subtotal <= 0) return null;

  const recordsOwnShippingDiscount = typeof sub.shippingDiscount === "number";
  if (isFreeShippingCouponType(order.coupon?.type) && !recordsOwnShippingDiscount) {
    return null;
  }

  const charged = Math.max(
    0,
    Number(sub.shippingCost || 0) -
      (recordsOwnShippingDiscount ? Math.max(0, Number(sub.shippingDiscount)) : 0),
  );
  return { charged, subtotal };
}

type DigitalLineProduct = {
  shipping?: { isPhysicalProduct?: boolean | null } | null;
  variants?: ReadonlyArray<{ _id?: unknown; requiresShipping?: boolean | null }> | null;
};

/**
 * Whether an order line was a download rather than goods, by the rule the
 * cart ships by (`resolveItemShipping`): the variant's own setting when it has
 * one, else the product's. Asked of the product alone, a physical product's
 * digital variant read as goods that could be sent back, and a digital
 * product's physical variant as a download that could not.
 */
function isDigitalLine(
  product: DigitalLineProduct | null | undefined,
  variantId: unknown,
): boolean {
  if (!product) return false;
  const wanted = String(variantId ?? "");
  const variant = wanted
    ? (product.variants || []).find((candidate) => String(candidate?._id ?? "") === wanted)
    : undefined;
  const requiresShipping =
    variant?.requiresShipping ?? product.shipping?.isPhysicalProduct ?? true;
  return requiresShipping === false;
}

/**
 * The lines of an order that can never be returned — its digital goods — for
 * the return form to leave out rather than offer and have refused. Final-sale
 * lines are not among them: the store may still open one of those, and the
 * line says so itself (`items[].finalSale`).
 */
export async function nonReturnableItemIndexes(
  items: ReadonlyArray<{ productId?: unknown; variantId?: unknown }> | null | undefined,
): Promise<number[]> {
  const ids = Array.from(
    new Set((items || []).map((item) => String(item?.productId || "")).filter(Boolean)),
  );
  if (ids.length === 0) return [];
  const products = await Product.find({ _id: { $in: ids } })
    .select("_id shipping.isPhysicalProduct variants._id variants.requiresShipping")
    .lean<Array<DigitalLineProduct & { _id: unknown }>>();
  const byId = new Map(products.map((product) => [String(product._id), product]));
  return (items || []).flatMap((item, index) =>
    isDigitalLine(byId.get(String(item?.productId || "")), item?.variantId) ? [index] : [],
  );
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

/** One returning line, as the discount lookups read it. */
type ReturningUnits = {
  orderItemIndex?: number | null;
  quantity: number;
  vendorId?: unknown;
  /** Its goods value at list price. */
  value: number;
};

/**
 * The goods discount the returning units actually carried, or null to fall
 * back to the order-wide share.
 *
 * Read as closely as the order recorded it:
 *  - line by line, where the lines say — a coupon's recorded share
 *    (`items.couponDiscount`), a till markdown on the line itself
 *    (`items.lineDiscount`), and any discount left over (a markdown on the
 *    whole POS sale) shared by what each line sold for. Spread by list price
 *    instead, a till markdown on one line was handed back on every other line
 *    returned from the same sale;
 *  - otherwise consignment by consignment, where a scoped coupon recorded its
 *    seller's slice, for each seller in the return — a return spanning two
 *    sellers used to fall back to the order-wide share;
 *  - otherwise null.
 */
function returnedGoodsDiscount(
  order: ReturnPlanOrder,
  goodsDiscount: number,
  units: ReturningUnits[],
): number | null {
  return (
    lineLevelDiscount(order, goodsDiscount, units) ??
    consignmentLevelDiscount(order, units)
  );
}

function lineLevelDiscount(
  order: ReturnPlanOrder,
  goodsDiscount: number,
  units: ReturningUnits[],
): number | null {
  const orderItems = order.items || [];
  const recordsCoupon = orderItems.some(
    (item) => typeof item?.couponDiscount === "number",
  );
  const tillMarkdown = (item: OrderItemLike | undefined) =>
    Math.max(0, Number(item?.lineDiscount?.amount || 0));
  const hasTillMarkdown = orderItems.some((item) => tillMarkdown(item) > 0);
  if (!recordsCoupon && !hasTillMarkdown) return null;

  const couponOf = (item: OrderItemLike | undefined) =>
    Math.max(0, Number(item?.couponDiscount || 0));
  const gross = (item: OrderItemLike | undefined) =>
    Math.max(0, Number(item?.price || 0) * Number(item?.quantity || 0));
  const own = orderItems.map((item) => couponOf(item) + tillMarkdown(item));
  const net = orderItems.map((item, index) => Math.max(0, gross(item) - own[index]!));
  const netTotal = net.reduce((sum, value) => sum + value, 0);
  // What the lines do not account for — a markdown on the whole sale.
  const leftover = roundMoney(
    Math.max(0, goodsDiscount - own.reduce((sum, value) => sum + value, 0)),
  );

  let total = 0;
  for (const unit of units) {
    const index = unit.orderItemIndex;
    const line = typeof index === "number" ? orderItems[index] : undefined;
    if (!line || typeof index !== "number") return null;
    const ordered = Math.max(0, Number(line.quantity || 0));
    const back = Math.min(ordered, Math.max(0, Number(unit.quantity) || 0));
    if (ordered <= 0 || back <= 0) continue;
    const lineDiscount =
      own[index]! + (netTotal > 0 ? (leftover * net[index]!) / netTotal : 0);
    total += (lineDiscount * back) / ordered;
  }
  return roundMoney(total);
}

function consignmentLevelDiscount(
  order: ReturnPlanOrder,
  units: ReturningUnits[],
): number | null {
  const subOrders = order.subOrders || [];
  if (!subOrders.some((sub) => typeof sub.couponDiscount === "number")) {
    return null;
  }
  const valueByVendor = new Map<string, number>();
  for (const unit of units) {
    const vendorId = String(unit.vendorId || "");
    valueByVendor.set(
      vendorId,
      (valueByVendor.get(vendorId) || 0) + Math.max(0, Number(unit.value) || 0),
    );
  }
  let total = 0;
  for (const [vendorId, value] of valueByVendor) {
    const sub = subOrders.find((candidate) => String(candidate.vendorId) === vendorId);
    if (!sub) return null;
    const subtotal = Math.max(0, Number(sub.subtotal || 0));
    if (subtotal <= 0) continue;
    total +=
      Math.max(0, Number(sub.couponDiscount || 0)) * Math.min(1, value / subtotal);
  }
  return roundMoney(total);
}

/**
 * What a return is worth as it stands now: priced on what arrived once the
 * parcel was counted, else on what was approved — the figure every re-pricing
 * of a stored return lands on, with the store's own changes applied.
 */
export function priceReturnAsItStands(params: {
  returnRequest: {
    items?: ReceivedReturnItem[] | null;
    reason?: string | null;
    faultOverride?: { merchantAtFault?: boolean | null } | null;
    itemsCountedAt?: unknown;
    policyApplied?: Partial<ReturnAppliedPolicy> | null;
  };
  order: ReturnPlanOrder;
  settings: ReturnPolicySettingsLike & {
    general?: { defaultCurrency?: string } | null;
  };
  priorUnitsByIndex?: ReadonlyMap<number, number> | null;
  overrides?: ReturnPriceOverrides | null;
}): ReturnRefundEstimate {
  const { returnRequest, order, settings } = params;
  const items = returnRequest.items || [];
  return (
    (returnRequest.itemsCountedAt
      ? repriceReturnForReceipt({
          items,
          reason: returnRequest.reason,
          faultOverride: returnRequest.faultOverride,
          order,
          settings,
          countedBefore: true,
          policyApplied: returnRequest.policyApplied,
          priorUnitsByIndex: params.priorUnitsByIndex,
          overrides: params.overrides,
        })
      : null) ??
    recomputeReturnEstimate({
      items,
      order,
      settings,
      merchantAtFault: resolveReturnFault(returnRequest),
      policyApplied: returnRequest.policyApplied,
      priorUnitsByIndex: params.priorUnitsByIndex,
      overrides: params.overrides,
    })
  );
}

type ReceivedReturnItem = {
  vendorId?: unknown;
  orderItemIndex?: number | null;
  unitPrice?: number | null;
  quantityApproved?: number | null;
  quantityRequested?: number | null;
  quantityReceived?: number | null;
};

/**
 * The estimate re-priced for what actually came back, or null when every
 * approved unit arrived and the stored estimate still stands.
 *
 * The estimate is what caps a return's refund, and it was priced on the
 * quantity asked for. Recording that one of three units arrived left the cap
 * at all three, so the full value could still be refunded.
 */
export function repriceReturnForReceipt(params: {
  items: ReceivedReturnItem[];
  reason?: string | null;
  faultOverride?: { merchantAtFault?: boolean | null } | null;
  order: ReturnPlanOrder;
  settings: ReturnPolicySettingsLike & {
    general?: { defaultCurrency?: string } | null;
  };
  /**
   * The parcel was counted before, and a count that came up short may have
   * lowered the estimate. A later count that finds everything then prices the
   * return whole again: returning null left the lowered cap standing when the
   * rest of the parcel turned up, and the shopper could never be refunded for
   * units that had arrived.
   */
  countedBefore?: boolean;
  /** As `recomputeReturnEstimate` takes them. */
  policyApplied?: Partial<ReturnAppliedPolicy> | null;
  priorUnitsByIndex?: ReadonlyMap<number, number> | null;
  overrides?: ReturnPriceOverrides | null;
}): ReturnRefundEstimate | null {
  let short = false;
  const items = (params.items || []).map((item) => {
    const approved = Math.max(
      0,
      Number(item?.quantityApproved ?? item?.quantityRequested ?? 0),
    );
    const received = Math.max(0, Number(item?.quantityReceived || 0));
    if (received >= approved) return item;
    short = true;
    return { ...item, quantityApproved: received };
  });
  if (!short && !params.countedBefore) return null;

  const override = params.faultOverride?.merchantAtFault;
  return recomputeReturnEstimate({
    items,
    order: params.order,
    settings: params.settings,
    merchantAtFault:
      typeof override === "boolean"
        ? override
        : isMerchantFaultReturn(params.reason),
    policyApplied: params.policyApplied,
    priorUnitsByIndex: params.priorUnitsByIndex,
    overrides: params.overrides,
  });
}
