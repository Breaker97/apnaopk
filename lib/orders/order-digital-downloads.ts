/**
 * Digital download entitlements for an order.
 *
 * Entitlements are derived, not snapshotted: a paid order entitles the
 * customer to the CURRENT digitalAssets of every product on the order
 * (Shopify Digital Downloads behaves the same — replacing a file updates
 * what customers download). The order document only tracks per-file usage
 * counters against the product's downloadLimit.
 */

import { RETURN_STATUS } from "@/lib/returns/returns";
import { refundedQuantitiesByIndex } from "@/lib/returns/return-plan";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import { Product, ReturnRequest } from "@/models";
import { isSubOrderPaid } from "@/lib/orders/order-payment-status";

type DigitalEntitlementFile = {
  assetId: string;
  productId: string;
  productName: string;
  filename: string;
  size?: number;
  mimeType?: string;
  /** 0 = unlimited. */
  downloadLimit: number;
  downloadedCount: number;
  /** null = unlimited. */
  remainingDownloads: number | null;
};

type OrderLike = {
  _id?: unknown;
  items?: { productId?: unknown; vendorId?: unknown; quantity?: number }[];
  status?: string;
  paymentStatus?: string;
  subOrders?: { vendorId?: unknown; status?: string; paymentStatus?: string | null }[];
  digitalDownloads?: { assetId: string; count?: number }[];
  /** Everything refundable has gone back — see the order model. */
  goodsRefundedAt?: Date | string | null;
};

/**
 * Which vendors on this order have been paid, or null when the question does
 * not apply — a single-vendor order, or one whose sub-orders predate
 * per-consignment payment and therefore all inherit the order-level answer.
 */
function paidVendorIds(order: OrderLike): Set<string> | null {
  const subOrders = order.subOrders ?? [];
  if (subOrders.length < 2) return null;

  const paid = new Set<string>();
  for (const subOrder of subOrders) {
    // A called-off consignment was refunded; its sub-order still reads paid.
    if (subOrder.status === ORDER_STATUS.CANCELLED) continue;
    if (subOrder.vendorId && isSubOrderPaid(order, subOrder)) {
      paid.add(String(subOrder.vendorId));
    }
  }
  return paid;
}

/**
 * Digital files are delivered once their vendor's share has been collected.
 *
 * Per vendor, because payment is: on a split order, one vendor marking their
 * cash collected used to unlock every OTHER vendor's files too — the customer
 * downloaded a second seller's product without having paid for it, and no
 * refund could take it back.
 */
export function isOrderEntitledToDownloads(order: OrderLike): boolean {
  // Money that went back takes the files with it. A refund is only written on
  // the order, so the split order's sub-orders kept reading paid and kept the
  // downloads open.
  if (
    order.status === ORDER_STATUS.CANCELLED ||
    order.paymentStatus === PAYMENT_STATUS.REFUNDED ||
    // A delivered order refunded in full but for the delivery it keeps.
    Boolean(order.goodsRefundedAt)
  ) {
    return false;
  }
  // A partial refund (one returned item) leaves the rest of the order paid for.
  if (
    order.paymentStatus === PAYMENT_STATUS.PAID ||
    order.paymentStatus === PAYMENT_STATUS.PARTIALLY_REFUNDED
  ) {
    return true;
  }
  const paidVendors = paidVendorIds(order);
  return paidVendors !== null && paidVendors.size > 0;
}

/**
 * The products this order actually entitles the customer to.
 *
 * Exported because the single-file download route needs the same list to prove
 * an asset belongs to the order, and it used to build its own — two copies of
 * an entitlement rule, one of which would inevitably stop matching the other.
 */
