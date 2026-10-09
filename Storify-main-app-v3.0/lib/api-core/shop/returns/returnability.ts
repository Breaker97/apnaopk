import { MobileApiError } from "@/lib/api-core/errors";
import { ValidationError } from "@/lib/api/errors";
import {
  describeReturnableLines,
  loadReturnableLineFacts,
  type ReturnableLineFacts,
} from "@/lib/returns/create-return";
import type { ReturnCopy } from "@/lib/returns/return-copy";
import { assertReturnEligible } from "@/lib/returns/return-plan";
import { resolveOrderReturnPolicy, resolveReturnPolicy } from "@/lib/returns/return-policy";
import { lineReturnWindowEndsAt } from "@/lib/returns/return-window";
import { RETURN_REASONS } from "@/lib/returns/returns";
import type { ISettings } from "@/models/settings.model";

/**
 * What of an order its shopper may return now, and the refusals of a
 * selection: the website's rules (lib/returns), read line by line so the app
 * is told each line's quantity and why a line is shut, and a selection is
 * refused with the contract's reason before the planner words it its own way.
 */

type ReturnableOrder = Parameters<typeof describeReturnableLines>[0];
type ReturnableLine = Awaited<ReturnType<typeof describeReturnableLines>>[number];
type BlockedReason = "RETURN_WINDOW_CLOSED" | "FINAL_SALE" | "NOT_RETURNABLE";

export interface LineReturnability {
  returnableQuantity: number;
  blockedReason?: BlockedReason;
  windowEndsAt?: string;
}

export interface OrderReturnability {
  canReturn: boolean;
  windowEndsAt?: string;
  blockedReason?: BlockedReason | "RETURNS_THROUGH_STORE";
  blockedMessage?: string;
  lines: Map<number, LineReturnability>;
}

/** Something of the order has been delivered: before that, there is nothing to return. */
export function isDelivered(order: Pick<ReturnableOrder, "status" | "subOrders">): boolean {
  const subs = (order.subOrders || []).filter(Boolean);
  return subs.length > 1 ? subs.some((sub) => sub?.status === "delivered") : order.status === "delivered";
}

function lineBlock(line: ReturnableLine): BlockedReason | undefined {
  if (line.blockedBy) return "NOT_RETURNABLE";
  if (line.finalSale) return "FINAL_SALE";
  if (line.windowClosed) return "RETURN_WINDOW_CLOSED";
  return undefined;
}

