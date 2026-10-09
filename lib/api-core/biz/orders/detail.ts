import { Types } from "mongoose";
import { OrderDetail } from "@/contracts/mobile/biz/v1/orders";
import { DEFAULT_CURRENCY } from "@/config/branding.config";
import { grantCan } from "@/lib/api-core/biz/access";
import type { BizWorkspaceGrant } from "@/lib/api-core/biz/actor";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { orderScopeFilter, type BizScope } from "@/lib/api-core/biz/scope";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineBizRoute } from "@/lib/api-core/registry";
import { withRequestScope } from "@/lib/api/request-scope";
import { isValidObjectId } from "@/lib/api/validate";
import { customerIdOfOrder } from "@/lib/customers/business-customers";
import { connectDB } from "@/lib/db";
import { cancellationNeedsRefund, type OrderRecord } from "@/lib/orders/order-actions";
import { getOrderDetails, getOrderTimeline } from "@/lib/orders/order-details";
import { loadOrderShipmentTracking } from "@/lib/orders/order-shipment-view";
import { findVendorOrder, vendorOrderDetail } from "@/lib/vendors/vendor-order-detail";
import { Order, OrderComment } from "@/models";
import { AuditLog } from "@/models/audit-log.model";
import { buildCommentAudienceFilter, NOT_DELETED_ORDER_COMMENT_FILTER } from "@/models/order-comment.model";
import { getSettingsLean } from "@/models/settings.model";
import { toSellerOrderDetail, toStoreOrderDetail, type OrderPowers, type RawOrder, type RefundDue } from "./dto";

/** What this operator may do to orders here: the `actions` the answer offers. */
function powersOf(workspace: BizWorkspaceGrant): OrderPowers {
  return { edit: grantCan(workspace, "EDIT_ORDERS"), cancel: grantCan(workspace, "CANCEL_ORDERS") };
}

/**
 * Where cancelling the order, or one of its consignments, would send money
 * back: the action endpoint's own D-B2 check, so `actions` offers `cancel`
 * only where the app may make it. Nothing to work out for an operator who
 * may not cancel.
 */
function refundDueOn(order: OrderRecord, powers: OrderPowers, defaultCurrency: string | undefined): RefundDue {
  if (!powers.cancel) return { order: false, consignments: new Set() };
  return {
    order: cancellationNeedsRefund(order),
    consignments: new Set(
      (order.subOrders || [])
        .filter((sub) => cancellationNeedsRefund(order, { subOrderId: sub._id, defaultCurrency }))
        .map((sub) => String(sub._id)),
    ),
  };
}

/**
 * One order as this operator may see it, or null when it is not in their
 * reach (or is no order). GET /orders/{id} answers with it, and an order
 * action answers with it after the step (B3), so both say the same thing.
 *
 * A seller reads it through the website's vendor view; everyone else through
 * the dashboard's order details and timeline, with their staff scope. One
 * settings read for the request (`withRequestScope`).
 */
export function loadOrderDetail(
  orderId: string,
  context: { workspace: BizWorkspaceGrant; scope: BizScope },
): Promise<OrderDetail | null> {
  if (!isValidObjectId(orderId)) return Promise.resolve(null);
  const { workspace, scope } = context;
  const powers = powersOf(workspace);

  return withRequestScope(async () => {
    await connectDB();
    // The request's one settings read goes out beside the order's (the
    // tracking loader's own `getSettings()` shares it), not before it. The
    // parcels need only the order's id: read for an order out of reach, they
    // are dropped with it.
    const settingsRead = getSettingsLean();
    const trackingRead = loadOrderShipmentTracking({ orderId });

    if (scope.kind === "vendor" && workspace.workspace === "vendor") {
      if (!Types.ObjectId.isValid(scope.vendorId)) return null;
      const vendorId = new Types.ObjectId(scope.vendorId);
      const [settings, found, tracking] = await Promise.all([
        settingsRead,
        findVendorOrder(orderId, vendorId),
        trackingRead,
      ]);
      if (!found) return null;
      const detail = toSellerOrderDetail(
        await vendorOrderDetail(found, vendorId, settings),
        found.order as unknown as RawOrder,
        {
          storeCurrency: settings.general?.defaultCurrency || DEFAULT_CURRENCY,
          vendorName: workspace.vendor.name,
          tracking,
          powers,
          refundDue:
            powers.cancel &&
            cancellationNeedsRefund(found.order as unknown as OrderRecord, {
              subOrderId: found.subOrder._id,
              defaultCurrency: settings.general?.defaultCurrency,
            }),
        },
      );
      return withCustomerId(detail, found.order as unknown as RawOrder, workspace);
    }

    const staffScope = scope.kind === "staff" ? scope.staff : null;
    const [settings, order, timeline, tracking] = await Promise.all([
      settingsRead,
      getOrderDetails(orderId, staffScope) as Promise<RawOrder | null>,
      getOrderTimeline(orderId, staffScope),
      trackingRead,
    ]);
    if (!order) return null;
    const detail = toStoreOrderDetail(order, {
      storeCurrency: settings.general?.defaultCurrency || DEFAULT_CURRENCY,
      timeline,
      tracking,
      powers,
      refundDue: refundDueOn(order as unknown as OrderRecord, powers, settings.general?.defaultCurrency),
      vendorScoped: scope.kind === "staff" && scope.vendorOwned,
    });
    return withCustomerId(detail, order, workspace);
  });
}

