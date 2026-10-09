import { AbandonedCheckout, Cart } from "@/models";
import { connectDB } from "@/lib/db";
import { mergeScopeFilter } from "@/lib/access/staff-scope";
import { getCheckoutSubtotal } from "@/lib/orders/abandoned-checkouts";
import {
  abandonedCheckoutScopeFilter,
  ADMIN_ABANDONED_CHECKOUT_VIEWER,
  VENDOR_SNAPSHOT_FIELDS,
  type AbandonedCheckoutViewer,
} from "@/lib/orders/abandoned-checkout-list";
import {
  toVendorAbandonedCheckout,
  topAbandonedProducts,
  type AbandonedCheckoutSource,
  type VendorAbandonedCheckoutRow,
  type VendorAbandonedProductSummary,
} from "@/lib/orders/abandoned-checkout-vendor-view";

/**
 * The figures above an Abandoned checkouts list, counted over the same
 * checkouts the list beneath them can show — the store's, a scoped staff
 * member's, or a vendor's own.
 */

export interface AbandonedCheckoutStats {
  total: number;
  open: number;
  recovered: number;
  emailsSent: number;
  potentialRevenue: number;
}

export interface VendorAbandonedCheckoutStats {
  total: number;
  open: number;
  recovered: number;
  /** The vendor's own lines in the checkouts still open. */
  potentialRevenue: number;
  topProducts: VendorAbandonedProductSummary[];
}

/** Every abandoned checkout the figures count, before any tab or filter. */
const SNAPSHOT_QUERY = {
  status: { $in: ["open", "recovered"] },
  checkoutStartedAt: { $exists: true },
  abandonedAt: { $exists: true },
  "items.0": { $exists: true },
};

interface StatsRow {
  recoveryStatus?: string;
  recoveryEmailStatus?: string;
  totalPrice?: number;
}

export async function fetchAbandonedCheckoutStats(
  viewer: AbandonedCheckoutViewer = ADMIN_ABANDONED_CHECKOUT_VIEWER,
): Promise<AbandonedCheckoutStats> {
  await connectDB();

  const scopeFilter = abandonedCheckoutScopeFilter(viewer);
  const rows: StatsRow[] = scopeFilter
    ? (
        await AbandonedCheckout.find(mergeScopeFilter(SNAPSHOT_QUERY, scopeFilter))
          .select("recoveryStatus recoveryEmailStatus totalPrice subtotalPrice")
          .lean()
      ).map((checkout) => ({
        recoveryStatus: checkout.recoveryStatus,
        recoveryEmailStatus: checkout.recoveryEmailStatus,
        totalPrice: checkout.totalPrice ?? checkout.subtotalPrice ?? 0,
      }))
    : await storeStatsRows();

  const openRows = rows.filter((row) => row.recoveryStatus !== "recovered");

  return {
    total: rows.length,
    open: openRows.length,
    recovered: rows.filter((row) => row.recoveryStatus === "recovered").length,
    emailsSent: rows.filter((row) => row.recoveryEmailStatus === "sent").length,
    potentialRevenue: openRows.reduce(
      (sum, row) => sum + Number(row.totalPrice || 0),
      0,
    ),
  };
}

/**
 * The store's figures: the snapshots and the live carts abandoned before a
 * snapshot existed, de-duplicated on checkout token as the list does.
 */
async function storeStatsRows(): Promise<StatsRow[]> {
  const [snapshotDocs, cartDocs] = await Promise.all([
    AbandonedCheckout.find(SNAPSHOT_QUERY)
      .select(
        "checkoutToken cartId recoveryStatus recoveryEmailStatus totalPrice subtotalPrice",
      )
      .lean(),
    Cart.find({
      status: { $in: ["abandoned", "recovered"] },
      "items.0": { $exists: true },
      $or: [
        { checkoutStartedAt: { $exists: true } },
        { abandonedAt: { $exists: true } },
      ],
    })
      .select(
        "checkoutToken recoveryStatus recoveryEmailStatus totalPrice subtotalPrice items",
      )
      .lean(),
  ]);

  const seen = new Set<string>();
  return [
    ...snapshotDocs.map((checkout) => {
      const key = String(checkout.checkoutToken || checkout.cartId || checkout._id);
      seen.add(key);
      return {
        recoveryStatus: checkout.recoveryStatus,
        recoveryEmailStatus: checkout.recoveryEmailStatus,
        totalPrice: checkout.totalPrice ?? checkout.subtotalPrice ?? 0,
      };
    }),
    ...cartDocs
      .filter((cart) => !seen.has(String(cart.checkoutToken || cart._id)))
      .map((cart) => ({
        recoveryStatus: cart.recoveryStatus,
        recoveryEmailStatus: cart.recoveryEmailStatus,
        totalPrice:
          cart.totalPrice ?? cart.subtotalPrice ?? getCheckoutSubtotal(cart),
      })),
  ];
}

/**
 * A vendor's figures, over its own lines only: how many checkouts held its
 * goods, how many are still open, what its share of those is worth, and which
 * of its products are left behind most.
 */
export async function fetchVendorAbandonedCheckoutStats(
  vendorId: string,
): Promise<VendorAbandonedCheckoutStats> {
  await connectDB();

  const viewer: AbandonedCheckoutViewer = { kind: "vendor", vendorId };
  const docs = await AbandonedCheckout.find(
    mergeScopeFilter(SNAPSHOT_QUERY, abandonedCheckoutScopeFilter(viewer)!),
  )
    .select(VENDOR_SNAPSHOT_FIELDS)
    .lean();

  const rows = (docs as AbandonedCheckoutSource[])
    .map((doc) => toVendorAbandonedCheckout(doc, vendorId))
    .filter((row): row is VendorAbandonedCheckoutRow => row !== null);
  const openRows = rows.filter((row) => row.recoveryStatus !== "recovered");

  return {
    total: rows.length,
    open: openRows.length,
    recovered: rows.length - openRows.length,
    potentialRevenue: openRows.reduce((sum, row) => sum + row.totalPrice, 0),
    topProducts: topAbandonedProducts(rows),
  };
}
