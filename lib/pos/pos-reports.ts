import "server-only";

import { Types, type PipelineStage } from "mongoose";
import { InventoryLocation, Order, User } from "@/models";
import { PosRegisterSession, type IPosRegisterSession } from "@/models/pos-register-session.model";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { canAccessPOS } from "@/lib/access/rbac";
import { isStaffRole } from "@/lib/access/staff-role";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { buildStaffOrderScopeFilter, mergeScopeFilter } from "@/lib/access/staff-scope";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { USER_ROLES } from "@/config/app.config";
import { quantizeToCurrency } from "@/lib/intl/money";
import { registerSessionTotals, registerVendorScope } from "@/lib/pos/register-session";
import { listPOSLocations } from "@/lib/pos/list-locations";

/**
 * Till reports: what each cashier and each counter sold over a period, the
 * money taken by tender, and the drawers opened in it with how their counts
 * came out.
 *
 * Who sees what:
 * - an administrator: every counter sale;
 * - a staff member with "manage POS": the sales inside their order scope, and
 *   the drawers at their assigned counters;
 * - a seller: the sales rung up entirely of their own goods — their own tills'
 *   sales — and their own drawers. A mixed sale at the store's counter is the
 *   store's to report.
 *
 * Sales are counted when they were rung up (`createdAt`), cancelled ones left
 * out. Tenders are counted when the money came in (`posTenders.collectedAt`),
 * so a deposit's balance paid this week is this week's money even though the
 * sale was last week's — the same rule as the drawer's own count.
 */

export interface POSReportScope {
  /** The orders this person's report may read. */
  orders: Record<string, unknown>;
  /** The merchant whose drawers they see ("" the store's own). */
  vendorScope: string;
  /** Counters a staff member is held to; empty is every counter. */
  locationIds: string[];
}

export async function posReportScope(user: {
  id: string;
  role?: string | null;
  roles?: (string | null | undefined)[] | null;
}): Promise<POSReportScope> {
  const role = user.role;
  if (!(await canAccessPOS({ id: user.id, role: role ?? undefined }))) throw new AuthorizationError();
  // Drawers are filed under the merchant the register sells for: the same
  // answer the drawer routes use (lib/pos/register-session.ts).
  const vendorScope = await registerVendorScope(user);
  if (role === USER_ROLES.ADMIN) return { orders: { channel: "pos" }, vendorScope, locationIds: [] };
  if (isStaffRole(role)) {
    const access = await assertAdminOrStaffPermissions(
      { user: { id: user.id, role: String(role) } },
      [STAFF_PERMISSIONS.MANAGE_POS],
    );
    const scope = access.staffScope;
    return {
      orders: scope ? mergeScopeFilter({ channel: "pos" }, buildStaffOrderScopeFilter(scope)) : { channel: "pos" },
      vendorScope,
      locationIds: scope?.locationIds ?? [],
    };
  }
  if (role === USER_ROLES.VENDOR) {
    const vendor = await requireApprovedVendorByUserId(user.id);
    const vendorId = vendor._id as Types.ObjectId;
    return {
      orders: {
        channel: "pos",
        "items.vendorId": vendorId,
        items: { $not: { $elemMatch: { vendorId: { $ne: vendorId } } } },
      },
      vendorScope,
      locationIds: [],
    };
  }
  throw new AuthorizationError();
}

export interface POSReportPeriod {
  from: Date;
  to: Date;
}

const MAX_PERIOD_MS = 367 * 24 * 60 * 60 * 1000;

export function parseReportPeriod(fromRaw?: string | null, toRaw?: string | null, now = new Date()): POSReportPeriod {
  const to = toRaw ? new Date(toRaw) : now;
  const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new ValidationError("Choose a valid period");
  if (from.getTime() >= to.getTime()) throw new ValidationError("The period must end after it starts");
  if (to.getTime() - from.getTime() > MAX_PERIOD_MS) throw new ValidationError("Choose a period of a year or less");
  return { from, to };
}

