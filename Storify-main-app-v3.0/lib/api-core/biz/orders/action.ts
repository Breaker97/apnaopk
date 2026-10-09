import { Types } from "mongoose";
import {
  ORDER_ACTION_REASONS,
  OrderActionRequest,
  OrderActionResult,
  type OrderActionReason,
  type OrderDetail,
} from "@/contracts/mobile/biz/v1/orders";
import { ORDER_STATUS } from "@/config/app.config";
import { buildStaffOrderScopeFilter } from "@/lib/access/staff-scope";
import { BIZ_ACCESS, assertCapability } from "@/lib/api-core/biz/access";
import type { BizWorkspaceGrant } from "@/lib/api-core/biz/actor";
import { bizAppAuditContext } from "@/lib/api-core/biz/audit-context";
import { orderScopeFilter, type BizScope } from "@/lib/api-core/biz/scope";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineBizRoute } from "@/lib/api-core/registry";
import type { MobileSession } from "@/lib/api-core/ports";
import { ApiError, ConflictError, NotFoundError } from "@/lib/api/errors";
import { withRequestScope } from "@/lib/api/request-scope";
import { isValidObjectId } from "@/lib/api/validate";
import type { AuditContext } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import { cancelConsignment } from "@/lib/orders/consignment-cancel";
import {
  ORDER_ACTION_REASONS as LIB_REASONS,
  cancellationNeedsRefund,
  changeConsignmentStatus,
  changeWholeOrderStatus,
  orderActionReason,
  type ConsignmentChange,
  type OrderActor,
  type OrderDocumentLike,
  type OrderRecord,
  type PaymentAsRead,
  type WholeOrderChange,
} from "@/lib/orders/order-actions";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import { loadOrderDetail } from "./detail";

/**
 * POST /orders/{id}/actions: the workflow's next step, by whoever may take it
 * (PLAN §9).
 *
 * Who moves what, as on the website:
 * - an administrator or the store's staff move the whole order (the admin
 *   order page's status path), or with `consignmentId` and `cancel` call off
 *   one seller's part of a split order (the store's consignment cancel);
 * - a seller's staff move their seller's whole orders only, never one
 *   consignment of a split order (`OTHER_SELLERS_ITEMS`);
 * - a seller moves their own consignment (the vendor order page's path),
 *   and never sends `consignmentId`.
 *
 * Every step is lib/orders/order-actions.ts's, the same code the website's
 * routes run: the lock, the workflow, the payment gate, the address hold, the
 * race, the restock, the pre-order release, the labels, the coupon, the
 * shopper's notification, auto-shipping and the audit row. Its refusals come
 * back by reason; the race comes back 409 `ORDER_STATE_CHANGED` with the
 * order as it stands, so the app can show it and say so.
 *
 * `cancel` from the app never refunds (D-B2): an order, or a consignment,
 * that has taken money is refused with `CANCEL_NEEDS_REFUND` before anything
 * moves, and is cancelled on the website, where the refund is made. The
 * cancel's write also requires the payment status that check read, so a
 * payment landing in between (Pay now, a webhook) is answered
 * `ORDER_STATE_CHANGED`, never cancelled and refunded. An unpaid cancel
 * restocks, hands the coupon's use back and tells the shopper, as the
 * website's does.
 *
 * `Idempotency-Key` is required (the pipeline replays the first answer), so
 * a retry moves no stock, sends no notification and makes no audit row twice.
 */

