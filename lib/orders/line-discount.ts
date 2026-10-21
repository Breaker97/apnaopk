import { quantizeToCurrency } from "@/lib/intl/money";

/**
 * Compute the monetary amount of a per-line discount for a given item.
 *
 * Its own module, free of models, so the till's screen can price a sale with
 * the very function the server writes the order with (lib/pos/order-totals.ts).
 * Returns 0 if the item has no line discount.
 *
 * Rounded to what `currency` can hold when it is given — to the cent, 10% off
 * a 1255 XOF line was 125.5 francs that do not exist. Omitted, cents as before.
 */
export function computeLineDiscountAmount(
  price: number,
  quantity: number,
  lineDiscount:
    | { type: "percent" | "amount"; value: number; amount?: number }
    | undefined
    | null,
  currency?: string | null,
): number {
  if (!lineDiscount) return 0;
  const lineSubtotal = price * quantity;
  const value = Math.max(0, Number(lineDiscount.value) || 0);
  const amount =
    lineDiscount.type === "percent"
      ? (lineSubtotal * Math.min(value, 100)) / 100
      : Math.min(value, lineSubtotal);
  if (currency) {
    return Math.min(quantizeToCurrency(amount, currency), lineSubtotal);
  }
  if (lineDiscount.type === "percent") {
    return Math.round(amount * 100) / 100;
  }
  return amount;
}
