import "server-only";

import { Types } from "mongoose";
import { Order } from "@/models";
import {
  PosRegisterSession,
  type IPosRegisterSession,
  type IPosTenderTotals,
  type POSCashEventKind,
} from "@/models/pos-register-session.model";
import { getNextSequence } from "@/models/counter.model";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { canAccessPOS } from "@/lib/access/rbac";
import { resolveLocationScope } from "@/lib/inventory/inventory-location-scope";
import { quantizeToCurrency } from "@/lib/intl/money";

/**
 * Register sessions: a till's drawer from opening to closing, with what it
 * should hold worked out from the sales and cash movements tagged with it.
 * See models/pos-register-session.model.ts.
 */

export type SessionUser = { id: string; role?: string | null; roles?: (string | null | undefined)[] | null };

/** The merchant a register sells for — the session's owner. */
export async function registerVendorScope(user: SessionUser): Promise<string> {
  if (!(await canAccessPOS({ id: user.id, role: user.role ?? undefined }))) {
    throw new AuthorizationError();
  }
  const scope = await resolveLocationScope(
    { id: user.id, role: user.role ?? undefined, roles: user.roles ?? undefined },
    "write",
  );
  return String(scope.vendorId ?? "");
}

const REQUEST_KEY = /^[A-Za-z0-9_-]{8,64}$/;
function assertRequestKey(value: string) {
  if (!REQUEST_KEY.test(value)) throw new ValidationError("The request key is missing or malformed");
}

function assertTerminalId(value: string) {
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(value)) throw new ValidationError("This register has no device id");
}

export async function findOpenSession(vendorId: string, terminalId: string) {
  return PosRegisterSession.findOne({ vendorId, terminalId, status: "open" }).lean<IPosRegisterSession | null>();
}

export async function loadSession(vendorId: string, sessionId: string) {
  if (!Types.ObjectId.isValid(sessionId)) throw new NotFoundError("Register session");
  const session = await PosRegisterSession.findOne({ _id: sessionId, vendorId }).lean<IPosRegisterSession | null>();
  if (!session) throw new NotFoundError("Register session");
  return session;
}

/**
 * Open this device's drawer with a float. Idempotent on the request key; a
 * device that already has an open drawer gets that one back rather than a
 * second, so two taps on "Open register" cannot split the takings.
 */
export async function openRegisterSession(params: {
  vendorId: string;
  terminalId: string;
  locationId?: string;
  openingFloat: number;
  currency: string;
  openedBy: string;
  requestId: string;
  now?: Date;
}): Promise<{ session: IPosRegisterSession; created: boolean }> {
  assertRequestKey(params.requestId);
  assertTerminalId(params.terminalId);
  const openingFloat = quantizeToCurrency(Number(params.openingFloat) || 0, params.currency);
  if (!(openingFloat >= 0)) throw new ValidationError("The opening float cannot be negative");

  const replay = await PosRegisterSession.findOne({ openRequestId: params.requestId }).lean<IPosRegisterSession | null>();
  if (replay) return { session: replay, created: false };
  const open = await findOpenSession(params.vendorId, params.terminalId);
  if (open) return { session: open, created: false };

  const seq = await getNextSequence("pos_register_session");
  try {
    const created = await PosRegisterSession.create({
      number: `REG-${String(seq).padStart(6, "0")}`,
      vendorId: params.vendorId,
      terminalId: params.terminalId,
      locationId: params.locationId || undefined,
      currency: params.currency.toUpperCase(),
      status: "open",
      openedBy: params.openedBy,
      openedAt: params.now ?? new Date(),
      openingFloat,
      openRequestId: params.requestId,
      cashEvents: [],
    });
    return { session: created.toObject() as IPosRegisterSession, created: true };
  } catch (error) {
    // Another tap won the race to open this device's drawer.
    if ((error as { code?: number })?.code === 11000) {
      const winner =
        (await PosRegisterSession.findOne({ openRequestId: params.requestId }).lean<IPosRegisterSession | null>()) ??
        (await findOpenSession(params.vendorId, params.terminalId));
      if (winner) return { session: winner, created: false };
    }
    throw error;
  }
}

/** Notes in or out of an open drawer — or out on a return. */
export async function addCashEvent(params: {
  vendorId: string;
  sessionId: string;
  kind: POSCashEventKind;
  amount: number;
  reason?: string;
  by: string;
  requestId: string;
  orderId?: unknown;
  returnNumber?: string;
  now?: Date;
}): Promise<IPosRegisterSession> {
  assertRequestKey(params.requestId);
  const session = await loadSession(params.vendorId, params.sessionId);
  if (session.cashEvents.some((event) => event.requestId === params.requestId)) return session;
  if (session.status !== "open") throw new ValidationError("This register is closed");
  const noSale = params.kind === "no_sale";
  const amount = noSale ? 0 : quantizeToCurrency(Number(params.amount) || 0, session.currency);
  if (!noSale && !(amount > 0)) throw new ValidationError("Enter an amount more than zero");
  const reason = String(params.reason || "").trim().slice(0, 300);
  if (params.kind !== "refund" && !reason) {
    throw new ValidationError(noSale ? "Say why the drawer is opening" : "Say why the cash is moving");
  }

  const updated = await PosRegisterSession.findOneAndUpdate(
    { _id: session._id, status: "open", "cashEvents.requestId": { $ne: params.requestId } },
    {
      $push: {
        cashEvents: {
          kind: params.kind,
          amount,
          reason: reason || undefined,
          by: params.by,
          at: params.now ?? new Date(),
          orderId:
            params.orderId && Types.ObjectId.isValid(String(params.orderId))
              ? new Types.ObjectId(String(params.orderId))
              : undefined,
          returnNumber: params.returnNumber,
          requestId: params.requestId,
        },
      },
    },
    { new: true },
  ).lean<IPosRegisterSession | null>();
  if (updated) return updated;
  return loadSession(params.vendorId, params.sessionId);
}