/**
 * The order's customer, for an operator who may see customers: the id GET
 * /customers/{id} opens (lib/customers/business-customers.ts). An order in
 * reach makes its customer the operator's, so no further check is needed.
 */
async function withCustomerId(
  detail: OrderDetail,
  order: Pick<RawOrder, "customerId" | "guestEmail" | "channel" | "staffId">,
  workspace: BizWorkspaceGrant,
): Promise<OrderDetail> {
  if (!grantCan(workspace, "VIEW_ORDER_CUSTOMERS")) return detail;
  const id = await customerIdOfOrder(order);
  return id ? { ...detail, customer: { id, ...detail.customer } } : detail;
}

/**
 * The cheap version of GET /orders/{id}: the order's last change (scoped, so
 * an order out of reach has none), and for the store's operators the newest
 * note and audit event on its timeline. With what the operator may do, which
 * the answer's `actions` (and its customer's id) follow. One round trip: the timeline reads go out
 * beside the order's and are dropped when it is out of reach.
 */
async function orderVersion(
  orderId: string,
  context: { workspace: BizWorkspaceGrant; scope: BizScope },
): Promise<unknown> {
  if (!isValidObjectId(orderId)) return null;
  await connectDB();
  const { scope } = context;
  // Seeing customers decides whether the answer names its customer.
  const powers = { ...powersOf(context.workspace), customers: grantCan(context.workspace, "VIEW_ORDER_CUSTOMERS") };
  const readOrder = Order.findOne({ $and: [{ _id: orderId }, orderScopeFilter(scope)] })
    .select("updatedAt")
    .lean<{ updatedAt?: Date } | null>();
  if (scope.kind === "vendor") {
    const order = await readOrder;
    return order ? { order: order.updatedAt?.getTime() ?? 0, powers } : null;
  }

  const [order, note, event, notes] = await Promise.all([
    readOrder,
    OrderComment.findOne({ orderId })
      .sort({ updatedAt: -1 })
      .select("updatedAt")
      .lean<{ updatedAt?: Date } | null>(),
    AuditLog.findOne({ resource: "order", resourceId: orderId })
      .sort({ createdAt: -1 })
      .select("createdAt")
      .lean<{ createdAt?: Date } | null>(),
    OrderComment.countDocuments({
      orderId,
      ...NOT_DELETED_ORDER_COMMENT_FILTER,
      ...buildCommentAudienceFilter(scope.kind === "staff" ? scope.staff.vendorIds : null),
    }),
  ]);
  if (!order) return null;
  return {
    order: order.updatedAt?.getTime() ?? 0,
    note: note?.updatedAt?.getTime() ?? 0,
    notes,
    event: event?.createdAt?.getTime() ?? 0,
    powers,
  };
}

/** GET /orders/{id}: one order, as this operator may see and act on it. */
export const orderDetailRoute = defineBizRoute({
  id: "orders.detail",
  method: "GET",
  path: "/orders/{id}",
  auth: "user",
  ...BIZ_ACCESS.VIEW_ORDERS,
  cache: { kind: "private" },
  output: OrderDetail,
  validator: ({ params, workspace, scope }) => orderVersion(params.id, { workspace, scope }),
  handler: async ({ params, workspace, scope }) => {
    const order = await loadOrderDetail(params.id, { workspace, scope });
    if (!order) throw new MobileApiError(404, "NOT_FOUND", "Order not found.");
    return order;
  },
});
