/**
 * A counter sale rung up with no customer chosen.
 *
 * The POS files such a sale under the cashier — `customerId` is the session
 * user when the till names nobody (`app/api/pos/orders/route.ts`), and every
 * POS order records that cashier as `staffId` — so the screens read the
 * cashier as the buyer: "Storify Admin · Customer since 2026" on a stranger's
 * purchase, and the cashier's name and email as Bill to on the invoice. The
 * data stays as it is (`customerId` is required); what is shown changes, and
 * this is the one rule for it.
 *
 * The POS refuses a staff-side account as the customer, so a POS order whose
 * customer IS its cashier can only be a walk-in.
 *
 * `customerId` may be an ObjectId, its string, or the populated user. Free of
 * model imports: the order screens call it in the browser too.
 */
export function isPosWalkIn(
  order:
    | { channel?: string | null; staffId?: unknown; customerId?: unknown }
    | null
    | undefined,
): boolean {
  if (!order || order.channel !== "pos" || !order.staffId) return false;
  const customerId = idOf(order.customerId);
  return customerId !== null && customerId === String(order.staffId);
}

/**
 * The same rule as a Mongo aggregation expression, for a query that has to
 * leave walk-ins out: `{ $expr: { $not: [POS_WALK_IN_EXPR] } }`. `customerId`
 * is an ObjectId and `staffId` a string, hence the `$toString`; an order with
 * no `staffId` never matches.
 */
export const POS_WALK_IN_EXPR = {
  $and: [
    { $eq: ["$channel", "pos"] },
    { $eq: [{ $toString: "$customerId" }, "$staffId"] },
  ],
};

function idOf(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    // A populated user carries its id as `_id`; a bare ObjectId prints as one.
    const id = (value as { _id?: unknown })._id;
    return String(id ?? value);
  }
  return null;
}
