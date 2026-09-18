import "server-only";

import { mongoose } from "@/lib/db";
import { Order, Product, Review } from "@/models";
import { ORDER_STATUS, PRODUCT_STATUS } from "@/config/app.config";

/**
 * Who may review what, and what to ask them to review.
 *
 * A review is a verified purchase: one per product per order, written by the
 * shopper who received it. "Received" is decided per consignment, not by the
 * order's own status. An order is only as far along as its least advanced
 * seller (`deriveOrderStatusFromSubOrders`), so the first seller's parcel
 * could sit on the doorstep for a week while the order still read "shipped"
 * and none of it could be reviewed. The same roll-up drops cancelled sellers,
 * so a "delivered" order also let its shopper review goods that never came.
 *
 * The review endpoint, the product page's "Write a review", the order page
 * and the account overview all read the rule from here, so none of them can
 * offer a review the endpoint would then refuse.
 */

interface ReviewOrderItem {
  productId?: unknown;
  vendorId?: unknown;
  name?: string;
  image?: string;
}

interface ReviewSubOrder {
  vendorId?: unknown;
  status?: string;
  deliveredAt?: Date | string | null;
}

interface ReviewOrderLike {
  _id?: unknown;
  orderNumber?: string;
  status?: string;
  deliveredAt?: Date | string | null;
  createdAt?: Date | string | null;
  items?: ReviewOrderItem[] | null;
  subOrders?: ReviewSubOrder[] | null;
}

interface DeliveredOrderItem {
  productId: string;
  /** Position in `order.items`. */
  index: number;
  /**
   * When the line's consignment arrived. POS sales and older orders never had
   * the stamp, so it falls back to the order's own, then to when it was placed.
   */
  deliveredAt: Date | null;
}

/** What the rule needs to see of an order. */
const DELIVERY_FIELDS =
  "status deliveredAt createdAt items.productId items.vendorId subOrders.vendorId subOrders.status subOrders.deliveredAt";

/**
 * Orders with at least one delivery — the half of the rule an index can
 * narrow to. `deliveredOrderItems` then settles which lines it covers.
 */
const HAS_DELIVERY = {
  $or: [
    { status: ORDER_STATUS.DELIVERED },
    { "subOrders.status": ORDER_STATUS.DELIVERED },
  ],
};

