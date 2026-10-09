import { Types } from "mongoose";
import { Home, type HomeTile } from "@/contracts/mobile/biz/v1/home";
import {
  buildStaffOrderScopeFilter,
  hasStaffScope,
} from "@/lib/access/staff-scope";
import { getCollectedSales } from "@/lib/admin/dashboard-data";
import {
  resolveNamedPeriod,
  toDayString,
  type DashboardRange,
} from "@/lib/admin/dashboard-period";
import { BIZ_ACCESS, grantCan } from "@/lib/api-core/biz/access";
import type { BizWorkspaceGrant } from "@/lib/api-core/biz/actor";
import { bizConversationViewer } from "@/lib/api-core/biz/inbox/biz-inbox";
import { orderTabFilter } from "@/lib/api-core/biz/orders/tabs";
import { productScopeFilter, type BizScope } from "@/lib/api-core/biz/scope";
import type { MobileSession } from "@/lib/api-core/ports";
import { defineBizRoute } from "@/lib/api-core/registry";
import { toMoney } from "@/lib/api-core/shop/money";
import { countUnreadConversationMessages } from "@/lib/conversations/service";
import { connectDB } from "@/lib/db";
import { getStoreCurrency } from "@/lib/intl/server-currency";
import {
  LOW_STOCK_THRESHOLD,
  lowStockProductMatch,
} from "@/lib/inventory/low-stock";
import { staffOrderScopeMatch } from "@/lib/orders/order-list";
import { vendorReturnsFilter } from "@/lib/returns/return-stats";
import { buildVendorStaffReturnFilter } from "@/lib/returns/return-staff-scope";
import { OPEN_RETURN_STATUSES } from "@/lib/returns/returns";
import {
  getVendorCollectedByDay,
  getVendorCollectedSince,
} from "@/lib/vendors/vendor-order-metrics";
import { Order, Product, ReturnRequest } from "@/models";
import {
  buildCollectionTrend,
  collectionTrendRanges,
} from "./collection-trend";

/**
 * GET /home: the figures at the top of the business app (PLAN §10.1), each
 * read by the website's own rule so the app and the dashboards never
 * disagree:
 *
 * - Collected today / this month: the dashboard's "Today" and "This month"
 *   periods (UTC, D-B4). The store's: the admin dashboard's money rule
 *   (`getCollectedSales`), within a staff member's scope. A seller's
 *   workspace: the vendor dashboard's "Total revenue" rule
 *   (`getVendorCollectedSince`), for the seller and their staff alike.
 * - Orders needing action: the order list's `needs_action` tab, counted.
 * - Low stock: `lib/inventory/low-stock.ts`, in the product scope.
 * - Open returns: what the returns lists show, still open.
 * - Unread messages: the inbox's own count, for the workspace's viewer.
 *
 * Each tile only with the capability that opens what it counts. Nothing is
 * cached: orders move from checkout, the till and webhooks. The ETag is the
 * answer's own, so unchanged figures cost no transfer.
 */

/** What the dashboard's periods mean at `now`. */
function homeWindows(now: Date): {
  today: DashboardRange;
  month: DashboardRange;
} {
  return {
    today: resolveNamedPeriod("today", now)!,
    month: resolveNamedPeriod("month", now)!,
  };
}

/** Collected today and this month in this workspace. */
async function collected(
  workspace: BizWorkspaceGrant,
  scope: BizScope,
  windows: { today: DashboardRange; month: DashboardRange },
  storeCurrency: string,
): Promise<[number, number]> {
  if (workspace.workspace === "vendor") {
    return Promise.all([
      getVendorCollectedSince(workspace.vendor.id, windows.today.from),
      getVendorCollectedSince(workspace.vendor.id, windows.month.from),
    ]);
  }
  const scopeMatch =
    scope.kind === "staff" ? staffOrderScopeMatch(scope.staff) : {};
  const [today, month] = await getCollectedSales(
    [windows.today, windows.month],
    scopeMatch,
    storeCurrency,
  );
  return [today ?? 0, month ?? 0];
}

async function countNeedingAction(scope: BizScope): Promise<number> {
  const filter = orderTabFilter("needs_action", scope);
  return filter ? Order.countDocuments(filter) : 0;
}

function countLowStock(scope: BizScope): Promise<number> {
  return Product.countDocuments({
    $and: [lowStockProductMatch(), productScopeFilter(scope)],
  });
}

/**
 * Open returns as the returns lists show them: a seller's own (the vendor
 * returns page's filter); a seller's staff their seller's; the store's staff
 * those on orders in their scope (the admin list's rule, checked on the
 * orders); everyone else all.
 */
