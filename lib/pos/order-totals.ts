import {
  computeLineDiscountAmount,
} from "@/lib/orders/order-vendors";
import { roundMoney } from "@/lib/intl/money";

export type POSOrderItemInput = {
  productId: string;
  variantId?: string;
  name: string;
  sku: string;
  price: number;
  quantity: number;
  image?: string;
  vendorId: string;
  lineTotal?: number;
  lineDiscount?: {
    type: "percent" | "amount";
    value: number;
    amount?: number;
  };
  lineNote?: string;
};

export type POSOrderDiscountInput = {
  type: "percent" | "amount";
  value: number;
  amount: number;
  reason?: string;
  note?: string;
};

export function computePOSLineDiscountAmount(item: POSOrderItemInput): number {
  if (!item.lineDiscount) return 0;
  return computeLineDiscountAmount(
    item.price || 0,
    item.quantity || 0,
    item.lineDiscount,
  );
}

/** Whether a sale carries any discount, on a line or on the whole sale. */
export function posSaleHasDiscount(params: {
  items: Array<Pick<POSOrderItemInput, "lineDiscount">>;
  discount?: Pick<POSOrderDiscountInput, "value"> | null;
}): boolean {
  return (
    Number(params.discount?.value || 0) > 0 ||
    params.items.some((item) => Number(item.lineDiscount?.value || 0) > 0)
  );
}

/**
 * The sale's money, worked out on the server alone.
 *
 * Tax is charged on what the shopper actually pays — after the line discounts
 * AND the sale discount — the way online checkout charges it. It used to be
 * charged before the sale discount, on money the till never collected, and was
 * never rounded, so the stored tax and total carried float noise.
 *
 * The discount comes from its type and value only. The terminal's own figure
 * used to be taken whenever it was within 0.5 of the computed one, which let a
 * client nudge every sale's discount.
 */
export function calculatePOSOrderTotals(params: {
  items: POSOrderItemInput[];
  discount?: POSOrderDiscountInput;
  taxRate?: number;
}) {
  const subtotal = roundMoney(
    params.items.reduce(
      (sum, item) => sum + (item.price || 0) * (item.quantity || 0),
      0,
    ),
  );
  const lineDiscountTotal = roundMoney(
    params.items.reduce((sum, item) => sum + computePOSLineDiscountAmount(item), 0),
  );
  const discountedSubtotal = Math.max(0, roundMoney(subtotal - lineDiscountTotal));
  const shippingCost = 0;

  let discountAmount = 0;
  const discount = params.discount;
  if (discount && typeof discount === "object" && discount.value > 0) {
    discountAmount =
      discount.type === "percent"
        ? (discountedSubtotal * Math.min(discount.value, 100)) / 100
        : discount.value;
    discountAmount = Math.max(0, Math.min(roundMoney(discountAmount), discountedSubtotal));
  }

  const taxable = Math.max(0, roundMoney(discountedSubtotal - discountAmount));
  const tax = roundMoney(taxable * (params.taxRate ?? 0));
  const totalDiscount = roundMoney(lineDiscountTotal + discountAmount);
  const total = Math.max(0, roundMoney(taxable + tax));

  return {
    subtotal,
    lineDiscountTotal,
    discountedSubtotal,
    tax,
    shippingCost,
    discountAmount,
    totalDiscount,
    total,
  };
}
