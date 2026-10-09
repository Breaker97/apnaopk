import { createHash } from "node:crypto";

/**
 * The cart a card payment was quoted for, reduced to one comparable string.
 *
 * A Stripe order is not built from what was quoted — it is rebuilt from the
 * cart as it stands when the payment lands, because only the cart carries the
 * lines. The one guard between the two used to be the subtotal, and a subtotal
 * says nothing about WHAT adds up to it. A $100 pre-order taking a $20 deposit
 * and an ordinary $100 item sum to the same figure: swap one for the other
 * while the card form is open and the shopper pays $20 for goods the order
 * records as paid in full. A digital line swapped for a heavy one, or one
 * seller's item for another's, rides the same gap and keeps the shipping, duty
 * and vendor split of the cart that was actually quoted.
 *
 * So everything that decides what is owed and what ships is in here: which
 * line, how many, at what price, and the pre-order terms that split it into a
 * deposit now and a balance later. Stamped into the payment's metadata when it
 * is created and compared when the order is built — any difference is a cart
 * that changed after the price was quoted.
 *
 * `quoteId` is left out on purpose. The checkout route reassigns it in memory
 * without writing it back, and the price it resolved to is already here.
 */
export function checkoutCartFingerprint(
  items: ReadonlyArray<{
    productId?: unknown;
    variantId?: unknown;
    quantity?: number;
    price?: number;
    purchaseType?: string;
    preorderPaymentMode?: string;
    preorderDepositAmount?: number;
    preorderOutstandingAmount?: number;
  }>,
): string {
  const lines = items
    .map((item) =>
      JSON.stringify([
        idOf(item.productId),
        item.variantId ? String(item.variantId) : "",
        Number(item.quantity || 0),
        Number(item.price || 0),
        item.purchaseType || "standard",
        item.preorderPaymentMode || "",
        Number(item.preorderDepositAmount || 0),
        Number(item.preorderOutstandingAmount || 0),
      ]),
    )
    // Line order is not part of what was bought.
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

/** A populated product and a bare id name the same line. */
function idOf(value: unknown): string {
  if (value && typeof value === "object" && "_id" in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value ?? "");
}