async function countOpenReturns(scope: BizScope): Promise<number> {
  const open = { status: { $in: OPEN_RETURN_STATUSES } };
  if (scope.kind === "store") return ReturnRequest.countDocuments(open);
  if (scope.kind === "vendor") {
    if (!Types.ObjectId.isValid(scope.vendorId)) return 0;
    return ReturnRequest.countDocuments({
      $and: [open, vendorReturnsFilter(new Types.ObjectId(scope.vendorId))],
    });
  }
  const conditions: Record<string, unknown>[] = [open];
  if (scope.vendorOwned)
    conditions.push(buildVendorStaffReturnFilter(scope.staff));
  if (!hasStaffScope(scope.staff))
    return ReturnRequest.countDocuments({ $and: conditions });

  const returns = await ReturnRequest.find({ $and: conditions })
    .select("orderId")
    .lean<Array<{ orderId?: unknown }>>();
  if (returns.length === 0) return 0;
  const visible = await Order.find({
    _id: { $in: [...new Set(returns.map((row) => String(row.orderId)))] },
    ...buildStaffOrderScopeFilter(scope.staff),
  })
    .select("_id")
    .lean<Array<{ _id: unknown }>>();
  const allowed = new Set(visible.map((order) => String(order._id)));
  return returns.filter((row) => allowed.has(String(row.orderId))).length;
}

/** The Home figures for this operator in this workspace, at `now`. */
export async function readHome(context: {
  workspace: BizWorkspaceGrant;
  scope: BizScope;
  session: MobileSession;
  now?: Date;
}): Promise<Home> {
  const { workspace, scope, session } = context;
  const windows = homeWindows(context.now ?? new Date());
  const days = collectionTrendRanges(windows.today);
  const orders = grantCan(workspace, "VIEW_ORDERS");
  const products = grantCan(workspace, "VIEW_PRODUCTS");
  const inbox = grantCan(workspace, "VIEW_INBOX");
  const returns = grantCan(workspace, "VIEW_RETURNS");

  await connectDB();
  // Cached with the settings (no read in the steady state): the collected
  // scan then needs no settings read of its own.
  const currency = await getStoreCurrency();
  const [money, needingAction, lowStock, openReturns, unread, daily] =
    await Promise.all([
      orders ? collected(workspace, scope, windows, currency.code) : null,
      orders ? countNeedingAction(scope) : null,
      products ? countLowStock(scope) : null,
      returns ? countOpenReturns(scope) : null,
      inbox
        ? countUnreadConversationMessages({
            viewer: bizConversationViewer(session, workspace),
          })
        : null,
      orders
        ? workspace.workspace === "vendor"
          ? getVendorCollectedByDay(workspace.vendor.id, {
              from: days[0].from,
              to: days[6].to,
            }).then((values) =>
              days.map((day) => values.get(toDayString(day.from)) ?? 0),
            )
          : getCollectedSales(
              days,
              scope.kind === "staff" ? staffOrderScopeMatch(scope.staff) : {},
              currency.code,
            )
        : null,
    ]);

  const tiles: HomeTile[] = [];
  if (money) {
    tiles.push({ kind: "COLLECTED_TODAY", money: toMoney(money[0], currency) });
    tiles.push({
      kind: "COLLECTED_THIS_MONTH",
      money: toMoney(money[1], currency),
    });
  }
  if (needingAction !== null)
    tiles.push({ kind: "ORDERS_NEEDING_ACTION", count: needingAction });
  if (unread !== null) tiles.push({ kind: "UNREAD_MESSAGES", count: unread });
  if (lowStock !== null) tiles.push({ kind: "LOW_STOCK", count: lowStock });
  if (openReturns !== null)
    tiles.push({ kind: "OPEN_RETURNS", count: openReturns });

  return {
    day: toDayString(windows.today.from),
    lowStockThreshold: LOW_STOCK_THRESHOLD,
    tiles,
    ...(daily
      ? {
          collectionTrend: buildCollectionTrend(days, daily, (amount) =>
            toMoney(amount, currency),
          ),
        }
      : {}),
  };
}

/** GET /home */
export const homeRoute = defineBizRoute({
  id: "home",
  method: "GET",
  path: "/home",
  auth: "user",
  ...BIZ_ACCESS.workspace,
  cache: { kind: "private" },
  etag: true,
  output: Home,
  handler: ({ workspace, scope, session }) =>
    readHome({ workspace, scope, session }),
});
