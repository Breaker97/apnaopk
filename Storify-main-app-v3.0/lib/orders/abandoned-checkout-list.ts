import { Types } from "mongoose";
import { onAppOrigin } from "@/lib/app-url";
import { AbandonedCheckout, Cart, Order, Vendor } from "@/models";
import { offerState, type StoredOffer } from "@/lib/orders/abandoned-offer-state";
import { connectDB } from "@/lib/db";
import { getCheckoutSubtotal } from "@/lib/orders/abandoned-checkouts";
import { listResult, type ListResult } from "@/lib/api/list-query";
import { resolveDateFilter } from "@/lib/date-filter";
import { isAbandonedWithin } from "@/lib/orders/abandoned-checkout-row";
import {
  toVendorAbandonedCheckout,
  type AbandonedCheckoutSource,
  type VendorAbandonedCheckoutRow,
} from "@/lib/orders/abandoned-checkout-vendor-view";
import { AuthorizationError } from "@/lib/api/errors";
import {
  buildStaffAbandonedCheckoutScopeFilter,
  hasStaffScope,
  mergeScopeFilter,
  staffScopeReachesAbandonedCheckouts,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";

/**
 * Abandoned checkout list query.
 *
 * Shared by `GET /api/admin/abandoned-checkouts`, `GET
 * /api/vendor/abandoned-checkouts`, the three pages' server components and the
 * CSV export, so all of them always read a query string the same way.
 *
 * Rows come from two places — the `AbandonedCheckout` snapshot written at
 * checkout, and live `Cart` documents that were abandoned before a snapshot
 * existed — so they are merged, de-duplicated on checkout token, then
 * filtered, sorted and paged in memory. That is why this one cannot push
 * paging into Mongo the way the other lists do.
 *
 * Who is reading decides what is read (`AbandonedCheckoutViewer`):
 * - the store, and staff with no scope, see every checkout, as before;
 * - staff limited to vendors or regions see the snapshots in their scope;
 * - a vendor sees the snapshots holding one of its lines, cut down to those
 *   lines with nobody named (`toVendorAbandonedCheckout`).
 * The two scoped readers skip the live carts: those predate the snapshot and
 * carry no seller, and a cart expires within a month anyway.
 */

export type AbandonedCheckoutViewer =
  | { kind: "admin" }
  | { kind: "staff"; scope?: StaffAccessScope | null }
  | { kind: "vendor"; vendorId: string };

export const ADMIN_ABANDONED_CHECKOUT_VIEWER: AbandonedCheckoutViewer = {
  kind: "admin",
};

/**
 * The reader behind an `admin-or-staff` route, from the grants `withApi`
 * resolved: an administrator carries none, a staff member their permissions
 * and scope. A staff member limited by locations alone is refused — a
 * checkout has no location to match.
 */
export function abandonedCheckoutViewerForStaff(
  staff?: { permissions?: readonly string[]; scope?: StaffAccessScope | null } | null,
): AbandonedCheckoutViewer {
  if (!staff?.permissions) return ADMIN_ABANDONED_CHECKOUT_VIEWER;
  if (!staffScopeReachesAbandonedCheckouts(staff.scope)) {
    throw new AuthorizationError(
      "Your access is limited to locations, and an abandoned checkout has no location.",
    );
  }
  return { kind: "staff", scope: staff.scope };
}

/**
 * The filter a viewer's snapshots are read through, or null for a reader who
 * sees everything (snapshots and live carts alike).
 */
export function abandonedCheckoutScopeFilter(
  viewer: AbandonedCheckoutViewer,
): Record<string, unknown> | null {
  if (viewer.kind === "vendor") {
    return Types.ObjectId.isValid(viewer.vendorId)
      ? { vendorIds: new Types.ObjectId(viewer.vendorId) }
      : { _id: { $exists: false } };
  }
  if (viewer.kind === "staff" && hasStaffScope(viewer.scope)) {
    return buildStaffAbandonedCheckoutScopeFilter(viewer.scope);
  }
  return null;
}

/**
 * What a vendor's read loads: never the shopper's contact or address fields.
 * `offers`, `unsubscribedAt` and `status` only decide what the vendor's own
 * offer column and button show (`toVendorAbandonedCheckout`).
 */
export const VENDOR_SNAPSHOT_FIELDS =
  "userId items presentmentCurrency abandonedAt checkoutStartedAt updatedAt recoveryStatus orderId offers unsubscribedAt status";

const SORT_FIELDS = new Set([
  "abandonedAt",
  "updatedAt",
  "checkoutStartedAt",
  "totalPrice",
  "recoveryEmailStatus",
  "recoveryStatus",
]);

export async function fetchAbandonedCheckoutList(
  searchParams: URLSearchParams,
  viewer: AbandonedCheckoutViewer = ADMIN_ABANDONED_CHECKOUT_VIEWER,
): Promise<ListResult<unknown>> {
  const rows = await queryAbandonedCheckouts(searchParams, viewer);

  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("limit") || "10", 10)),
  );
  const skip = (page - 1) * limit;
  const pageRows = rows.slice(skip, skip + limit);
  const items =
    viewer.kind === "vendor" ? pageRows : await withOfferSellers(pageRows);

  return listResult(items as unknown[], page, limit, rows.length);
}