export interface POSReportRow {
  id: string;
  name: string;
  sales: number;
  items: number;
  gross: number;
  discounts: number;
  refunds: number;
  net: number;
  average: number;
  balanceDue: number;
}

export interface POSReportSession {
  id: string;
  number: string;
  status: "open" | "closed";
  counter: string;
  terminalId: string;
  openedBy: string;
  openedAt: string;
  closedBy?: string;
  closedAt?: string;
  openingFloat: number;
  salesCount: number;
  expectedCash: number;
  countedCash?: number;
  variance?: number;
}

export interface POSReport {
  currency: string;
  period: { from: string; to: string };
  totals: Omit<POSReportRow, "id" | "name">;
  byCashier: POSReportRow[];
  byCounter: POSReportRow[];
  byTender: Array<{ method: string; amount: number; count: number }>;
  sessions: POSReportSession[];
  counters: Array<{ id: string; name: string }>;
}

type GroupRow = {
  _id: unknown;
  sales: number;
  items: number;
  gross: number;
  discounts: number;
  refunds: number;
  balanceDue: number;
};

const GROUP_FIELDS = {
  sales: { $sum: 1 },
  items: { $sum: { $sum: "$items.quantity" } },
  gross: { $sum: "$total" },
  discounts: { $sum: { $ifNull: ["$discount", 0] } },
  refunds: { $sum: { $ifNull: ["$refundedTotal", 0] } },
  balanceDue: { $sum: { $ifNull: ["$posBalanceDue", 0] } },
};

function toRow(row: GroupRow, name: string, currency: string): POSReportRow {
  const money = (value: number) => quantizeToCurrency(Number(value) || 0, currency);
  const gross = money(row.gross);
  const refunds = money(row.refunds);
  return {
    id: row._id == null ? "" : String(row._id),
    name,
    sales: row.sales,
    items: row.items,
    gross,
    discounts: money(row.discounts),
    refunds,
    net: money(gross - refunds),
    average: row.sales ? money(gross / row.sales) : 0,
    balanceDue: money(row.balanceDue),
  };
}