/** An id as a string, whether raw, an ObjectId or a populated document. */
function idString(value: unknown): string {
  if (!value) return "";
  const populated = value as { _id?: unknown };
  return String(populated._id ?? value);
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The lines on an order that have reached the shopper.
 *
 * A line travels with its seller's consignment. The order's own "delivered"
 * still counts for a line whose consignment says otherwise — unless that
 * consignment was cancelled — because orders written before the status
 * cascade carry sub-orders that were never moved, and they must not lose the
 * reviews they have always allowed. Orders with no sub-orders at all have only
 * the order's status to go on.
 */
export function deliveredOrderItems(order: ReviewOrderLike): DeliveredOrderItem[] {
  const consignmentsByVendor = new Map<string, ReviewSubOrder[]>();
  for (const subOrder of order.subOrders ?? []) {
    const vendorId = idString(subOrder.vendorId);
    if (!vendorId) continue;
    consignmentsByVendor.set(vendorId, [
      ...(consignmentsByVendor.get(vendorId) ?? []),
      subOrder,
    ]);
  }

  const orderDelivered = order.status === ORDER_STATUS.DELIVERED;
  const delivered: DeliveredOrderItem[] = [];

  (order.items ?? []).forEach((item, index) => {
    const productId = idString(item.productId);
    if (!productId) return;

    const consignments = consignmentsByVendor.get(idString(item.vendorId)) ?? [];
    const arrived = consignments.find(
      (subOrder) => subOrder.status === ORDER_STATUS.DELIVERED,
    );
    const cancelled =
      consignments.length > 0 &&
      consignments.every((subOrder) => subOrder.status === ORDER_STATUS.CANCELLED);
    if (!arrived && !(orderDelivered && !cancelled)) return;

    delivered.push({
      productId,
      index,
      deliveredAt:
        toDate(arrived?.deliveredAt) ??
        toDate(order.deliveredAt) ??
        toDate(order.createdAt),
    });
  });

  return delivered;
}

function deliversProduct(order: ReviewOrderLike, productId: string): boolean {
  return deliveredOrderItems(order).some((item) => item.productId === productId);
}

/**
 * Whether this order entitles this shopper to review this product. Ids that
 * are not ids at all answer false rather than surfacing as a cast error.
 */
export async function isReviewableOrder(
  userId: string,
  productId: string,
  orderId: string,
): Promise<boolean> {
  if (!mongoose.isValidObjectId(productId) || !mongoose.isValidObjectId(orderId)) {
    return false;
  }

  const order = await Order.findOne({
    _id: orderId,
    customerId: userId,
    "items.productId": productId,
    ...HAS_DELIVERY,
  })
    .select(DELIVERY_FIELDS)
    .lean<ReviewOrderLike | null>();

  return order !== null && deliversProduct(order, productId);
}

interface ReviewEligibility {
  /** The newest delivered order with this product that has no review from them yet. */
  eligibleOrderId: string | null;
  /** They have received it, and every one of those orders already has their review. */
  alreadyReviewed: boolean;
}

/**
 * Which of the shopper's orders a new review of this product would belong to.
 *
 * Skipping orders that already carry their review is the point: the product
 * page used to hand back the newest delivered order regardless, so a shopper
 * who had reviewed it wrote the whole review again and only learned at submit
 * that it could not be saved.
 */
export async function resolveReviewEligibility(
  userId: string,
  productId: string,
): Promise<ReviewEligibility> {
  const orders = await Order.find({
    customerId: userId,
    "items.productId": productId,
    ...HAS_DELIVERY,
  })
    .select(DELIVERY_FIELDS)
    .sort({ createdAt: -1 })
    .lean<ReviewOrderLike[]>();

  const deliveredOrderIds = orders
    .filter((order) => deliversProduct(order, productId))
    .map((order) => idString(order._id));
  if (deliveredOrderIds.length === 0) {
    return { eligibleOrderId: null, alreadyReviewed: false };
  }

  const reviews = await Review.find({
    userId,
    productId,
    orderId: { $in: deliveredOrderIds },
  })
    .select("orderId")
    .lean<Array<{ orderId: unknown }>>();
  const reviewedOrderIds = new Set(reviews.map((review) => idString(review.orderId)));

  const eligibleOrderId =
    deliveredOrderIds.find((orderId) => !reviewedOrderIds.has(orderId)) ?? null;
  return { eligibleOrderId, alreadyReviewed: eligibleOrderId === null };
}

export interface OrderReviewState {
  productId: string;
  /** Delivered, still in the catalog, and not reviewed on this order yet. */
  canReview: boolean;
  /** The shopper's rating of this product on this order, once written. */
  rating: number | null;
}

/**
 * Review state for each delivered product on one (already ownership-checked)
 * order. Empty until something on it has been delivered, which costs a
 * not-yet-delivered order no queries at all.
 */
export async function getOrderReviewStates(
  userId: string,
  order: ReviewOrderLike,
): Promise<OrderReviewState[]> {
  const productIds = [
    ...new Set(deliveredOrderItems(order).map((item) => item.productId)),
  ];
  if (productIds.length === 0) return [];

  // A product deleted since the sale can no longer be reviewed — the endpoint
  // refuses it — so it must not be offered.
  const [reviews, products] = await Promise.all([
    Review.find({ userId, orderId: order._id })
      .select("productId rating")
      .lean<Array<{ productId: unknown; rating: number }>>(),
    Product.find({ _id: { $in: productIds } })
      .select("_id")
      .lean<Array<{ _id: unknown }>>(),
  ]);
  const ratingByProduct = new Map(
    reviews.map((review) => [idString(review.productId), review.rating]),
  );
  const existing = new Set(products.map((product) => idString(product._id)));

  return productIds.map((productId) => {
    const rating = ratingByProduct.get(productId) ?? null;
    return {
      productId,
      rating,
      canReview: rating === null && existing.has(productId),
    };
  });
}

export interface PendingReview {
  productId: string;
  orderId: string;
  orderNumber: string;
  /** As it was bought: the line's own name and picture are what the shopper recognises. */
  name: string;
  image: string | null;
  slug: string;
  deliveredAt: string | null;
}

/**
 * How many of the shopper's most recent orders with a delivery are searched
 * for something to review. A recommendation, not an audit: past this the
 * purchase is old enough that the order page is the place to review it.
 */
const PENDING_REVIEW_ORDER_SCAN = 30;

/**
 * Delivered products still waiting for the shopper's review, most recently
 * delivered first — what the account overview asks them to rate.
 *
 * One entry per product, and none for a product they have reviewed on any
 * order: a shopper who rated the coffee they buy every month has answered the
 * question, and asking again each delivery would be nagging. Only products
 * the storefront still shows are suggested, since a review of anything else
 * would never be read.
 */
export async function listPendingReviews(
  userId: string,
  { limit = 10 }: { limit?: number } = {},
): Promise<PendingReview[]> {
  const orders = await Order.find({ customerId: userId, ...HAS_DELIVERY })
    .select(`orderNumber items.name items.image ${DELIVERY_FIELDS}`)
    .sort({ createdAt: -1 })
    .limit(PENDING_REVIEW_ORDER_SCAN)
    .lean<ReviewOrderLike[]>();

  const candidates = new Map<
    string,
    { order: ReviewOrderLike; item: ReviewOrderItem; deliveredAt: Date | null }
  >();
  for (const order of orders) {
    for (const delivered of deliveredOrderItems(order)) {
      const current = candidates.get(delivered.productId);
      if (
        current &&
        (current.deliveredAt?.getTime() ?? 0) >= (delivered.deliveredAt?.getTime() ?? 0)
      ) {
        continue;
      }
      candidates.set(delivered.productId, {
        order,
        item: order.items?.[delivered.index] ?? {},
        deliveredAt: delivered.deliveredAt,
      });
    }
  }
  if (candidates.size === 0) return [];

  const productIds = [...candidates.keys()];
  const [reviewedProductIds, products] = await Promise.all([
    Review.distinct("productId", { userId, productId: { $in: productIds } }),
    Product.find({ _id: { $in: productIds }, status: PRODUCT_STATUS.ACTIVE })
      .select("name slug images")
      .lean<Array<{ _id: unknown; name?: string; slug?: string; images?: string[] }>>(),
  ]);
  const reviewed = new Set((reviewedProductIds as unknown[]).map(idString));
  const productById = new Map(products.map((product) => [idString(product._id), product]));

  const pending = [];
  for (const [productId, candidate] of candidates) {
    const product = productById.get(productId);
    if (product && !reviewed.has(productId)) {
      pending.push({ productId, product, ...candidate });
    }
  }

  return pending
    .sort(
      (a, b) => (b.deliveredAt?.getTime() ?? 0) - (a.deliveredAt?.getTime() ?? 0),
    )
    .slice(0, limit)
    .map(({ productId, product, order, item, deliveredAt }) => ({
      productId,
      orderId: idString(order._id),
      orderNumber: order.orderNumber ?? "",
      name: item.name || product.name || "",
      image: item.image || product.images?.[0] || null,
      slug: product.slug ?? "",
      deliveredAt: deliveredAt?.toISOString() ?? null,
    }));
}