/**
 * The store's rows, each vendor offer on them named by its seller and read as
 * it stands now (`offerState`) — "10% · Electronica XR · sent". One read for
 * the page, and none at all where no row has an offer.
 */
async function withOfferSellers<T>(rows: T[]): Promise<T[]> {
  const offersOf = (row: T) => (row as { offers?: StoredOffer[] | null }).offers ?? [];
  const ids = new Set<string>();
  for (const row of rows) {
    for (const offer of offersOf(row)) {
      if (offer.vendorId != null) ids.add(String(offer.vendorId));
    }
  }
  if (ids.size === 0) return rows;

  const vendors = await Vendor.find({ _id: { $in: Array.from(ids) } })
    .select("storeName")
    .lean<Array<{ _id: unknown; storeName?: string }>>();
  const names = new Map(vendors.map((vendor) => [String(vendor._id), vendor.storeName]));
  const now = new Date();

  return rows.map((row) => {
    const offers = offersOf(row);
    if (offers.length === 0) return row;
    return {
      ...row,
      offerSummaries: offers.map((offer) => ({
        vendorName: names.get(String(offer.vendorId)) || "A seller",
        kind: offer.kind,
        type: offer.type,
        value: offer.value,
        code: offer.code,
        validUntil: offer.validUntil,
        status: offerState(offer, now),
      })),
    };
  });
}

/**
 * Every checkout the query matches, in the order the list shows them, without
 * paging — what the CSV export writes. `total` is how many matched, so a caller
 * that caps the file can say it did.
 */
export async function fetchAbandonedCheckoutExport(
  searchParams: URLSearchParams,
  maxRows: number,
  viewer: AbandonedCheckoutViewer = ADMIN_ABANDONED_CHECKOUT_VIEWER,
) {
  const rows = await queryAbandonedCheckouts(searchParams, viewer);
  return { rows: rows.slice(0, maxRows), total: rows.length };
}