/** The contract's reason for each of the library's. */
const CONTRACT_REASON: Record<(typeof LIB_REASONS)[keyof typeof LIB_REASONS], OrderActionReason> = {
  [LIB_REASONS.paymentInFlight]: "PAYMENT_IN_FLIGHT",
  [LIB_REASONS.transitionNotAllowed]: "TRANSITION_NOT_ALLOWED",
  [LIB_REASONS.paymentNotReceived]: "PAYMENT_NOT_RECEIVED",
  [LIB_REASONS.paymentRefunded]: "PAYMENT_REFUNDED",
  [LIB_REASONS.preorderBalanceDue]: "PREORDER_BALANCE_DUE",
  [LIB_REASONS.preorderNotReady]: "PREORDER_NOT_READY",
  [LIB_REASONS.addressOnHold]: "ADDRESS_ON_HOLD",
  [LIB_REASONS.pickupConsignment]: "PICKUP_CONSIGNMENT",
  [LIB_REASONS.orderStateChanged]: "ORDER_STATE_CHANGED",
  [LIB_REASONS.otherSellersItems]: "OTHER_SELLERS_ITEMS",
};

const ORDER_NOT_FOUND = () => new MobileApiError(404, "NOT_FOUND", "Order not found.");

const CANCEL_NEEDS_REFUND_MESSAGE =
  "This order has taken payment, so cancelling it means a refund. Cancel it on the website's dashboard, where the refund is made.";

function cancelNeedsRefund(): MobileApiError {
  return new MobileApiError(409, "CONFLICT", CANCEL_NEEDS_REFUND_MESSAGE, {
    reason: "CANCEL_NEEDS_REFUND",
  });
}

/**
 * D-B2 on the order as read: refused when cancelling it (or one consignment
 * of it) would send money back. Otherwise the payment status the check read,
 * for the cancel's write to require unchanged.
 */
async function refundFreeCancel(before: OrderRecord, subOrderId?: unknown): Promise<PaymentAsRead> {
  if (subOrderId === undefined) {
    if (cancellationNeedsRefund(before)) throw cancelNeedsRefund();
    return { paymentStatus: before.paymentStatus ?? null };
  }
  const settings = await getSettings();
  if (cancellationNeedsRefund(before, { subOrderId, defaultCurrency: settings.general?.defaultCurrency })) {
    throw cancelNeedsRefund();
  }
  const consignment = (before.subOrders || []).find((sub) => String(sub._id) === String(subOrderId));
  return { paymentStatus: before.paymentStatus ?? null, consignmentPaymentStatus: consignment?.paymentStatus ?? null };
}

function validation(message: string, field: string): MobileApiError {
  return new MobileApiError(400, "VALIDATION_ERROR", message, { errors: { [field]: [message] } });
}

/** The workflow status each action moves to. */
const TARGET_STATUS = {
  mark_processing: ORDER_STATUS.PROCESSING,
  mark_shipped: ORDER_STATUS.SHIPPED,
  mark_delivered: ORDER_STATUS.DELIVERED,
  cancel: ORDER_STATUS.CANCELLED,
} as const;

/**
 * The change an action asks for: its target status and, for `mark_shipped`,
 * the parcel's carrier and tracking number, which the app must send (the
 * website lets an administrator ship without them; the app's "mark shipped"
 * asks for both, TDD §10).
 */
function toChange(input: OrderActionRequest): WholeOrderChange {
  const status = TARGET_STATUS[input.action];
  if (input.action === "mark_shipped") {
    if (!input.carrier || !input.trackingNumber) {
      throw new MobileApiError(400, "VALIDATION_ERROR", "Say which carrier has the parcel and its tracking number.", {
        reason: "TRACKING_REQUIRED",
        errors: {
          ...(input.carrier ? {} : { carrier: ["Send the carrier."] }),
          ...(input.trackingNumber ? {} : { trackingNumber: ["Send the tracking number."] }),
        },
      });
    }
    return { status, carrier: input.carrier, trackingNumber: input.trackingNumber };
  }
  if (input.action === "cancel") return { status, cancelReason: input.reason };
  return { status };
}

function actorFor(session: MobileSession, scope: BizScope): OrderActor {
  return {
    userId: session.user.id,
    email: session.user.email,
    ...(scope.kind === "staff" ? { staffScope: scope.staff, vendorOwned: scope.vendorOwned } : {}),
  };
}

