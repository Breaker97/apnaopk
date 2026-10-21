import "server-only";

import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { RETURN_CONDITIONS } from "@/contracts/mobile/biz/v1/returns";
import type { RefundPreviewRequest } from "@/contracts/mobile/biz/v1/returns";
import { PaymentTransaction, ReturnRequest } from "@/models";
import { getSettingsLean } from "@/models/settings.model";
import { ApiError, AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { MobileApiError } from "@/lib/api-core/errors";
import { loadBizActor, marketplaceFacts } from "@/lib/api-core/biz/actor";
import { grantCan } from "@/lib/api-core/biz/access";
import { scopeOf } from "@/lib/api-core/biz/scope";
import { mongoBizOperationStore } from "@/lib/api-next/biz-operation-store";
import {
  recordVersion,
  scopedReturn,
  scopedReturnOrder,
  type ReturnContext,
  type ReturnOrder,
} from "@/lib/api-core/biz/returns/context";
import { createBizReturns } from "@/lib/api-core/biz/returns/create";
import { actOnBizReturn } from "@/lib/api-core/biz/returns/action";
import { executeBizRefund, previewBizRefund, type BizRefundOptions } from "@/lib/api-core/biz/returns/refund";
import { previewReturnCreation, readReturnOptions } from "@/lib/api-core/biz/returns/read";
import { isAdmin } from "@/lib/access/rbac";
import { isPosWalkIn } from "@/lib/orders/pos-walk-in";
import { orderStoreCreditRefundProblem } from "@/lib/store-credit/refund-to-credit";
import { orderCreditApplied, splitRefundCreditFirst } from "@/lib/store-credit/order-credit";
import { quantizeToCurrency } from "@/lib/intl/money";
import { toMoney } from "@/lib/api-core/shop/money";
import { REFUND_IN_MOTION_STATUSES } from "@/lib/returns/returns";
import { addCashEvent, registerVendorScope } from "@/lib/pos/register-session";

/**
 * Returns at the till: the counter takes goods back against one of its sales,
 * puts the sellable ones back on its shelf, and gives the money back.
 *
 * Every step is the business app's return core (lib/api-core/biz/returns) —
 * the one place returns are opened, received, restocked and refunded, with
 * their stock movements, ledger postings and refund rows — driven with the
 * cashier's own workspace grant, so a register can do exactly what its
 * cashier could do from the business app:
 *
 *  1. open the return, approved at once (it is being handed over now);
 *  2. record it as received, each line with its condition;
 *  3. refund it, restocking the sellable units at the sale's counter.
 *
 * Refunds are an administrator's (the store's rule, `canIssueRefunds`): a
 * cashier who is not one takes the return and leaves the refund to an
 * administrator, who finds it under Returns.
 *
 * A counter return is opened as "customer_ships" and received on the spot:
 * the core reads "no_shipping" as "the shopper kept the goods", which would
 * leave nothing to put back on the shelf.
 *
 * Retrying the same request (same `requestId`) never repeats a step: each step
 * runs under a key derived from the request, and a step already done is read
 * back instead of done again.
 */

export type POSReturnCondition = (typeof RETURN_CONDITIONS)[number];
export const POS_REFUND_METHODS = [
  "cash",
  "card",
  "bank",
  "original",
  "store_credit",
  "exchange",
  "later",
] as const;
export type POSRefundMethod = (typeof POS_REFUND_METHODS)[number];

type POSUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  role?: string | null;
  roles?: (string | null | undefined)[] | null;
};

type POSReturnContext = ReturnContext & { actorId: string; vendorScope: string };

/** The core speaks the business app's errors; the till's routes speak the website's. */
export function asPOSError(error: unknown): unknown {
  if (error instanceof MobileApiError) {
    return new ApiError(error.message, error.status, error.code);
  }
  return error;
}

async function withPOSErrors<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    throw asPOSError(error);
  }
}

