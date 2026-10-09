import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import * as z from "zod";
import { hasVendorPermission, isAdmin, assertVendorPermission } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { UpdateOrderStatusSchema } from "@/lib/validations";
import { auditUpdate, createAuditContext } from "@/lib/audit";
import { preparationMessage } from "@/lib/orders/preorder-action-responses";
import {
  completeConsignmentChange,
  prepareConsignmentChange,
  refundCancelledConsignment,
  saveConsignmentChange,
  settleConsignmentChange,
  type ConsignmentChange,
  type ConsignmentVendor,
  type OrderActor,
  type OrderDocumentLike,
} from "@/lib/orders/order-actions";
import { toVendorOrderView } from "@/lib/vendors/vendor-order-view";
import { loadVendorOrderDetail } from "@/lib/vendors/vendor-order-detail";
import {
  deriveOrderPaymentStatus,
  resolveSubOrderPaymentStatus,
} from "@/lib/orders/order-payment-status";
import { isPlatformSettled } from "@/lib/payments/payment-custody";
import { withApi } from "@/lib/api/handler";
import { getPendingPaymentLock } from "@/lib/orders/pending-payment-lock";

const VendorUpdateOrderSchema = UpdateOrderStatusSchema.partial()
  .extend({
    paymentStatus: z.literal(PAYMENT_STATUS.PAID).optional(),
    carrier: z.string().trim().max(100).optional(),
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.trackingNumber !== undefined ||
      value.carrier !== undefined ||
      value.paymentStatus !== undefined,
    { message: "No updates provided" },
  );

/**
 * GET /api/vendor/orders/[id]
 * Get a single order by ID (vendor's sub-order only)
 * Requires: VIEW_ORDERS permission
 */
export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    // Check RBAC permission
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.VIEW_ORDERS,
      "You do not have permission to view orders",
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:orders:read",
      "lenient",
      session.user.role
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id);
    if (!vendor) throw new AuthorizationError("Vendor profile not found");

    const detail = await loadVendorOrderDetail(params.id, vendor._id, settings);
    if (!detail) return notFoundResponse("Order");
    return successResponse(detail);
  },
);

/**
 * PUT /api/vendor/orders/[id]
 * Update vendor's sub-order status (e.g., shipped, delivered)
 * Requires: EDIT_ORDERS permission
 */