/** The order-wide refusal, ahead of any line: a store without self-serve returns, an order not yet returnable. */
function orderProblem(order: ReturnableOrder, settings: ISettings): Error | null {
  if (!resolveReturnPolicy(settings).selfServe) return new Error("RETURNS_THROUGH_STORE");
  try {
    // The window is judged line by line below.
    assertReturnEligible(order, settings as never, { override: true });
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * The order's returnability, or null on an order nothing of which has been
 * delivered (nothing to say yet).
 */
export async function orderReturnability(
  order: ReturnableOrder,
  settings: ISettings,
  copy: ReturnCopy,
  /** Its claimed, refunded and digital lines, already read with other orders' (`ordersReturnability`). */
  facts?: ReturnableLineFacts,
): Promise<OrderReturnability | null> {
  if (!isDelivered(order)) return null;
  const terms = resolveOrderReturnPolicy(order as never, settings as never);
  const described = await describeReturnableLines(order, settings, facts ? { facts } : {});
  const lines = new Map<number, LineReturnability>();
  let latestEnd: number | null = null;
  for (const line of described) {
    const block = lineBlock(line);
    const ends = lineReturnWindowEndsAt(order as never, line.orderItemIndex, terms);
    if (ends && (latestEnd === null || ends.getTime() > latestEnd)) latestEnd = ends.getTime();
    lines.set(line.orderItemIndex, {
      returnableQuantity: block ? 0 : line.returnable,
      ...(block && line.returnable > 0 ? { blockedReason: block } : {}),
      ...(ends ? { windowEndsAt: ends.toISOString() } : {}),
    });
  }

  const problem = orderProblem(order, settings);
  const someReturnable = [...lines.values()].some((line) => line.returnableQuantity > 0);
  const canReturn = !problem && someReturnable;
  let blockedReason: OrderReturnability["blockedReason"];
  if (problem) {
    blockedReason = problem.message === "RETURNS_THROUGH_STORE" ? "RETURNS_THROUGH_STORE" : "NOT_RETURNABLE";
  } else if (!someReturnable) {
    const blocks = [...lines.values()].map((line) => line.blockedReason).filter(Boolean);
    blockedReason =
      blocks.length > 0 && blocks.every((block) => block === "RETURN_WINDOW_CLOSED")
        ? "RETURN_WINDOW_CLOSED"
        : blocks.length > 0 && blocks.every((block) => block === "FINAL_SALE")
          ? "FINAL_SALE"
          : "NOT_RETURNABLE";
  }
  return {
    canReturn,
    ...(latestEnd !== null ? { windowEndsAt: new Date(latestEnd).toISOString() } : {}),
    ...(blockedReason ? { blockedReason, blockedMessage: copy.blocked(blockedReason) } : {}),
    lines,
  };
}

/**
 * `orderReturnability` for a page of orders, by order id: the same rule, with
 * what it reads from the database read once for all the delivered ones. An
 * order nothing of which has been delivered answers null and costs nothing.
 */
export async function ordersReturnability(
  orders: ReadonlyArray<ReturnableOrder>,
  settings: ISettings,
  copy: ReturnCopy,
): Promise<Map<string, OrderReturnability | null>> {
  const delivered = orders.filter(isDelivered);
  const facts =
    delivered.length > 0 ? await loadReturnableLineFacts(delivered) : new Map<string, ReturnableLineFacts>();
  const answers = await Promise.all(
    orders.map(async (order) => {
      const own = facts.get(String(order._id));
      const answer = own ? await orderReturnability(order, settings, copy, own) : null;
      return [String(order._id), answer] as const;
    }),
  );
  return new Map(answers);
}

function conflict(reason: string, message: string, details?: Record<string, unknown>): MobileApiError {
  return new MobileApiError(409, "CONFLICT", message, { reason, ...(details ? { details } : {}) });
}

/**
 * Refuses a selection with the contract's reason: the store's self-serve
 * switch, the order as a whole, then each line (shut, final sale, window,
 * more than can still come back). What passes goes to the planner, which
 * prices it.
 */
export async function assertReturnSelection(
  order: ReturnableOrder,
  settings: ISettings,
  selection: { lines: Array<{ index: number; quantity: number }>; reason: string },
  copy: ReturnCopy,
): Promise<void> {
  if (!(RETURN_REASONS as readonly string[]).includes(selection.reason)) {
    throw new MobileApiError(400, "VALIDATION_ERROR", "Choose one of the store's reasons.", {
      errors: { reason: ["Choose one of the store's reasons."] },
    });
  }
  const seen = new Set<number>();
  for (const line of selection.lines) {
    if (seen.has(line.index)) {
      throw new MobileApiError(400, "VALIDATION_ERROR", "Each line can be listed once.", {
        errors: { lines: ["Each line can be listed once."] },
      });
    }
    seen.add(line.index);
  }

  if (!resolveReturnPolicy(settings).selfServe) {
    throw conflict("RETURNS_THROUGH_STORE", copy.blocked("RETURNS_THROUGH_STORE"));
  }
  try {
    assertReturnEligible(order, settings as never);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    throw conflict(/return window has closed/i.test(error.message) ? "RETURN_WINDOW_CLOSED" : "NOT_RETURNABLE", error.message);
  }

  const described = new Map(
    (await describeReturnableLines(order, settings)).map((line) => [line.orderItemIndex, line]),
  );
  for (const wanted of selection.lines) {
    const line = described.get(wanted.index);
    if (!line) throw conflict("NOT_RETURNABLE", "That line is not on this order.");
    const block = lineBlock(line);
    if (block) throw conflict(block, `"${line.name}": ${copy.blocked(block)}`);
    if (wanted.quantity > line.returnable) {
      throw conflict(
        "QUANTITY_EXCEEDS",
        line.returnable > 0
          ? `Only ${line.returnable} of "${line.name}" can be returned.`
          : `"${line.name}" is already being or has been returned.`,
        { index: wanted.index, returnable: line.returnable },
      );
    }
  }
}

/** The planner's own refusals, after the checks above: a rule the app cannot pick apart. */
export function toReturnError(error: unknown): unknown {
  if (!(error instanceof ValidationError)) return error;
  if (/being opened\. Please try again/i.test(error.message)) {
    return new MobileApiError(409, "REQUEST_IN_PROGRESS", error.message);
  }
  if (/^Order not found$/.test(error.message)) {
    return new MobileApiError(404, "NOT_FOUND", "Order not found.");
  }
  return conflict(/return window has closed/i.test(error.message) ? "RETURN_WINDOW_CLOSED" : "NOT_RETURNABLE", error.message);
}
