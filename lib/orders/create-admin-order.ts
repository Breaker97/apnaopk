import "server-only";

import { Types } from "mongoose";
import { Order, Product } from "@/models";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { PAYMENT_STATUS } from "@/config/app.config";
import { PLATFORM_PAYMENT_CUSTODY } from "@/lib/payments/payment-custody";
import { allocateSubOrderShipping } from "@/lib/checkout/checkout-shipping";
import { getNextOnlineOrderNumber } from "@/lib/orders/order-number";
import type { AuditContext } from "@/lib/audit";
import { auditOrderPlaced } from "@/lib/orders/audit-order";
import { DEFAULT_VENDOR_COMMISSION_RATE } from "@/lib/orders/order-settings";
import {
  buildVendorSubOrders,
  getOrderItemVendorId,
  groupItemsByOrderVendor,
  resolveOrderVendorContextForItems,
} from "@/lib/orders/order-vendors";
import {
  decrementInventory,
  restoreInventory,
  InsufficientStockError,
  type InventoryAdjustmentLine,
} from "@/lib/inventory/inventory";
import { markOrderInventoryReserved } from "@/lib/orders/order-inventory";
import { ensureChargeTransaction } from "@/lib/payments/payment-transactions";
import { notifyOrderCreatedParticipants } from "@/lib/notifications/notifications";
import { resolveOrderItemCost } from "@/lib/products/item-cost";
import { quantizeToCurrency, roundMoney } from "@/lib/intl/money";
import type { getSettings } from "@/models/settings.model";

/**
 * An order the store makes by hand: from the admin order form, or as the
 * exchange order a processed return becomes (R7). One builder, so the two
 * price, split across sellers, take stock and record payment the same way.
 */

type AdminOrderLineInput = {
  productId: string;
  variantId?: string;
  quantity: number;
  /**
   * The unit price the store set for this order — an exchange item offered
   * for less. Absent, the catalog's.
   */
  price?: number;
};

export type ResolvedAdminOrderLine = AdminOrderLineInput & {
  product: {
    _id: unknown;
    name?: string;
    title?: string;
    sku?: string;
    price?: number;
    cost?: number;
    stock?: number;
    images?: string[];
    vendorId?: unknown;
    variants?: Array<{
      _id?: unknown;
      name?: string;
      sku?: string;
      price?: number;
      cost?: number;
      stock?: number;
      image?: string;
    }>;
  };
  variant?: {
    _id?: unknown;
    name?: string;
    sku?: string;
    price?: number;
    cost?: number;
    stock?: number;
    image?: string;
  };
  name: string;
  sku: string;
  price: number;
  image?: string;
};

function idsMatch(left: unknown, right?: string) {
  if (!left || !right) return false;
  return String((left as { _id?: unknown })?._id || left) === right;
}

/** The lines as the catalog has them, each at its own price unless one was set. */
export async function resolveAdminOrderLines(
  lines: AdminOrderLineInput[],
): Promise<ResolvedAdminOrderLine[]> {
  const productIds = Array.from(new Set(lines.map((line) => line.productId)));
  const products = await Product.find({ _id: { $in: productIds } }).lean();
  const productById = new Map(products.map((product) => [String(product._id), product]));

  return lines.map((line) => {
    const product = productById.get(line.productId);
    if (!product) {
      throw new NotFoundError("Product");
    }

    const variants = (product.variants || []) as ResolvedAdminOrderLine["product"]["variants"];
    const variant = line.variantId
      ? variants?.find((item) => idsMatch(item._id, line.variantId))
      : undefined;

    if (line.variantId && !variant) {
      throw new ValidationError("Selected product variant was not found");
    }

    const productName = product.title || product.name || "Product";
    const variantName = variant?.name && variant.name !== "Default Title" ? variant.name : "";

    return {
      ...line,
      product,
      variant,
      name: variantName ? `${productName} - ${variantName}` : productName,
      sku: variant?.sku || product.sku || "",
      price:
        typeof line.price === "number" && Number.isFinite(line.price)
          ? Math.max(0, line.price)
          : Number(variant?.price ?? product.price ?? 0),
      image: variant?.image || product.images?.[0],
    };
  });
}

type Settings = Awaited<ReturnType<typeof getSettings>>;