export const PUT = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    // Check RBAC permission
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.EDIT_ORDERS,
      "You do not have permission to edit orders",
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:orders:update",
      "moderate",
      session.user.role
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id);
    if (!vendor) throw new AuthorizationError("Vendor profile not found");

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Order");

    const { status, trackingNumber, carrier, paymentStatus } = await validateBody(
      request,
      VendorUpdateOrderSchema,
    );
    if (status === "cancelled") {
      const hasDeletePermission = await hasVendorPermission(
        user,
        VENDOR_PERMISSIONS.DELETE_ORDERS,
      );
      if (!hasDeletePermission && !isAdmin(user)) {
        throw new AuthorizationError(
          "You do not have permission to cancel orders",
        );
      }
    }

    const order = await Order.findOne({
      _id: id,
      "subOrders.vendorId": vendor._id,
    });

    if (!order) {
      return notFoundResponse("Order");
    }

    // Find and update vendor's sub-order
    const subOrderIndex = order.subOrders.findIndex(
      (sub: { vendorId?: { toString: () => string } }) =>
        sub.vendorId?.toString() === vendor._id.toString(),
    );

    if (subOrderIndex === -1) {
      return notFoundResponse("Sub-order");
    }

    const before = order.toObject() as unknown as Record<string, unknown>;

    // Nothing moves while a mobile-money payment is still in flight: a vendor
    // calling their consignment off would restock goods the payer may be
    // paying for right now, on a provider that cannot refund automatically.
    // The fulfilment gate already refused to let them SHIP it; this is the
    // other direction. See `lib/orders/pending-payment-lock.ts`.
    const pendingPaymentLock = getPendingPaymentLock(order);
    if (pendingPaymentLock && (status || paymentStatus)) {
      throw new ValidationError(pendingPaymentLock);
    }

    const currentSubStatus = order.subOrders[subOrderIndex].status as string;

    // A vendor marks THEIR OWN consignment collected, never the order. On a
    // split order the sibling's cash is still outstanding, and saying
    // otherwise told the courier to stop collecting it
    // (`lib/shipping/carriers/build-request.ts`), unlocked the sibling's
    // digital files and opened a payout on money that had never arrived.
    if (paymentStatus === PAYMENT_STATUS.PAID) {
      // Called-off goods were never handed over, so there is no money to
      // report: marking one paid posted a sale and commission against goods
      // that never left, and unlocked its digital files.
      if (
        currentSubStatus === ORDER_STATUS.CANCELLED ||
        order.status === ORDER_STATUS.CANCELLED ||
        status === ORDER_STATUS.CANCELLED
      ) {
        throw new ValidationError("A cancelled order cannot be marked as paid");
      }

      // Custody gate. "Mark as paid" is a vendor reporting money they are
      // holding — cash over their counter, COD from their own hands. When the
      // money settles onto the PLATFORM's gateway credentials, the vendor
      // never touches it and has nothing to report: only the gateway (or an
      // admin reconciling it) can say it arrived. Without this a vendor could
      // mark a card order paid that never captured, and — now that the payout
      // filter admits `partially_paid` — collect on it.
      if (isPlatformSettled(order, order.subOrders[subOrderIndex])) {
        throw new ValidationError(
          String(order.paymentMethod || "").toLowerCase() === "cod"
            ? "This delivery is collected by the store's courier, so the store records the payment — not the vendor."
            : "This order is settled through the store's payment gateway. Its payment status is set by the gateway, not by the vendor.",
        );
      }

      const currentSubPayment = resolveSubOrderPaymentStatus(
        order,
        order.subOrders[subOrderIndex],
      );
      if (
        currentSubPayment !== PAYMENT_STATUS.PENDING &&
        currentSubPayment !== PAYMENT_STATUS.PARTIALLY_PAID
      ) {
        throw new ValidationError("Only unpaid orders can be marked as paid");
      }
      order.subOrders[subOrderIndex].paymentStatus = PAYMENT_STATUS.PAID;
      order.subOrders[subOrderIndex].paidAt = new Date();
      // The first money on the order, if this is it.
      if (!order.paidAt) order.paidAt = order.subOrders[subOrderIndex].paidAt;
      order.subOrders[subOrderIndex].paymentCollectedBy = session.user.id;
      order.paymentStatus = deriveOrderPaymentStatus(order);
    }

    // The status change itself — the pickup rule, the workflow, a waiting
    // pre-order's release, the payment gate, the address hold, the
    // consignment's move with its tracking mirrored onto the order, and the
    // order's status rolled up from its consignments — is the shared
    // order-actions module's (lib/orders/order-actions.ts), which the admin
    // route and the business app take too. The payment written above rides
    // in the same save.
    const actor: OrderActor = { userId: session.user.id, email: session.user.email };
    const seller: ConsignmentVendor = {
      id: String(vendor._id),
      storeName: vendor.storeName || undefined,
    };
    const change: ConsignmentChange = { status, trackingNumber, carrier };
    const plan = await prepareConsignmentChange({
      order: order as unknown as OrderDocumentLike,
      before,
      subOrderIndex,
      change,
      actor,
      hasOtherChanges: paymentStatus !== undefined,
    });
    if (plan.kind === "released") {
      return successResponse({
        ...toVendorOrderView(plan.order, vendor._id),
        outcome: plan.outcome.kind,
        outcomeMessage: preparationMessage(plan.outcome, "vendor"),
      });
    }
    const { facts } = plan;

    // Written only over the order exactly as it was read: any status on it
    // that moved in between makes this save match nothing, and the vendor
    // is asked to look again.
    await saveConsignmentChange(order as unknown as OrderDocumentLike, before);

    // The consignment's stock and pre-order places back on a cancel, its
    // labels voided; and the last parcel of a cash order delivered IS the
    // collection, when the cash was the vendor's to confirm.
    await settleConsignmentChange({
      order: order as unknown as OrderDocumentLike,
      change,
      facts,
      vendor: seller,
    });

    // A vendor marking a cash order collected is the moment that money became
    // real, and it is the ONLY moment for a COD or pickup sale — no gateway
    // webhook is ever going to arrive. Without this the charge row stayed
    // "pending" forever: the order read as paid while the ledger disagreed, and
    // a later refund landed against a charge that never succeeded.
    //
    // Gated on the ORDER reaching paid, which on a split order means the last
    // vendor collecting. A charge row is one row per order carrying the order
    // total, and tax and discounts are not apportioned per consignment — so
    // writing one when the first of three vendors collects would book the full
    // order value against a third of the money. The alternative, inventing an
    // allocation, would put a number in the ledger that no sub-order can
    // justify. Partial collection lives on the sub-orders until it is whole.
    //
    // Mirrors the admin route's equivalent. Never fails the request — the
    // status change is the vendor's action and has already been saved; a
    // ledger row that failed to write is a reconcilable gap, not a reason to
    // tell them their collection did not register.
    //
    // The LEDGER is not gated the same way, because it does apportion: entries
    // are keyed and sized per consignment, so this vendor's collection posts
    // this vendor's sale and the sibling's posts when it happens. Waiting for
    // the whole order left a payout — which the filter admits on a part-paid
    // order — debiting a payable no sale had ever credited.
    if (paymentStatus === PAYMENT_STATUS.PAID) {
      const { postOrderPaidSafely } = await import("@/lib/finance/post-events");
      postOrderPaidSafely(order._id);
    }

    // The rest of the change: the charge row, the points and the customer's
    // stats when the order just became paid; the shopper told when the ORDER
    // moved; the coupon's use back when the order was cancelled; auto-shipping
    // kicked; the audit rows naming the vendor's own move and the order's.
    const auditContext = createAuditContext(request, session);
    await completeConsignmentChange({
      order: order as unknown as OrderDocumentLike,
      change,
      facts,
      actor,
      vendor: seller,
      audit: auditContext,
    });

    await auditUpdate(
      auditContext,
      "order",
      id,
      before,
      order.toObject() as unknown as Record<string, unknown>,
    );

    // A vendor calling off a consignment the shopper already paid for sends
    // that consignment's share back. Reported, never thrown: the
    // cancellation has been saved and stands either way.
    const refund =
      status === "cancelled" && currentSubStatus !== "cancelled"
        ? await refundCancelledConsignment({
            order: order as unknown as OrderDocumentLike,
            facts,
            actor,
            vendor: seller,
            audit: auditContext,
          })
        : undefined;

    // This vendor's view of the order, never the document — see the helper.
    const view = toVendorOrderView(order, vendor._id);
    return successResponse(refund ? { ...view, refund } : view);
  },
);
