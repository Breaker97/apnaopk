import { Types } from "mongoose";
import type { ORDER_LIST_TABS } from "@/contracts/mobile/biz/v1/orders";
import { ORDER_STATUS } from "@/config/app.config";
import { buildAdminOrderListFilter } from "@/lib/orders/order-list";
import { placedOrderMatch } from "@/lib/orders/order-payment-status";
import { buildVendorOrderListFilter } from "@/lib/vendors/vendor-order-list";
import type { BizScope } from "../scope";

/**
 * Which orders each tab of the business app's order list holds, as the
 * MongoDB filter for the request's scope. GET /orders lists them and GET
 * /home counts `needs_action` with the same filter, so the tile's number is
 * the tab's length.
 *
 * Built from the website's own list filters, so a tab means what the
 * dashboard's matching view means: a seller's through
 * `buildVendorOrderListFilter` (their consignment's status), everyone else's
 * through `buildAdminOrderListFilter` (the order's status, the staff scope).
 * Unlike the store's web table, no tab holds a checkout abandoned at a
 * payment gateway (`placedOrderMatch`): the sellers' list and every dashboard
 * figure already leave those out, and nobody has an action to take on one.
 */

export type OrderListTab = (typeof ORDER_LIST_TABS)[number];

/** A pre-order is still to ship in these. */
const PRE_ORDER_OPEN_STATUSES = [
  ORDER_STATUS.PREORDERED,
  ORDER_STATUS.PENDING,
  ORDER_STATUS.PROCESSING,
];

/** The web lists' own words for a tab, where they have one. */
function webListParams(tab: OrderListTab): { view?: string; status?: string } {
  switch (tab) {
    case "needs_action":
      return { view: "unfulfilled" };
    case "shipped":
    case "delivered":
    case "cancelled":
      return { status: tab };
    default:
      return {};
  }
}

const isEmpty = (filter: Record<string, unknown>) => Object.keys(filter).length === 0;

/** The tab's orders in this scope. Null when nothing can match. */
export function orderTabFilter(tab: OrderListTab, scope: BizScope): Record<string, unknown> | null {
  if (scope.kind === "vendor") {
    if (!Types.ObjectId.isValid(scope.vendorId)) return null;
    const vendorId = new Types.ObjectId(scope.vendorId);
    return buildVendorOrderListFilter(
      tab === "pre_orders"
        ? {
            consignment: {
              status: { $in: PRE_ORDER_OPEN_STATUSES },
              "items.purchaseType": "preorder",
            },
          }
        : webListParams(tab),
      vendorId,
    );
  }

  const conditions = [
    buildAdminOrderListFilter(webListParams(tab), scope.kind === "staff" ? scope.staff : null),
    placedOrderMatch(),
    ...(tab === "pre_orders" ? [{ hasPreorder: true, status: { $in: PRE_ORDER_OPEN_STATUSES } }] : []),
  ].filter((condition) => !isEmpty(condition));
  return conditions.length === 1 ? conditions[0]! : { $and: conditions };
}