async function queryAbandonedCheckouts(
  searchParams: URLSearchParams,
  viewer: AbandonedCheckoutViewer,
) {
  await connectDB();

  const search = searchParams.get("search")?.trim();
  const view = searchParams.get("view") || "all";
  const emailStatus = searchParams.get("emailStatus") || "all";
  // A named period or a picked day range, as the Orders list's date filter has
  // it: filtered on the same date the Abandoned column prints.
  const abandonedWithin = resolveDateFilter(searchParams.get("date") ?? undefined);
  const sortBy = SORT_FIELDS.has(searchParams.get("sortBy") || "")
    ? searchParams.get("sortBy") || "abandonedAt"
    : "abandonedAt";
  const sortOrder = searchParams.get("sortOrder") === "asc" ? 1 : -1;

  const snapshotQuery: Record<string, unknown> = {
    status: { $in: ["open", "recovered"] },
    checkoutStartedAt: { $exists: true },
    abandonedAt: { $exists: true },
    "items.0": { $exists: true },
  };

  if (view === "open") {
    snapshotQuery.recoveryStatus = { $ne: "recovered" };
  } else if (view === "recovered") {
    snapshotQuery.recoveryStatus = "recovered";
  }

  if (emailStatus !== "all") {
    snapshotQuery.recoveryEmailStatus = emailStatus;
  }

  const finish = <T>(rows: T[]) =>
    filterAndSortRows(rows, { abandonedWithin, search, sortBy, sortOrder });

  const scopeFilter = abandonedCheckoutScopeFilter(viewer);

  if (viewer.kind === "vendor") {
    const docs = await AbandonedCheckout.find(mergeScopeFilter(snapshotQuery, scopeFilter!))
      .select(VENDOR_SNAPSHOT_FIELDS)
      .sort({ [sortBy]: sortOrder, updatedAt: -1 })
      .lean();
    return finish(await toVendorRows(docs as AbandonedCheckoutSource[], viewer.vendorId));
  }

  if (scopeFilter) {
    const docs = await AbandonedCheckout.find(mergeScopeFilter(snapshotQuery, scopeFilter))
      .sort({ [sortBy]: sortOrder, updatedAt: -1 })
      .lean();
    return finish(docs.map(snapshotRow));
  }

  const cartQuery: Record<string, unknown> = {
    status: { $in: ["abandoned", "recovered"] },
    "items.0": { $exists: true },
    $or: [
      { checkoutStartedAt: { $exists: true } },
      { abandonedAt: { $exists: true } },
    ],
  };
  if (view === "open") {
    cartQuery.recoveryStatus = { $ne: "recovered" };
  } else if (view === "recovered") {
    cartQuery.recoveryStatus = "recovered";
  }
  if (emailStatus !== "all") {
    cartQuery.recoveryEmailStatus = emailStatus;
  }

  const [snapshotDocs, cartDocs] = await Promise.all([
    AbandonedCheckout.find(snapshotQuery)
      .sort({ [sortBy]: sortOrder, updatedAt: -1 })
      .lean(),
    Cart.find(cartQuery).sort({ abandonedAt: -1, updatedAt: -1 }).lean(),
  ]);

  const seen = new Set<string>();
  const rows = [
    ...snapshotDocs.map((checkout) => {
      const key = String(checkout.checkoutToken || checkout.cartId || checkout._id);
      seen.add(key);
      return snapshotRow(checkout);
    }),
    ...cartDocs
      .filter((cart) => {
        const key = String(cart.checkoutToken || cart._id);
        return !seen.has(key);
      })
      .map((cart) => ({
        ...cart,
        _id: String(cart._id),
        cartId: String(cart._id),
        checkoutUrl: onAppOrigin(cart.checkoutUrl),
        status: cart.recoveryStatus === "recovered" ? "recovered" : "open",
        recoveryStatus: cart.recoveryStatus || "not_recovered",
        recoveryEmailStatus: cart.recoveryEmailStatus || "not_sent",
        abandonedAt: cart.abandonedAt || cart.updatedAt,
        checkoutStartedAt: cart.checkoutStartedAt || cart.createdAt,
        subtotalPrice: cart.subtotalPrice ?? getCheckoutSubtotal(cart),
        totalPrice:
          cart.totalPrice ?? cart.subtotalPrice ?? getCheckoutSubtotal(cart),
        itemCount: getItemCount(cart.items),
      })),
  ];

  return finish(rows);
}

interface SnapshotDoc {
  _id?: unknown;
  checkoutUrl?: string | null;
  subtotalPrice?: number | null;
  totalPrice?: number | null;
  items?: Array<{ quantity?: number }> | null;
}