/** Shared manual-order arithmetic; callers must resolve and authorize prices first. */
export function priceAdminOrder(input: {
  lines: ReadonlyArray<{ price: number; quantity: number }>;
  discount: number;
  taxRate: number;
  shippingCost: number;
  currency: string;
}) {
  const subtotal = roundMoney(input.lines.reduce((sum, line) => sum + line.price * line.quantity, 0));
  const discount = Math.min(roundMoney(input.discount), subtotal);
  const taxableSubtotal = Math.max(subtotal - discount, 0);
  const tax = quantizeToCurrency(taxableSubtotal * (input.taxRate / 100), input.currency);
  const shippingCost = quantizeToCurrency(input.shippingCost, input.currency);
  const total = quantizeToCurrency(taxableSubtotal + tax + shippingCost, input.currency);
  return { subtotal, discount, tax, shippingCost, total };
}

/**
 * Price the lines, split them into consignments, take the stock, write the
 * order and — paid when made — record the payment, the points and the
 * customer's spend. Stock taken is put back if the write fails.
 */
export async function createAdminOrder(params: {
  settings: Settings;
  lines: ResolvedAdminOrderLine[];
  /** The customer's account, or a guest order's own customer id. */
  customerId: unknown;
  /** A guest order's checkout email. */
  guestEmail?: string;
  shippingAddress: Record<string, unknown>;
  billingAddress?: Record<string, unknown>;
  shippingCost: number;
  discount: number;
  /** A percentage of the goods after the discount. */
  taxRate: number;
  paymentMethod: string;
  paymentStatus: "pending" | "paid";
  notes?: string;
  /** Who made it: the staff record, who collected the money, a new default seller's owner. */
  actorId: string;
  audit: AuditContext;
  /** How the order came to be, for its timeline. */
  source?: "admin" | "exchange";
  /** The return an exchange order was made for, for its timeline. */
  returnNumber?: string;
  /**
   * The shopper hears about this order another way — an exchange order, in
   * the return's own notice — so the generic "order placed" email is not sent.
   */
  customerNotified?: boolean;
  /** More of the order document: its store credit, the return it exchanges. */
  extra?: Record<string, unknown>;
}) {
  const { settings } = params;
  const orderCurrency = settings.general?.defaultCurrency || "USD";
  const isMultiVendorEnabled = Boolean(settings.multiVendorMode?.enabled);
  const vendorContext = await resolveOrderVendorContextForItems({
    isMultiVendorEnabled,
    items: params.lines,
    getVendorId: (item) => item.product.vendorId,
    defaultVendorOwnerUserId: params.actorId,
  });
  const vendorGroups = groupItemsByOrderVendor(
    params.lines,
    vendorContext,
    (item) => item.product.vendorId,
  );
  const { subtotal, discount, tax, shippingCost, total } = priceAdminOrder({
    ...params, currency: orderCurrency,
  });

  const subOrders = await buildVendorSubOrders(vendorGroups, {
    codCollectedByDefault: settings.shipping?.codCollectedBy,
    currency: orderCurrency,
    getProductId: (item) => new Types.ObjectId(item.productId),
    getVariantId: (item) =>
      item.variantId ? new Types.ObjectId(item.variantId) : undefined,
    getName: (item) => item.name,
    getSku: (item) => item.sku,
    getQuantity: (item) => item.quantity,
    getPrice: (item) => item.price,
    getCost: (item) =>
      resolveOrderItemCost({ product: item.product, variant: item.variant }),
    getImage: (item) => item.image,
    fallbackCommissionPercent:
      settings.orders?.commission?.vendorRate ?? DEFAULT_VENDOR_COMMISSION_RATE,
    status: "pending",
  });

  // The delivery charge belongs to the parcels, as a checkout order's does.
  // Left at 0 on every sub-order, the ledger gave the whole charge to the
  // first vendor and the payout view credited nobody.
  allocateSubOrderShipping(subOrders, {
    vendorShippingCosts: new Map(),
    orderShippingCost: shippingCost,
    currency: orderCurrency,
  });

  const inventoryLines: InventoryAdjustmentLine[] = params.lines.map((item) => ({
    productId: item.productId,
    variantId: item.variantId,
    quantity: item.quantity,
  }));

  try {
    await decrementInventory(inventoryLines);
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      throw new ValidationError("Some selected items do not have enough stock");
    }
    throw err;
  }

  // Paid when it is made: the store already has the money. Each consignment
  // says so too, the way marking an order paid afterwards stamps them —
  // otherwise the order read paid while every sub-order still read unpaid.
  const paidAt =
    params.paymentStatus === PAYMENT_STATUS.PAID ? new Date() : undefined;
  const subOrdersToSave = paidAt
    ? subOrders.map((sub) => ({
        ...sub,
        paymentStatus: PAYMENT_STATUS.PAID,
        paidAt,
        paymentCollectedBy: params.actorId,
      }))
    : subOrders;

  let order;
  try {
    order = await Order.create({
      orderNumber: await getNextOnlineOrderNumber(settings.orders?.prefix),
      currency: orderCurrency,
      customerId: params.customerId,
      ...(params.guestEmail ? { guestEmail: params.guestEmail } : {}),
      items: params.lines.map((item) => ({
        productId: new Types.ObjectId(item.productId),
        variantId: item.variantId ? new Types.ObjectId(item.variantId) : undefined,
        vendorId: new Types.ObjectId(
          getOrderItemVendorId(item.product.vendorId, vendorContext),
        ),
        name: item.name,
        sku: item.sku,
        price: item.price,
        cost: resolveOrderItemCost({
          product: item.product,
          variant: item.variant,
        }),
        quantity: item.quantity,
        image: item.image,
      })),
      subOrders: subOrdersToSave,
      shippingAddress: params.shippingAddress,
      billingAddress: params.billingAddress || params.shippingAddress,
      paymentMethod: params.paymentMethod,
      paymentStatus: params.paymentStatus,
      // The store records this money, now or when it is marked paid later,
      // so it is the store's to hold: the vendor is paid out their share
      // and the commission comes off that payout.
      paymentCustody: PLATFORM_PAYMENT_CUSTODY,
      ...(paidAt ? { paidAt } : {}),
      subtotal,
      shippingCost,
      tax,
      discount,
      total,
      status: "pending",
      channel: "online",
      staffId: params.actorId,
      notes: params.notes,
      ...(params.extra || {}),
    });
  } catch (err) {
    await restoreInventory(inventoryLines).catch((restoreErr) =>
      console.error("Failed to restore inventory after admin order failure:", restoreErr),
    );
    throw err;
  }

  await markOrderInventoryReserved(String(order._id)).catch((err) =>
    console.error("Failed to mark inventory reserved on admin order:", err),
  );

  // The money arrived with the order, so it is recorded with it: the charge
  // row, and through it the ledger's sale. An order made here as paid wrote
  // neither — the transactions screen never listed the payment, and the sale
  // reached the books only if the daily ledger pass happened to catch it
  // within its few days, never after.
  if (paidAt) {
    await ensureChargeTransaction({
      _id: String(order._id),
      orderNumber: order.orderNumber,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      subtotal: order.subtotal,
      shippingCost: order.shippingCost,
      tax: order.tax,
      discount: order.discount,
      total: order.total,
      currency: order.currency,
      channel: order.channel || "online",
      createdAt: order.createdAt,
    }).catch((err) =>
      console.error("Failed to record the payment on an admin-created order:", err),
    );

    // And the shopper's side of a paid order: the points it earns and the
    // spend on their profile. Every other way an order becomes paid does
    // this; an order an admin made as paid earned nothing and left the
    // customer's totals behind until something else refreshed them.
    const { awardOrderLoyaltyPoints, refreshCustomerStatsForOrder } =
      await import("@/lib/customers/customer");
    await awardOrderLoyaltyPoints(String(order._id)).catch((err) =>
      console.error("Failed to award loyalty points on an admin-created order:", err),
    );
    refreshCustomerStatsForOrder(order).catch((err) =>
      console.error("Failed to refresh customer stats on an admin-created order:", err),
    );
  }

  await notifyOrderCreatedParticipants(
    order,
    params.customerNotified ? { customerEmailSent: true } : {},
  ).catch((err) =>
    console.error("Failed to create admin order notifications:", err),
  );

  // A staff member hand-creating an order for a customer, at prices they
  // chose, is exactly what an audit trail is for — and it wrote nothing.
  await auditOrderPlaced(params.audit, order, {
    source: params.source ?? "admin",
    total: order.total,
    currency: order.currency,
    itemCount: order.items.length,
    paymentMethod: order.paymentMethod,
    ...(params.returnNumber ? { returnNumber: params.returnNumber } : {}),
  });

  return order;
}
