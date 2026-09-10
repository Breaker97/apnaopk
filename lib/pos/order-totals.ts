import {
  computeLineDiscountAmount,
} from "@/lib/orders/order-vendors";

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

export function calculatePOSOrderTotals(params: {
  items: POSOrderItemInput[];
  discount?: POSOrderDiscountInput;
  taxRate?: number;
}) {
  const subtotal = params.items.reduce(
    (sum, item) => sum + (item.price || 0) * (item.quantity || 0),
    0,
  );
  const lineDiscountTotal = params.items.reduce(
    (sum, item) => sum + computePOSLineDiscountAmount(item),
    0,
  );
  const discountedSubtotal = Math.max(0, subtotal - lineDiscountTotal);
  const tax = discountedSubtotal * (params.taxRate ?? 0);
  const shippingCost = 0;

  let discountAmount = 0;
  const discount = params.discount;
  if (discount && typeof discount === "object" && discount.value > 0) {
    if (discount.type === "percent") {
      discountAmount =
        (discountedSubtotal * Math.min(discount.value, 100)) / 100;
    } else {
      discountAmount = Math.min(discount.value, discountedSubtotal);
    }
    if (
      typeof discount.amount === "number" &&
      Number.isFinite(discount.amount) &&
      discount.amount >= 0
    ) {
      if (
        discount.type === "percent" &&
        Math.abs(discount.amount - discountAmount) < 0.5
      ) {
        discountAmount = discount.amount;
      } else if (
        discount.type === "amount" &&
        Math.abs(discount.amount - discountAmount) < 0.5
      ) {
        discountAmount = discount.amount;
      }
    }
    discountAmount = Math.max(0, Math.min(discountAmount, discountedSubtotal));
  }

  const totalDiscount = lineDiscountTotal + discountAmount;
  const total = Math.max(0, subtotal - totalDiscount + tax);

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