export async function buildPOSReport(params: {
  user: { id: string; role?: string | null; roles?: (string | null | undefined)[] | null };
  period: POSReportPeriod;
  locationId?: string;
  currency: string;
}): Promise<POSReport> {
  const scope = await posReportScope(params.user);
  const { from, to } = params.period;
  // Orders file their counter as a plain string id.
  const locationId = String(params.locationId || "").trim().slice(0, 64);
  const locationFilter = locationId ? { posLocationId: locationId } : {};

  const salesMatch: PipelineStage.Match = {
    $match: {
      $and: [scope.orders, locationFilter, { createdAt: { $gte: from, $lt: to }, status: { $ne: "cancelled" } }],
    },
  };

  const [byCashierRaw, byCounterRaw, totalsRaw, tendersRaw] = await Promise.all([
    Order.aggregate<GroupRow>([salesMatch, { $group: { _id: "$staffId", ...GROUP_FIELDS } }, { $sort: { gross: -1 } }]),
    Order.aggregate<GroupRow>([salesMatch, { $group: { _id: "$posLocationId", ...GROUP_FIELDS } }, { $sort: { gross: -1 } }]),
    Order.aggregate<GroupRow>([salesMatch, { $group: { _id: null, ...GROUP_FIELDS } }]),
    // Money in by tender, when it came in. A sale from before split tenders
    // carries none: its one method paid its total when it was paid.
    Order.aggregate<{ _id: string; amount: number; count: number }>([
      {
        $match: {
          $and: [
            scope.orders,
            locationFilter,
            {
              $or: [
                { "posTenders.collectedAt": { $gte: from, $lt: to } },
                { posTenders: { $in: [null, []] }, paidAt: { $gte: from, $lt: to } },
              ],
            },
          ],
        },
      },
      {
        $project: {
          tenders: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$posTenders", []] } }, 0] },
              "$posTenders",
              [{ method: "$paymentMethod", amount: "$total", collectedAt: "$paidAt" }],
            ],
          },
        },
      },
      { $unwind: "$tenders" },
      { $match: { "tenders.collectedAt": { $gte: from, $lt: to } } },
      { $group: { _id: "$tenders.method", amount: { $sum: "$tenders.amount" }, count: { $sum: 1 } } },
      { $sort: { amount: -1 } },
    ]),
  ]);

  // Drawers opened in the period, at counters this person may see.
  const sessionFilter: Record<string, unknown> = {
    vendorId: scope.vendorScope,
    openedAt: { $gte: from, $lt: to },
  };
  if (locationId) sessionFilter.locationId = locationId;
  else if (scope.locationIds.length) sessionFilter.locationId = { $in: scope.locationIds };
  const sessions = await PosRegisterSession.find(sessionFilter)
    .sort({ openedAt: -1 })
    .limit(200)
    .lean<IPosRegisterSession[]>();
  // An open drawer's expected cash is worked out as it stands.
  const openTotals = new Map(
    await Promise.all(
      sessions
        .filter((session) => session.status === "open")
        .map(async (session) => [String(session._id), await registerSessionTotals(session)] as const),
    ),
  );

  const userIds = new Set<string>();
  for (const row of byCashierRaw) if (row._id) userIds.add(String(row._id));
  for (const session of sessions) {
    if (session.openedBy) userIds.add(session.openedBy);
    if (session.closedBy) userIds.add(session.closedBy);
  }
  const locationIds = new Set<string>();
  for (const row of byCounterRaw) if (row._id) locationIds.add(String(row._id));
  for (const session of sessions) if (session.locationId) locationIds.add(session.locationId);

  const [users, locations] = await Promise.all([
    User.find({ _id: { $in: [...userIds].filter((id) => Types.ObjectId.isValid(id)) } })
      .select("name email")
      .lean<Array<{ _id: unknown; name?: string; email?: string }>>(),
    InventoryLocation.find({ _id: { $in: [...locationIds].filter((id) => Types.ObjectId.isValid(id)) } })
      .select("name")
      .lean<Array<{ _id: unknown; name?: string }>>(),
  ]);
  const userName = (id?: unknown) => {
    const user = users.find((row) => String(row._id) === String(id ?? ""));
    return user?.name || user?.email || "";
  };
  const locationName = (id?: unknown) => locations.find((row) => String(row._id) === String(id ?? ""))?.name || "";

  const currency = params.currency;
  const totals = toRow(
    totalsRaw[0] ?? { _id: null, sales: 0, items: 0, gross: 0, discounts: 0, refunds: 0, balanceDue: 0 },
    "",
    currency,
  );
  const { id: _id, name: _name, ...totalsOnly } = totals;
  void _id;
  void _name;

  return {
    currency,
    period: { from: from.toISOString(), to: to.toISOString() },
    totals: totalsOnly,
    byCashier: byCashierRaw.map((row) => toRow(row, userName(row._id), currency)),
    byCounter: byCounterRaw.map((row) => toRow(row, locationName(row._id), currency)),
    byTender: tendersRaw.map((row) => ({
      method: String(row._id || "other"),
      amount: quantizeToCurrency(row.amount, currency),
      count: row.count,
    })),
    sessions: sessions.map((session) => {
      const live = openTotals.get(String(session._id));
      return {
        id: String(session._id),
        number: session.number,
        status: session.status,
        counter: locationName(session.locationId),
        terminalId: session.terminalId,
        openedBy: userName(session.openedBy),
        openedAt: new Date(session.openedAt).toISOString(),
        closedBy: session.closedBy ? userName(session.closedBy) : undefined,
        closedAt: session.closedAt ? new Date(session.closedAt).toISOString() : undefined,
        openingFloat: session.openingFloat,
        salesCount: session.closing?.salesCount ?? live?.salesCount ?? 0,
        expectedCash: session.closing?.expected.cash ?? live?.expectedCash ?? session.openingFloat,
        countedCash: session.closing?.counted.cash,
        variance: session.closing?.variance,
      };
    }),
    // The counters this person may filter by: the ones their registers may use.
    counters: (await listPOSLocations(params.user)).map((row) => ({ id: row.id, name: row.name })),
  };
}
