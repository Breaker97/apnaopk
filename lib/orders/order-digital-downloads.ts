/**
 * Digital download entitlements for an order.
 *
 * Entitlements are derived, not snapshotted: a paid order entitles the
 * customer to the CURRENT digitalAssets of every product on the order
 * (Shopify Digital Downloads behaves the same — replacing a file updates
 * what customers download). The order document only tracks per-file usage
 * counters against the product's downloadLimit.
 */

import { PAYMENT_STATUS } from "@/config/app.config";
import { Product } from "@/models";
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
  items?: { productId?: unknown; vendorId?: unknown }[];
  paymentStatus?: string;
  subOrders?: { vendorId?: unknown; status?: string; paymentStatus?: string | null }[];
  digitalDownloads?: { assetId: string; count?: number }[];
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
  if (order.paymentStatus === PAYMENT_STATUS.PAID) return true;
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
export function orderEntitledProductIds(order: OrderLike): string[] {
  const paidVendors = paidVendorIds(order);
  const ids = new Set<string>();
  for (const item of order.items ?? []) {
    if (!item.productId) continue;
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
 * List every digital file the given (already ownership-checked) order grants
 * access to, with usage counters applied.
 */
export async function getOrderDigitalEntitlements(
  order: OrderLike,
): Promise<DigitalEntitlementFile[]> {
  const productIds = orderEntitledProductIds(order);
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
