import { Order, OrderComment, ReturnRequest, Vendor } from "@/models";
import {
  buildCommentAudienceFilter,
  NOT_DELETED_ORDER_COMMENT_FILTER,
} from "@/models/order-comment.model";
import { InventoryLocation } from "@/models/inventory-location.model";
import { AuditLog } from "@/models/audit-log.model";
import { PaymentTransaction } from "@/models/payment-transaction.model";
import { connectDB } from "@/lib/db";
import { isValidObjectId } from "@/lib/api/validate";
import {
  buildStaffOrderScopeFilter,
  mergeScopeFilter,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";

/**
 * Server-side loaders for the order details screen (admin and staff).
 *
 * These replace the two client mount fetches the page used to fire — one to
 * `/api/admin/returns`, one to `/api/admin/audit-logs` — which could only
 * start after the HTML shipped and the bundle hydrated. Run here they overlap
 * with the order query instead of queueing behind it, and each returns only
 * the handful of fields its component renders rather than whole documents.
 *
 * Every loader takes the caller's staff scope and applies the SAME filter the
 * `/api/admin/orders/[id]` routes apply. Without it a scoped staff member (one
 * limited to a vendor, POS location or fulfillment region) is filtered out of
 * the orders list yet can still open any order — with its customer PII — by
 * typing the id into the URL.
 */

interface OrderReturnRequestSummary {
  _id: string;
  returnNumber: string;
  status: string;
  refundStatus?: string;
  /** Value of the returned goods; caps what may be refunded via this return. */
  estimatedRefundTotal: number;
  /** Already refunded against this return, so the remaining cap is derivable. */
  actualRefundAmount: number;
  /** The vendor whose items these are, when the return is not the store's own. */
  ownerLabel?: string;
}

/**
 * One row in the merged timeline.
 *
 * `kind` is the discriminant between the two backing stores: system events
 * come from `AuditLog`, comments from `OrderComment`. They are merged here
 * rather than in the component so the card stays a dumb renderer, and merged
 * at read time rather than by writing comments into the audit log — see the
 * header of `models/order-comment.model.ts` for why that separation matters.
 */
export interface OrderTimelineEntry {
  _id: string;
  kind: "event" | "comment";
  createdAt: string;

  /** Event rows only. */
  action?: string;
  userEmail?: string;
  summary?: string;
  /**
   * Resulting status, for status-change rows only. A cancellation is a
   * STATUS_CHANGE like any other, so without this the card gave it the same
   * green check as "shipped" — the one transition that must not look like good
   * news.
   */
  status?: string;

  /** Comment rows only. */
  body?: string;
  authorId?: string;
  authorName?: string;
  authorImage?: string;
  editedAt?: string;
}

const TIMELINE_LIMIT = 50;
const COMMENT_LIMIT = 50;
const RETURN_REQUEST_LIMIT = 20;

export async function getOrderDetails(
  id: string,
  staffScope?: StaffAccessScope | null,
) {
  // An id that is not an ObjectId used to reach `findById` and throw a
  // CastError, so a mistyped URL rendered the 500 page instead of 404.
  if (!isValidObjectId(id)) return null;

  await connectDB();
  const order = await Order.findOne(
    mergeScopeFilter({ _id: id }, buildStaffOrderScopeFilter(staffScope)),
  )
    // `createdAt` backs the "customer since" line — without it the panel has
    // no signup date to show.
    .populate("customerId", "name email phone image createdAt")
    .lean();

  if (!order) return null;

  // Which counter an in-store sale was rung up at. `posLocationId` is a bare
  // string with no `ref`, so it cannot be populated, and on its own it tells
  // nobody anything — the screen would say "In-store (POS) sale", which is true
  // of every till the merchant runs and no help at all to somebody tracing a
  // return back to the shelf the units left.
  //
  // Resolved here rather than only in `GET /api/admin/orders/[id]` because this
  // page is server-rendered and never calls that route; doing it in one place
  // and not the other is how the two disagree.
  let posLocationName: string | undefined;
  if (order.posLocationId && isValidObjectId(String(order.posLocationId))) {
    const location = await InventoryLocation.findById(order.posLocationId)
      .select("name")
      .lean<{ name?: string } | null>();
    posLocationName = location?.name;
  }

  // Who each consignment belongs to, by store name. A split order's sub-orders
  // carry only a vendor id, and a list of ids is no help to someone deciding
  // which seller's parcel to call off.
  const vendorIds = [
    ...new Set(
      ((order.subOrders || []) as Array<{ vendorId?: unknown }>)
        .map((sub) => (sub.vendorId ? String(sub.vendorId) : ""))
        .filter(Boolean),
    ),
  ];
  const consignmentSellers: Record<string, string> = {};
  if (vendorIds.length > 1) {
    const vendors = await Vendor.find({ _id: { $in: vendorIds } })
      .select("storeName")
      .lean<Array<{ _id: unknown; storeName?: string }>>();
    for (const vendor of vendors) {
      if (vendor.storeName) consignmentSellers[String(vendor._id)] = vendor.storeName;
    }
  }

  // The chargebacks standing on a split order, and whose sellers each falls
  // on — so an admin who knows whose goods were disputed can say so. Only a
  // split order has sellers to choose between.
  let chargebacks: Array<{
    _id: string;
    amount: number;
    createdAt?: Date;
    disputeId?: string;
    vendorIds: string[];
  }> = [];
  if (vendorIds.length > 1) {
    const rows = await PaymentTransaction.find({
      orderId: order._id,
      type: "refund",
      status: "succeeded",
      "metadata.source": { $in: ["gateway-chargeback", "admin-chargeback-manual"] },
    })
      .select("grossAmount createdAt metadata.dispute refundAllocation")
      .sort({ createdAt: 1 })
      .lean<
        Array<{
          _id: unknown;
          grossAmount?: number;
          createdAt?: Date;
          metadata?: { dispute?: { id?: string } };
          refundAllocation?: Array<{
            vendorId?: unknown;
            merchandise?: number;
            shipping?: number;
            tax?: number;
            duty?: number;
          }>;
        }>
      >();
    chargebacks = rows.map((row) => ({
      _id: String(row._id),
      amount: Number(row.grossAmount || 0),
      createdAt: row.createdAt,
      disputeId: row.metadata?.dispute?.id,
      vendorIds: [
        ...new Set(
          (row.refundAllocation || [])
            .filter(
              (share) =>
                Number(share.merchandise || 0) +
                  Number(share.shipping || 0) +
                  Number(share.tax || 0) +
                  Number(share.duty || 0) >
                0,
            )
            .map((share) => String(share.vendorId || ""))
            .filter(Boolean),
        ),
      ],
    }));
  }

  // ObjectIds and Dates are not serializable across the RSC boundary.
  return JSON.parse(
    JSON.stringify({ ...order, posLocationName, consignmentSellers, chargebacks }),
  );
}

export async function getOrderReturnRequests(
  orderId: string,
  staffScope?: StaffAccessScope | null,
): Promise<OrderReturnRequestSummary[]> {
  if (!isValidObjectId(orderId)) return [];

  await connectDB();
  // Return requests carry the same customer data as the order, so they are
  // gated on the caller being able to see the order in the first place.
  const order = await Order.findOne(
    mergeScopeFilter({ _id: orderId }, buildStaffOrderScopeFilter(staffScope)),
  )
    .select("_id")
    .lean();
  if (!order) return [];

  // Every return on the order, vendor-owned included. These used to be scoped
  // to admin-owned requests, so the one screen an admin could reach a vendor
  // return from showed nothing either — and refunds are theirs to issue.
  const requests = await ReturnRequest.find({ orderId })
    .select(
      "returnNumber status refundStatus estimatedRefund.total actualRefund.amount ownerType ownerVendorId",
    )
    .populate("ownerVendorId", "storeName")
    .sort({ createdAt: -1 })
    .limit(RETURN_REQUEST_LIMIT)
    .lean();

  return requests.map((request) => ({
    _id: String(request._id),
    returnNumber: String(request.returnNumber || ""),
    status: String(request.status || ""),
    refundStatus: request.refundStatus
      ? String(request.refundStatus)
      : undefined,
    estimatedRefundTotal: Number(request.estimatedRefund?.total || 0),
    actualRefundAmount: Number(request.actualRefund?.amount || 0),
    ownerLabel:
      request.ownerType === "vendor"
        ? String(
            (request.ownerVendorId as { storeName?: string } | null)?.storeName ||
              "Vendor",
          )
        : undefined,
  }));
}

export async function getOrderTimeline(
  orderId: string,
  staffScope?: StaffAccessScope | null,
): Promise<OrderTimelineEntry[]> {
  if (!isValidObjectId(orderId)) return [];

  await connectDB();
  // Scoped like its siblings. Both pages already 404 out-of-scope orders via
  // `getOrderDetails`, but this loader is exported and must not rely on a
  // caller having done that first.
  const order = await Order.findOne(
    mergeScopeFilter({ _id: orderId }, buildStaffOrderScopeFilter(staffScope)),
  )
    .select("_id")
    .lean();
  if (!order) return [];

  const [logs, comments] = await Promise.all([
    // Served by the {resource, resourceId, createdAt} index. Audit entries
    // carry full before/after diffs and metadata blobs; the card shows none of
    // it.
    AuditLog.find({ resource: "order", resourceId: orderId })
      .select("action createdAt userEmail changes.summary changes.after.status")
      .sort({ createdAt: -1 })
      .limit(TIMELINE_LIMIT)
      .lean(),
    // Served by the {orderId, createdAt} index. Author fields are denormalized
    // on the comment, so no populate.
    OrderComment.find({
      orderId,
      ...NOT_DELETED_ORDER_COMMENT_FILTER,
      ...buildCommentAudienceFilter(staffScope?.vendorIds),
    })
      .select("body authorId authorName authorImage editedAt createdAt")
      .sort({ createdAt: -1 })
      .limit(COMMENT_LIMIT)
      .lean(),
  ]);

  const events: OrderTimelineEntry[] = logs.map((log) => ({
    _id: String(log._id),
    kind: "event",
    action: String(log.action || ""),
    createdAt: new Date(log.createdAt).toISOString(),
    userEmail: log.userEmail || undefined,
    summary: log.changes?.summary || undefined,
    // Only status-change rows carry a resulting status. `auditUpdate` stores
    // the WHOLE updated order as `changes.after`, so an ordinary edit to an
    // already-cancelled order would otherwise report status "cancelled" and be
    // painted with the red cancellation icon.
    status:
      log.action === "STATUS_CHANGE" || log.action === "STATUS_OVERRIDE"
        ? (log.changes?.after as { status?: string } | undefined)?.status
        : undefined,
  }));

  const notes: OrderTimelineEntry[] = comments.map((comment) => ({
    _id: String(comment._id),
    kind: "comment",
    createdAt: new Date(comment.createdAt).toISOString(),
    body: String(comment.body || ""),
    authorId: String(comment.authorId || ""),
    authorName: String(comment.authorName || ""),
    authorImage: comment.authorImage || undefined,
    editedAt: comment.editedAt
      ? new Date(comment.editedAt).toISOString()
      : undefined,
  }));

  // Newest first, matching the composer sitting at the top of the card.
  return [...events, ...notes].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}