export interface RegisterSessionTotals {
  /** What the drawer took, tender by tender (applied amounts, not notes handed over). */
  tenders: IPosTenderTotals;
  salesCount: number;
  grossSales: number;
  cashIn: number;
  cashOut: number;
  refunds: number;
  /** Float + cash taken + in − out − refunded. */
  expectedCash: number;
}

const ZERO_TENDERS: IPosTenderTotals = { cash: 0, card: 0, bank: 0, manual: 0, store_credit: 0 };

/** What a session took and should hold, worked out now (the X report). */
export async function registerSessionTotals(session: IPosRegisterSession): Promise<RegisterSessionTotals> {
  const id = new Types.ObjectId(String(session._id));
  const [byTender, sales] = await Promise.all([
    Order.aggregate<{ _id: string; amount: number }>([
      { $match: { "posTenders.sessionId": id } },
      { $unwind: "$posTenders" },
      { $match: { "posTenders.sessionId": id } },
      { $group: { _id: "$posTenders.method", amount: { $sum: "$posTenders.amount" } } },
    ]),
    Order.aggregate<{ _id: null; count: number; gross: number }>([
      { $match: { posRegisterSessionId: id } },
      { $group: { _id: null, count: { $sum: 1 }, gross: { $sum: "$total" } } },
    ]),
  ]);
  const q = (value: number) => quantizeToCurrency(value, session.currency);
  const tenders: IPosTenderTotals = { ...ZERO_TENDERS };
  for (const row of byTender) {
    if (row._id in tenders) tenders[row._id as keyof IPosTenderTotals] = q(row.amount);
  }
  const sum = (kind: POSCashEventKind) =>
    q(session.cashEvents.filter((event) => event.kind === kind).reduce((total, event) => total + event.amount, 0));
  const cashIn = sum("in");
  const cashOut = sum("out");
  const refunds = sum("refund");
  return {
    tenders,
    salesCount: sales[0]?.count ?? 0,
    grossSales: q(sales[0]?.gross ?? 0),
    cashIn,
    cashOut,
    refunds,
    expectedCash: q(session.openingFloat + tenders.cash + cashIn - cashOut - refunds),
  };
}

/**
 * Close the drawer with what the cashier counted. The expected figures, the
 * count and the variance are written down — the Z report stays as it was.
 */
export async function closeRegisterSession(params: {
  vendorId: string;
  sessionId: string;
  countedCash: number;
  note?: string;
  by: string;
  now?: Date;
}): Promise<IPosRegisterSession> {
  const session = await loadSession(params.vendorId, params.sessionId);
  if (session.status === "closed") return session;
  const counted = quantizeToCurrency(Number(params.countedCash), session.currency);
  if (!Number.isFinite(counted) || counted < 0) throw new ValidationError("Enter the cash counted in the drawer");
  const totals = await registerSessionTotals(session);
  const closing = {
    expected: { ...totals.tenders, cash: totals.expectedCash },
    counted: { cash: counted },
    variance: quantizeToCurrency(counted - totals.expectedCash, session.currency),
    salesCount: totals.salesCount,
    grossSales: totals.grossSales,
    refunds: totals.refunds,
    cashIn: totals.cashIn,
    cashOut: totals.cashOut,
    note: String(params.note || "").trim().slice(0, 1000) || undefined,
  };
  const updated = await PosRegisterSession.findOneAndUpdate(
    { _id: session._id, status: "open" },
    { $set: { status: "closed", closedBy: params.by, closedAt: params.now ?? new Date(), closing } },
    { new: true },
  ).lean<IPosRegisterSession | null>();
  return updated ?? loadSession(params.vendorId, params.sessionId);
}

/**
 * The session a sale (or a balance payment) goes into.
 *
 * - With an id: it must be this merchant's. Open, it is used. Closed, it is
 *   used only for a sale replayed from the offline queue that was taken while
 *   it was open; a live sale against a closed drawer is refused, because the
 *   cashier is looking at a stale screen.
 * - Without one: none — unless the store requires an open drawer to sell, in
 *   which case a live sale is refused. A replay is never refused for this: the
 *   money is already in a drawer.
 */
export async function resolveSaleSession(params: {
  vendorId: string;
  registerSessionId?: string;
  required: boolean;
  isReplay: boolean;
  soldAt?: Date;
}): Promise<Types.ObjectId | null> {
  const id = String(params.registerSessionId || "").trim();
  if (!id) {
    if (params.required && !params.isReplay) {
      throw new ValidationError("Open the register before taking a sale");
    }
    return null;
  }
  if (!Types.ObjectId.isValid(id)) {
    if (params.isReplay) return null;
    throw new ValidationError("This register session was not found");
  }
  const session = await PosRegisterSession.findOne({ _id: id, vendorId: params.vendorId })
    .select("status openedAt closedAt")
    .lean<Pick<IPosRegisterSession, "_id" | "status" | "openedAt" | "closedAt"> | null>();
  if (!session) {
    if (params.isReplay) return null;
    throw new ValidationError("This register session was not found");
  }
  if (session.status === "open") return session._id;
  const soldAt = params.soldAt?.getTime();
  const tookPlaceWhileOpen =
    soldAt !== undefined &&
    soldAt >= new Date(session.openedAt).getTime() &&
    (!session.closedAt || soldAt <= new Date(session.closedAt).getTime());
  if (params.isReplay && tookPlaceWhileOpen) return session._id;
  if (params.isReplay) return null;
  throw new ValidationError("This register was closed. Open it again to keep selling.");
}