/** The cashier's workspace, for the merchant this register sells for. */
export async function posReturnContext(user: POSUser): Promise<POSReturnContext> {
  const vendorScope = await registerVendorScope(user);
  const settings = await getSettingsLean();
  const actor = await loadBizActor(
    {
      sessionId: "pos",
      user: {
        id: user.id,
        email: String(user.email || ""),
        name: String(user.name || ""),
        emailVerified: true,
        role: isAdmin({ id: user.id, role: user.role ?? undefined, roles: (user.roles ?? undefined) as string[] | undefined })
          ? "admin"
          : String(user.role || ""),
      },
    },
    marketplaceFacts(settings),
  );
  const wanted = vendorScope ? "vendor" : "platform";
  const grant =
    actor.workspaces.find((candidate) => candidate.workspace === wanted) ??
    (actor.workspaces.length === 1 ? actor.workspaces[0] : undefined);
  if (!grant) throw new AuthorizationError("Your account cannot take returns at this register");
  return { workspace: grant, scope: scopeOf(grant), actorId: user.id, vendorScope };
}

/** A UUID-shaped key for one step of one till request: the core's idempotency key. */
export function posStepKey(requestId: string, step: string): string {
  const hex = createHash("sha256").update(`pos-return:${requestId}:${step}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * What the core already did under a key: nothing yet, done (with what), or
 * refused. A step another request is running right now is refused as a
 * conflict; one left in doubt by a failure (its lease run out) is run again
 * under the same key, and the core reconciles it before doing anything.
 */
async function priorStep(actorId: string, key: string) {
  const operation = await mongoBizOperationStore.read(actorId, key);
  if (!operation) return { state: "none" as const };
  if (operation.state === "succeeded") return { state: "done" as const, resources: operation.resources };
  if (operation.state === "failed") {
    return {
      state: "failed" as const,
      error: new ApiError(
        operation.failure?.message || "This step was refused",
        operation.failure?.status ?? 409,
        operation.failure?.code,
      ),
    };
  }
  if (operation.state === "pending" && operation.leaseUntil.getTime() > Date.now()) {
    throw new ConflictError("This return is still being recorded. Try again in a moment.");
  }
  return { state: "retry" as const, operationId: operation.id };
}

async function loadCounterSale(orderId: string, context: POSReturnContext): Promise<ReturnOrder> {
  const order = await withPOSErrors(() => scopedReturnOrder(orderId, context));
  if (order.channel !== "pos") throw new NotFoundError("Sale");
  return order;
}

function canRefund(context: POSReturnContext): boolean {
  return grantCan(context.workspace, "ISSUE_REFUNDS");
}

const paidByStripe = (order: ReturnOrder) =>
  String(order.paymentMethod || "").toLowerCase() === "card" &&
  Boolean(String(order.stripePaymentIntentId || "").trim());

type RefundRow = {
  grossAmount?: number;
  status?: string;
  provider?: string;
  bizOperationLeg?: string;
  metadata?: { bizTarget?: { kind?: string; id?: string } };
};

/** Every refund row written against a sale. */
async function saleRefundRows(order: ReturnOrder): Promise<RefundRow[]> {
  return PaymentTransaction.find({ orderId: order._id, type: "refund" })
    .select("grossAmount status provider bizOperationLeg metadata.bizTarget")
    .lean<RefundRow[]>();
}

/**
 * What one return's refund was made of: money paid out (by hand, or back to
 * the card) and credit given back. The core restores the credit a sale was
 * part paid with before anything else (`splitRefundCreditFirst`), so on such
 * a sale the money paid out is less than the refund — and only that comes out
 * of the drawer, or pays toward an exchange.
 */
function returnRefundLegs(rows: RefundRow[], returnId: string): { paid: number; credit: number } {
  let paid = 0;
  let credit = 0;
  for (const row of rows) {
    const target = row.metadata?.bizTarget;
    if (row.status !== "succeeded" || target?.kind !== "return" || String(target.id) !== returnId) continue;
    if (row.bizOperationLeg === "credit") credit += Number(row.grossAmount || 0);
    else paid += Number(row.grossAmount || 0);
  }
  return { paid, credit };
}

/**
 * What the Stripe card a sale was paid on can still give back: its own
 * tender, less what has gone back to Stripe already. On a sale paid partly in
 * cash or credit the card took only its part — and the core sends a refund
 * "back to the card" there whole, where Stripe refuses the excess after the
 * return is recorded and the money is reserved.
 */
function stripeRefundRoom(order: ReturnOrder, rows: RefundRow[]): number {
  if (!paidByStripe(order)) return 0;
  const currency = order.currency || "USD";
  const took = order.posTenders?.length
    ? order.posTenders
        .filter((tender) => tender.method === "card" && tender.cardSubMethod === "card_stripe")
        .reduce((sum, tender) => sum + Number(tender.amount || 0), 0)
    : Number(order.total || 0) - orderCreditApplied(order);
  const given = rows
    .filter((row) => row.provider === "stripe" && (row.status === "succeeded" || row.status === "pending"))
    .reduce((sum, row) => sum + Number(row.grossAmount || 0), 0);
  return quantizeToCurrency(Math.max(0, took - given), currency);
}

/** The ways this sale's refund can go out at the till. */
async function refundMethodsFor(order: ReturnOrder, context: POSReturnContext): Promise<POSRefundMethod[]> {
  if (!canRefund(context)) return ["later"];
  const methods: POSRefundMethod[] = [];
  if (paidByStripe(order) && stripeRefundRoom(order, await saleRefundRows(order)) > 0) methods.push("original");
  methods.push("cash", "exchange");
  const tenders = new Set(
    (order.posTenders?.length ? order.posTenders.map((tender) => tender.method) : [order.paymentMethod]).map(
      (method) => String(method || "").toLowerCase(),
    ),
  );
  if (tenders.has("card") && !paidByStripe(order)) methods.push("card");
  if (tenders.has("bank")) methods.push("bank");
  if (!isPosWalkIn(order) && !(await orderStoreCreditRefundProblem(order))) methods.push("store_credit");
  methods.push("later");
  return methods;
}

/** The sale's lines as the till offers them back, and how the money can go. */
export async function posReturnOptions(user: POSUser, orderId: string) {
  const context = await posReturnContext(user);
  const order = await loadCounterSale(orderId, context);
  const options = await withPOSErrors(() => readReturnOptions(orderId, context));
  return {
    orderId,
    orderNumber: order.orderNumber,
    currency: order.currency || "USD",
    reasons: options.reasons.map((reason) => ({ code: reason.code, noteRequired: reason.noteRequired })),
    lines: options.lines.map((line) => {
      const item = order.items[line.index];
      return {
        index: line.index,
        name: line.name,
        image: typeof item?.image === "string" ? item.image : undefined,
        unitPrice: Number(item?.price || 0),
        ordered: line.ordered,
        eligible: line.eligible,
        finalSale: line.finalSale,
        blockedReason: line.reason,
      };
    }),
    refundMethods: await refundMethodsFor(order, context),
    canRefund: canRefund(context),
  };
}

export interface POSReturnLineInput {
  index: number;
  quantity: number;
  condition: POSReturnCondition;
}

/** What the store would refund for these lines, by its return policy. */
export async function posReturnPreview(user: POSUser, input: { orderId: string; lines: POSReturnLineInput[]; reason: string }) {
  const context = await posReturnContext(user);
  await loadCounterSale(input.orderId, context);
  const preview = await withPOSErrors(() =>
    previewReturnCreation(
      {
        orderId: input.orderId,
        items: input.lines.map((line) => ({ index: line.index, quantity: line.quantity })),
        reason: input.reason,
        resolution: "refund",
        returnMethod: "customer_ships",
      },
      context,
    ),
  );
  return {
    total: preview.total.amount,
    currency: preview.total.currency,
    restockingFee: preview.parcels.reduce((sum, parcel) => sum + parcel.refund.restockingFee.amount, 0),
  };
}

/** Where a by-hand refund's money is booked from: `cashAccountForSettlement`. */
function settlementMethod(method: POSRefundMethod, order: ReturnOrder): string {
  if (method === "cash" || method === "exchange") return "cash";
  if (method === "card" || method === "bank") return method;
  return String(order.paymentMethod || "manual");
}

export interface POSReturnResult {
  returns: Array<{ id: string; number: string; refunded: number; status: string; refundStatus: string }>;
  refunded: number;
  currency: string;
  refundMethod: POSRefundMethod;
  /** The refund was left for an administrator. */
  refundPending: boolean;
  /**
   * What the refund paid out as money — by hand, or back to the card. Less
   * than `refunded` on a sale part paid with store credit; what an exchange
   * puts toward the next sale.
   */
  paidOut: number;
  /** What went back to the store credit the sale was part paid with. */
  creditBack: number;
  /** Cash that left the drawer for this return. */
  cashOut: number;
  warnings: string[];
}

/**
 * Take a return at the till. See the module comment for the steps; each is
 * skipped on a retry once it has been done.
 */
export async function takePOSReturn(
  user: POSUser,
  input: {
    orderId: string;
    lines: POSReturnLineInput[];
    reason: string;
    note?: string;
    refundMethod: POSRefundMethod;
    requestId: string;
    registerSessionId?: string;
  },
): Promise<POSReturnResult> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(input.requestId)) {
    throw new ValidationError("The request key is missing or malformed");
  }
  if (!input.lines.length) throw new ValidationError("Choose what is coming back");
  if (new Set(input.lines.map((line) => line.index)).size !== input.lines.length) {
    throw new ValidationError("Choose each line once");
  }
  const context = await posReturnContext(user);
  const order = await loadCounterSale(input.orderId, context);
  const currency = order.currency || "USD";
  const methods = await refundMethodsFor(order, context);
  if (!methods.includes(input.refundMethod)) {
    throw new ValidationError(
      input.refundMethod === "store_credit"
        ? "Store credit needs the sale's customer account"
        : canRefund(context)
          ? "This sale cannot be refunded that way"
          : "Refunds are made by an administrator. Take the return and leave the refund for later.",
    );
  }
  const conditionOf = new Map(input.lines.map((line) => [line.index, line.condition]));

  // 1. Open the return (one per seller whose goods are coming back).
  const createKey = posStepKey(input.requestId, "create");
  const created = await priorStep(context.actorId, createKey);
  if (created.state === "failed") throw created.error;
  // Back to the card only as far as the card took: refused here, before the
  // return is opened, rather than by Stripe once the money is reserved.
  if (input.refundMethod === "original" && created.state === "none") {
    await assertCardCovers(order, context, input, currency);
  }
  let returnIds: string[] = [];
  if (created.state === "done") {
    returnIds = created.resources.filter((resource) => resource.kind === "return").map((resource) => resource.id);
  } else if (created.state === "retry") {
    // Left in doubt: the cases it made, if it made them, carry its id.
    const rows = await ReturnRequest.find({ bizCreateOperationId: created.operationId })
      .select("_id")
      .lean<Array<{ _id: unknown }>>();
    returnIds = rows.map((row) => String(row._id));
  }
  if (!returnIds.length) {
    const result = await withPOSErrors(() =>
      createBizReturns(
        {
          orderId: input.orderId,
          version: recordVersion(order),
          items: input.lines.map((line) => ({ index: line.index, quantity: line.quantity })),
          reason: input.reason,
          note: input.note?.trim() || undefined,
          resolution: "refund",
          returnMethod: "customer_ships",
        },
        { ...context, key: createKey },
      ),
    );
    returnIds = result.returns.map((row) => row.id);
  }

  const warnings: string[] = [];
  const results: POSReturnResult["returns"] = [];
  let cashOut = 0;
  let creditBack = 0;

  for (const returnId of returnIds) {
    // 2. Received now, at the counter, in the condition the cashier saw.
    let { returned } = await withPOSErrors(() => scopedReturn(returnId, context));
    if (!returned.itemsCountedAt) {
      const key = posStepKey(input.requestId, `receipt:${returnId}`);
      const prior = await priorStep(context.actorId, key);
      if (prior.state === "failed") throw prior.error;
      if (prior.state !== "done") {
        await withPOSErrors(() =>
          actOnBizReturn(
            {
              action: "record_receipt",
              version: recordVersion(returned),
              receivedItems: returned.items.map((line) => ({
                index: line.orderItemIndex,
                quantity: line.quantityApproved,
                condition: conditionOf.get(line.orderItemIndex) ?? "new",
              })),
            },
            returnId,
            { ...context, key },
          ),
        );
      }
      ({ returned } = await withPOSErrors(() => scopedReturn(returnId, context)));
    }

    // 3. The refund, with the sellable units back on this counter's shelf.
    if (input.refundMethod !== "later") {
      const already = Number(returned.actualRefund?.amount || 0) > 0 || REFUND_IN_MOTION_STATUSES.includes(returned.refundStatus);
      const byHand = input.refundMethod !== "original" && input.refundMethod !== "store_credit";
      const settlement = { method: settlementMethod(input.refundMethod, order), reference: returned.returnNumber };
      if (!already) {
        const locationId =
          order.posLocationId && Types.ObjectId.isValid(String(order.posLocationId))
            ? String(order.posLocationId)
            : undefined;
        // A Stripe sale refunded by hand is recorded as already paid; any
        // other counter sale is refunded "by hand" by the core, and settled
        // in the next step with how the money went.
        const request: RefundPreviewRequest = {
          target: { kind: "return", id: returnId },
          restoreInventory: true,
          ...(locationId ? { locationId } : {}),
          reason: `Return ${returned.returnNumber} at the till`,
          ...(byHand && paidByStripe(order) ? { manual: true, settlement } : {}),
        };
        const options: BizRefundOptions | undefined =
          input.refundMethod === "store_credit" ? { toStoreCredit: true } : undefined;
        const key = posStepKey(input.requestId, `refund:${returnId}`);
        const prior = await priorStep(context.actorId, key);
        if (prior.state === "failed") throw prior.error;
        if (prior.state !== "done") {
          const preview = await withPOSErrors(() => previewBizRefund(request, { ...context, key }, options));
          await withPOSErrors(() =>
            executeBizRefund({ preview: request, previewToken: preview.token }, { ...context, key }, options),
          );
        }
        ({ returned } = await withPOSErrors(() => scopedReturn(returnId, context)));
      }
      // How the money went, for a refund the core left to be settled by hand.
      if (byHand && returned.refundStatus === "manual_required") {
        const key = posStepKey(input.requestId, `settle:${returnId}`);
        const prior = await priorStep(context.actorId, key);
        if (prior.state === "failed") throw prior.error;
        if (prior.state !== "done") {
          await withPOSErrors(() =>
            actOnBizReturn(
              { action: "record_settlement", version: recordVersion(returned), settlement },
              returnId,
              { ...context, key },
            ),
          );
        }
        ({ returned } = await withPOSErrors(() => scopedReturn(returnId, context)));
      }
      const legs = returnRefundLegs(await saleRefundRows(order), returnId);
      if (input.refundMethod !== "store_credit") creditBack += legs.credit;
      // Cash handed over comes out of this register's drawer — the money
      // paid out, never the part that went back to store credit.
      if (settlement.method === "cash" && byHand && legs.paid > 0 && input.registerSessionId) {
        try {
          await addCashEvent({
            vendorId: context.vendorScope,
            sessionId: input.registerSessionId,
            kind: "refund",
            amount: legs.paid,
            reason: returned.returnNumber,
            by: user.id,
            orderId: order._id,
            returnNumber: returned.returnNumber,
            requestId: createHash("sha256").update(`${input.requestId}:${returnId}`).digest("hex").slice(0, 32),
          });
          cashOut += legs.paid;
        } catch (error) {
          warnings.push(
            `The refund was made, but it could not be recorded against the drawer: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          );
        }
      }
    }
    results.push({
      id: returnId,
      number: returned.returnNumber,
      refunded: Number(returned.actualRefund?.amount || 0),
      status: returned.status,
      refundStatus: returned.refundStatus,
    });
  }

  const refunded = quantizeToCurrency(results.reduce((sum, row) => sum + row.refunded, 0), currency);
  const asMoney = input.refundMethod !== "store_credit" && input.refundMethod !== "later";
  return {
    returns: results,
    refunded,
    currency,
    refundMethod: input.refundMethod,
    refundPending: input.refundMethod === "later",
    paidOut: asMoney ? quantizeToCurrency(Math.max(0, refunded - creditBack), currency) : 0,
    creditBack: quantizeToCurrency(creditBack, currency),
    cashOut: quantizeToCurrency(cashOut, currency),
    warnings,
  };
}

/**
 * Refuses "back to the card" for more than the card can give back: what the
 * store's return policy would refund for these lines, less the store credit
 * the core gives back first.
 */
async function assertCardCovers(
  order: ReturnOrder,
  context: POSReturnContext,
  input: { orderId: string; lines: POSReturnLineInput[]; reason: string },
  currency: string,
): Promise<void> {
  const preview = await withPOSErrors(() =>
    previewReturnCreation(
      {
        orderId: input.orderId,
        items: input.lines.map((line) => ({ index: line.index, quantity: line.quantity })),
        reason: input.reason,
        resolution: "refund",
        returnMethod: "customer_ships",
      },
      context,
    ),
  );
  const toCard = splitRefundCreditFirst({ amount: preview.total.amount, order, currency }).gateway;
  const room = stripeRefundRoom(order, await saleRefundRows(order));
  if (toCard > room + 0.000001) {
    throw new ValidationError(
      `The card can give back only ${toMoney(room, currency).formatted} of this sale. Refund it another way, or take back fewer items.`,
    );
  }
}