/** A snapshot as the store's list shows it. */
function snapshotRow<T extends SnapshotDoc>(checkout: T) {
  return {
    ...checkout,
    _id: String(checkout._id),
    // Stored recovery links were built from the shopper's `Origin`
    // header, so one saved before that stopped can name any site.
    checkoutUrl: onAppOrigin(checkout.checkoutUrl ?? undefined),
    subtotalPrice: checkout.subtotalPrice ?? 0,
    totalPrice: checkout.totalPrice ?? checkout.subtotalPrice ?? 0,
    itemCount: getItemCount(checkout.items ?? undefined),
  };
}

/**
 * A vendor's rows: its own lines, nobody named, and — for a checkout the
 * shopper came back and paid — the order, when that order holds this vendor's
 * consignment. One that does not (the shopper dropped the vendor's goods before
 * paying) is not the vendor's order to open, so it is not linked.
 */
async function toVendorRows(
  docs: AbandonedCheckoutSource[],
  vendorId: string,
): Promise<VendorAbandonedCheckoutRow[]> {
  const rows: VendorAbandonedCheckoutRow[] = [];
  const orderIdByRow = new Map<string, string>();

  for (const doc of docs) {
    const row = toVendorAbandonedCheckout(doc, vendorId);
    if (!row) continue;
    rows.push(row);
    const orderId = doc.orderId == null ? "" : String(doc.orderId);
    if (row.recoveryStatus === "recovered" && Types.ObjectId.isValid(orderId)) {
      orderIdByRow.set(row._id, orderId);
    }
  }

  if (orderIdByRow.size > 0) {
    const orders = await Order.find({
      _id: { $in: Array.from(new Set(orderIdByRow.values())) },
      "subOrders.vendorId": new Types.ObjectId(vendorId),
    })
      .select("_id orderNumber")
      .lean<Array<{ _id: unknown; orderNumber?: string }>>();
    const byId = new Map(orders.map((order) => [String(order._id), order]));
    for (const row of rows) {
      const order = byId.get(orderIdByRow.get(row._id) ?? "");
      if (order) {
        row.order = {
          _id: String(order._id),
          ...(order.orderNumber ? { orderNumber: order.orderNumber } : {}),
        };
      }
    }
  }

  return rows;
}

/**
 * The date filter, the search box and the sort, applied to whichever rows the
 * reader may see. A vendor's rows carry no contact fields, so its search can
 * only ever match its own product names.
 */
function filterAndSortRows<T>(
  rows: T[],
  options: {
    abandonedWithin: ReturnType<typeof resolveDateFilter>;
    search?: string;
    sortBy: string;
    sortOrder: 1 | -1;
  },
): T[] {
  const needle = options.search?.toLowerCase();
  return rows
    .filter((row) =>
      isAbandonedWithin(row as Parameters<typeof isAbandonedWithin>[0], options.abandonedWithin),
    )
    .filter((row) => {
      if (!needle) return true;
      const fields = row as {
        email?: unknown;
        phone?: unknown;
        customerName?: unknown;
        items?: Array<{ name?: unknown }> | null;
      };
      return [
        fields.email,
        fields.phone,
        fields.customerName,
        ...(fields.items || []).map((item) => item?.name),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    })
    .sort((a, b) =>
      compareRows(
        a as Record<string, unknown>,
        b as Record<string, unknown>,
        options.sortBy,
        options.sortOrder,
      ),
    );
}

function getItemCount(items?: Array<{ quantity?: number }>) {
  return (items || []).reduce(
    (sum: number, item: { quantity?: number }) => sum + Number(item.quantity || 0),
    0,
  );
}

function compareRows(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  sortBy: string,
  sortOrder: 1 | -1,
) {
  const av = a[sortBy];
  const bv = b[sortBy];

  if (sortBy.endsWith("At") || av instanceof Date || bv instanceof Date) {
    return (
      (new Date(String(av || 0)).getTime() -
        new Date(String(bv || 0)).getTime()) *
      sortOrder
    );
  }

  if (typeof av === "number" || typeof bv === "number") {
    return (Number(av || 0) - Number(bv || 0)) * sortOrder;
  }

  return String(av || "").localeCompare(String(bv || "")) * sortOrder;
}