/** The order as the app shows it after the step: the same read GET /orders/{id} makes. */
async function orderAfter(orderId: string, context: { workspace: BizWorkspaceGrant; scope: BizScope }): Promise<OrderDetail> {
  const order = await loadOrderDetail(orderId, context);
  if (!order) throw ORDER_NOT_FOUND();
  return order;
}

/**
 * The library's refusal, as the contract words it. The race carries the
 * order as it stands now, so the app can show it.
 */
async function toMobileError(
  error: unknown,
  context: { orderId: string; workspace: BizWorkspaceGrant; scope: BizScope },
): Promise<unknown> {
  const reason = orderActionReason(error);
  const message = error instanceof Error ? error.message : "The order could not be changed.";
  if (reason === LIB_REASONS.orderStateChanged) {
    const current = await loadOrderDetail(context.orderId, context);
    return new MobileApiError(409, "CONFLICT", "Somebody else changed this order first.", {
      reason: "ORDER_STATE_CHANGED",
      ...(current ? { details: { order: current } } : {}),
    });
  }
  if (reason === LIB_REASONS.otherSellersItems) {
    return new MobileApiError(403, "AUTHORIZATION_ERROR", message, { reason: "OTHER_SELLERS_ITEMS" });
  }
  if (reason) return new MobileApiError(409, "CONFLICT", message, { reason: CONTRACT_REASON[reason] });
  // A pre-order the release service would not release yet: its stock is not
  // in, or another change to it is in progress (lib/orders/preorder-action-responses.ts).
  if (error instanceof ConflictError) {
    return new MobileApiError(409, "CONFLICT", message, { reason: "PREORDER_NOT_READY" });
  }
  if (error instanceof NotFoundError) return ORDER_NOT_FOUND();
  // Anything else the website's routes answer (a 503 while the database
  // cannot allocate, a validation the contract has no reason for) goes out
  // with its own status, as the pipeline maps web errors.
  if (error instanceof ApiError) return error;
  return error;
}

/** The store's operators calling off one seller's part of a split order. */
async function cancelOneConsignment(params: {
  input: OrderActionRequest;
  before: OrderRecord;
  workspace: BizWorkspaceGrant;
  scope: BizScope;
  session: MobileSession;
  audit: AuditContext;
}): Promise<void> {
  const { input, before, workspace, scope, session, audit } = params;
  if (input.action !== "cancel") {
    throw validation("consignmentId goes only with cancel: the other steps move the whole order.", "consignmentId");
  }
  if (scope.kind === "staff" && scope.vendorOwned) {
    throw validation("A seller's staff act on the whole order: leave consignmentId out.", "consignmentId");
  }
  const subOrderId = String(input.consignmentId);
  if (!isValidObjectId(subOrderId) || !(before.subOrders || []).some((sub) => String(sub._id) === subOrderId)) {
    throw new MobileApiError(404, "NOT_FOUND", "Consignment not found.");
  }
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 3) {
    throw validation("Say why the consignment is cancelled.", "reason");
  }
  assertCapability(workspace, "CANCEL_ORDERS");
  const paymentAsRead = await refundFreeCancel(before, subOrderId);
  await cancelConsignment({
    orderId: String(before._id),
    subOrderId,
    reason,
    override: false,
    actorUserId: session.user.id,
    actorLabel: session.user.email || session.user.id,
    auditContext: audit,
    scopeFilter: buildStaffOrderScopeFilter(scope.kind === "staff" ? scope.staff : null),
    paymentAsRead,
  });
}