export function orderEntitledProductIds(
  order: OrderLike,
  /** Lines refunded in full — see `fullyRefundedLines`. */
  refundedLines: ReadonlySet<number> = new Set(),
): string[] {
  const paidVendors = paidVendorIds(order);
  const ids = new Set<string>();
  for (const [index, item] of (order.items ?? []).entries()) {
    if (!item.productId) continue;
    if (refundedLines.has(index)) continue;
    // A partially collected order entitles only the collected vendors' items.
    // With no split to speak of, `isOrderEntitledToDownloads` has already
    // settled it for the whole order.
    if (paidVendors && !paidVendors.has(String(item.vendorId ?? ""))) continue;
    // productId may be an ObjectId, a string, or a populated document.
    const raw = item.productId as { _id?: unknown };
    ids.add(String(raw._id ?? item.productId));
  }
  return [...ids];
}

/**
 * The lines every unit of which has been refunded — itemised on the order's
 * refund screen, or through a refunded return. Their files go back with the
 * money: a partial refund left the order paid as far as downloads went, so a
 * refunded ebook stayed downloadable. A line partly refunded keeps its files;
 * the shopper still owns what they paid for.
 */
export async function fullyRefundedLines(order: OrderLike): Promise<Set<number>> {
  if (order.paymentStatus !== PAYMENT_STATUS.PARTIALLY_REFUNDED || !order._id) {
    return new Set();
  }
  const [itemised, refundedReturns] = await Promise.all([
    refundedQuantitiesByIndex(order._id),
    ReturnRequest.find({ orderId: order._id, status: RETURN_STATUS.REFUNDED })
      .select("items.orderItemIndex items.quantityApproved")
      .lean<Array<{ items?: Array<{ orderItemIndex?: number; quantityApproved?: number }> }>>(),
  ]);
  const refunded = new Map(itemised);
  for (const request of refundedReturns) {
    for (const item of request.items ?? []) {
      const index = Number(item.orderItemIndex);
      if (!Number.isInteger(index) || index < 0) continue;
      refunded.set(index, (refunded.get(index) ?? 0) + Math.max(0, Number(item.quantityApproved ?? 0)));
    }
  }
  const lines = new Set<number>();
  for (const [index, item] of (order.items ?? []).entries()) {
    const ordered = Number(item.quantity ?? 0);
    if (ordered > 0 && (refunded.get(index) ?? 0) >= ordered) lines.add(index);
  }
  return lines;
}

/**
 * List every digital file the given (already ownership-checked) order grants
 * access to, with usage counters applied.
 */
export async function getOrderDigitalEntitlements(
  order: OrderLike,
): Promise<DigitalEntitlementFile[]> {
  const productIds = orderEntitledProductIds(
    order,
    await fullyRefundedLines(order),
  );
  if (productIds.length === 0) return [];

  const products = await Product.find({
    _id: { $in: productIds },
    "digitalAssets.0": { $exists: true },
  })
    .select("name digitalAssets digitalDelivery")
    .lean();

  const counts = new Map(
    (order.digitalDownloads ?? []).map((d) => [d.assetId, d.count ?? 0]),
  );

  const files: DigitalEntitlementFile[] = [];
  for (const product of products) {
    const downloadLimit = product.digitalDelivery?.downloadLimit ?? 0;
    const assets = [...(product.digitalAssets ?? [])].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0),
    );
    for (const asset of assets) {
      const downloadedCount = counts.get(asset._id) ?? 0;
      files.push({
        assetId: asset._id,
        productId: String(product._id),
        productName: product.name,
        filename: asset.filename,
        size: asset.size,
        mimeType: asset.mimeType,
        downloadLimit,
        downloadedCount,
        remainingDownloads:
          downloadLimit > 0
            ? Math.max(0, downloadLimit - downloadedCount)
            : null,
      });
    }
  }
  return files;
}

/**
 * Does any product on this order carry digital files? Used by the order
 * confirmation email to decide whether to show the downloads notice.
 */
export async function orderHasDigitalItems(order: OrderLike): Promise<boolean> {
  const productIds = orderEntitledProductIds(order);
  if (productIds.length === 0) return false;
  const count = await Product.countDocuments({
    _id: { $in: productIds },
    "digitalAssets.0": { $exists: true },
  });
  return count > 0;
}
