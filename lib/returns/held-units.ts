import {
  RETURN_STATUS,
  UNSELLABLE_RETURN_CONDITIONS,
} from "@/lib/returns/returns";

/**
 * Units a return brought back that nobody can sell.
 *
 * Once a parcel is counted line by line, a unit found damaged, missing parts or
 * unusable is not put back on the shelf (`returnRestockPlan`). It is in the
 * shop all the same, so the inventory shows it as "Unavailable" until the
 * merchant decides what it is: back to sale (repaired, or fine after all) or
 * written off (binned, sent back to the supplier). Each decision is appended to
 * the return as a disposition, and the figure is always read off the return
 * itself, so it cannot drift from what the count recorded.
 *
 * Pure — no database — so the rule is pinned by tests and shared by the
 * inventory list, the unavailable-stock dialog, the order-wide restock and the
 * ledger replay.
 */

export const HELD_UNIT_ACTIONS = ["restocked", "written_off"] as const;
export type HeldUnitAction = (typeof HELD_UNIT_ACTIONS)[number];

type HeldReturnItem = {
  productId?: unknown;
  variantId?: unknown;
  vendorId?: unknown;
  quantityReceived?: number | null;
  condition?: string | null;
};

type HeldDisposition = {
  _id?: unknown;
  itemIndex?: number | null;
  productId?: unknown;
  variantId?: unknown;
  quantity?: number | null;
  action?: string | null;
};

export type HeldReturnSource = {
  _id?: unknown;
  status?: string | null;
  itemsCountedAt?: Date | string | null;
  items?: Array<HeldReturnItem | null> | null;
  unsellableDispositions?: Array<HeldDisposition | null> | null;
};

/** One return's held line, as the unavailable-stock dialog lists it. */
export type HeldUnitEntry = {
  returnId: string;
  returnNumber: string;
  orderId: string;
  orderNumber: string;
  itemIndex: number;
  condition: string;
  received: number;
  held: number;
  countedAt: string | null;
};

type HeldUnitLine = {
  itemIndex: number;
  productId: string;
  variantId?: string;
  vendorId?: string;
  condition: string;
  /** Units the count found in this condition. */
  received: number;
  restocked: number;
  writtenOff: number;
  /** Still in the shop and not for sale. */
  held: number;
};

function count(value: unknown): number {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function idOf(value: unknown): string {
  if (!value) return "";
  const id = (value as { _id?: unknown })?._id ?? value;
  return String(id);
}

function isUnsellableCondition(condition: unknown): boolean {
  return UNSELLABLE_RETURN_CONDITIONS.includes(String(condition || ""));
}

/**
 * Only a counted return says which units are unsellable — before the count the
 * approved quantity is restocked whole, as it always was — and a return that was
 * rejected or called off brought nothing back to hold.
 */
function holdsUnits(request: HeldReturnSource): boolean {
  if (!request.itemsCountedAt) return false;
  return (
    request.status !== RETURN_STATUS.REJECTED &&
    request.status !== RETURN_STATUS.CANCELLED
  );
}

/**
 * Every line the count found unsellable, with what has become of its units.
 *
 * Lines already fully decided are included (with `held: 0`): the order-wide
 * restock needs every unit the return accounted for, not only the ones still
 * waiting. A disposition counts against its line only while the line still
 * names the same product, so a list rewritten under it can never move units
 * between products.
 */
export function heldReturnUnits(request: HeldReturnSource): HeldUnitLine[] {
  if (!holdsUnits(request)) return [];

  const decided = new Map<number, { restocked: number; writtenOff: number }>();
  const items = request.items || [];
  for (const disposition of request.unsellableDispositions || []) {
    if (!disposition) continue;
    const index = Number(disposition.itemIndex);
    const item = items[index];
    if (
      !item ||
      idOf(item.productId) !== idOf(disposition.productId) ||
      idOf(item.variantId) !== idOf(disposition.variantId)
    ) {
      continue;
    }
    const entry = decided.get(index) || { restocked: 0, writtenOff: 0 };
    if (disposition.action === "restocked") {
      entry.restocked += count(disposition.quantity);
    } else if (disposition.action === "written_off") {
      entry.writtenOff += count(disposition.quantity);
    }
    decided.set(index, entry);
  }

  const lines: HeldUnitLine[] = [];
  items.forEach((item, itemIndex) => {
    if (!item?.productId || !isUnsellableCondition(item.condition)) return;
    const received = count(item.quantityReceived);
    if (received === 0) return;
    const { restocked, writtenOff } = decided.get(itemIndex) || {
      restocked: 0,
      writtenOff: 0,
    };
    lines.push({
      itemIndex,
      productId: idOf(item.productId),
      ...(item.variantId ? { variantId: idOf(item.variantId) } : {}),
      ...(item.vendorId ? { vendorId: idOf(item.vendorId) } : {}),
      condition: String(item.condition),
      received,
      restocked,
      writtenOff,
      held: Math.max(0, received - restocked - writtenOff),
    });
  });
  return lines;
}

/**
 * Why a merchant cannot move `quantity` of this line, or null when they can.
 * The caller answers the shopper-facing wording; this only decides.
 */
export function heldUnitRefusal(
  line: HeldUnitLine | undefined,
  quantity: unknown,
): "not_held" | "invalid_quantity" | "too_many" | null {
  if (!line || line.held <= 0) return "not_held";
  const wanted = Number(quantity);
  if (!Number.isInteger(wanted) || wanted < 1) return "invalid_quantity";
  if (wanted > line.held) return "too_many";
  return null;
}

/**
 * The ledger's copy of every "back to sale" a return recorded, one event each —
 * what the live path posted, so the daily reconcile and the backfill replay it
 * under the same key. Units written off post nothing: their cost is a loss that
 * stays in cost of goods.
 */
export function heldRestockReplays(request: HeldReturnSource): Array<{
  eventKey: string;
  restocked: Array<{ productId: string; variantId?: string; quantity: number }>;
}> {
  const returnId = idOf(request._id);
  if (!returnId) return [];
  return (request.unsellableDispositions || []).flatMap((disposition) => {
    if (disposition?.action !== "restocked" || !disposition._id) return [];
    const quantity = count(disposition.quantity);
    if (quantity === 0 || !disposition.productId) return [];
    return [
      {
        eventKey: heldRestockEventKey(returnId, disposition._id),
        restocked: [
          {
            productId: idOf(disposition.productId),
            ...(disposition.variantId
              ? { variantId: idOf(disposition.variantId) }
              : {}),
            quantity,
          },
        ],
      },
    ];
  });
}

export function heldRestockEventKey(returnId: unknown, dispositionId: unknown) {
  return `return-${idOf(returnId)}-held-${idOf(dispositionId)}`;
}