/** A seller moving their own consignment. */
async function moveOwnConsignment(params: {
  input: OrderActionRequest;
  before: OrderRecord;
  workspace: Extract<BizWorkspaceGrant, { workspace: "vendor" }>;
  scope: Extract<BizScope, { kind: "vendor" }>;
  session: MobileSession;
  audit: AuditContext;
}): Promise<void> {
  const { input, before, workspace, scope, session, audit } = params;
  const vendorId = new Types.ObjectId(scope.vendorId);
  const own = (before.subOrders || []).find((sub) => String(sub.vendorId) === scope.vendorId);
  if (!own) throw ORDER_NOT_FOUND();
  if (input.consignmentId !== undefined && input.consignmentId !== String(own._id)) {
    throw validation("A seller acts on their own consignment: leave consignmentId out.", "consignmentId");
  }
  const change: ConsignmentChange = toChange(input);
  let paymentAsRead: PaymentAsRead | undefined;
  if (input.action === "cancel") {
    assertCapability(workspace, "CANCEL_ORDERS");
    paymentAsRead = await refundFreeCancel(before, own._id);
  }
  // The document, as the website's vendor route moves it: the consignment's
  // status and the order's roll-up are saved together over what was read.
  const order = (await Order.findOne({ _id: before._id, "subOrders.vendorId": vendorId })) as OrderDocumentLike | null;
  if (!order) throw ORDER_NOT_FOUND();
  const subOrderIndex = order.subOrders.findIndex((sub) => String(sub.vendorId) === scope.vendorId);
  if (subOrderIndex === -1) throw ORDER_NOT_FOUND();
  await changeConsignmentStatus({
    order,
    subOrderIndex,
    change,
    actor: actorFor(session, scope),
    vendor: { id: scope.vendorId, storeName: workspace.vendor.name || undefined },
    audit,
    paymentAsRead,
  });
}

/** An administrator, the store's staff or a seller's staff moving the whole order. */
async function moveWholeOrder(params: {
  input: OrderActionRequest;
  before: OrderRecord;
  workspace: BizWorkspaceGrant;
  scope: BizScope;
  session: MobileSession;
  audit: AuditContext;
}): Promise<void> {
  const { input, before, workspace, scope, session, audit } = params;
  const change = toChange(input);
  let paymentAsRead: PaymentAsRead | undefined;
  if (input.action === "cancel") {
    assertCapability(workspace, "CANCEL_ORDERS");
    paymentAsRead = await refundFreeCancel(before);
  }
  await changeWholeOrderStatus({ order: before, change, actor: actorFor(session, scope), audit, paymentAsRead });
}

export const orderActionRoute = defineBizRoute({
  id: "orders.action",
  method: "POST",
  path: "/orders/{id}/actions",
  auth: "user",
  ...BIZ_ACCESS.EDIT_ORDERS,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:orders:action", preset: "moderate" },
  demo: "default",
  idempotency: "required",
  input: OrderActionRequest,
  output: OrderActionResult,
  reasons: { values: ORDER_ACTION_REASONS },
  handler: async ({ input, params, workspace, scope, session, client, requestId, locale }) => {
    const orderId = params.id;
    if (!isValidObjectId(orderId)) throw ORDER_NOT_FOUND();
    const audit = bizAppAuditContext({
      session,
      client,
      requestId,
      locale,
      method: "POST",
      path: `/orders/${orderId}/actions`,
      // A seller's row names their shop, as the vendor order page's does,
      // without the lookup `audit()` would make for it.
      vendorId: workspace.kind === "vendor" ? workspace.vendor.id : undefined,
    });

    return withRequestScope(async () => {
      await connectDB();
      const before = (await Order.findOne({ $and: [{ _id: orderId }, orderScopeFilter(scope)] }).lean()) as OrderRecord | null;
      if (!before) throw ORDER_NOT_FOUND();

      try {
        if (scope.kind === "vendor" && workspace.workspace === "vendor") {
          await moveOwnConsignment({ input, before, workspace, scope, session, audit });
        } else if (input.consignmentId !== undefined) {
          await cancelOneConsignment({ input, before, workspace, scope, session, audit });
        } else {
          await moveWholeOrder({ input, before, workspace, scope, session, audit });
        }
      } catch (error) {
        throw await toMobileError(error, { orderId, workspace, scope });
      }

      return { order: await orderAfter(orderId, { workspace, scope }) };
    });
  },
});
