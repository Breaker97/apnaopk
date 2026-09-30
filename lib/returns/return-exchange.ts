import "server-only";

import { Types } from "mongoose";
import { Order, PaymentTransaction, Product, ReturnRequest, User } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import { PAYMENT_STATUS } from "@/config/app.config";
import type { AuditContext } from "@/lib/audit";
import { createRefundTransaction } from "@/lib/payments/payment-transactions";
import {
  scaleRefundAllocation,
  type RefundAllocationShare,
} from "@/lib/returns/refund-allocation";
import { quantizeToCurrency } from "@/lib/intl/money";
import { escapeRegExp } from "@/lib/strings";
import { findDefaultVendorIdReadOnly } from "@/lib/vendors/multi-vendor";
import { getPurchasableQuantity, UNTRACKED_PURCHASE_CAP } from "@/lib/products/stock-policy";
import {
  createAdminOrder,
  resolveAdminOrderLines,
} from "@/lib/orders/create-admin-order";
import {
  EXCHANGE_MAX_LINES,
  exchangeProductProblem,
  isActiveExchangeOrder,
  type ExchangePrice,
} from "@/lib/returns/exchange";
import { RETURN_REFUND_STATUS, RETURN_STATUS } from "@/lib/returns/returns";
import type { ReturnExchangeItem } from "@/models/return-request.model";
import type { getSettings } from "@/models/settings.model";

/**
 * The database side of exchanges (R7) — see lib/returns/exchange.ts for the
 * rules. Choosing what goes out, making the exchange order when the return is
 * processed, and calling the exchange off when that order is cancelled.
 */

type Settings = Awaited<ReturnType<typeof getSettings>>;

const idOf = (value: unknown) =>
  value ? String((value as { _id?: unknown })?._id ?? value) : "";

/** The one seller a return's goods came from, or null when there are more. */
export function returnSellerId(returnRequest: {
  vendorIds?: ReadonlyArray<unknown> | null;
  items?: ReadonlyArray<{ vendorId?: unknown }> | null;
}): string | null {
  const ids = new Set(
    [
      ...(returnRequest.vendorIds || []),
      ...(returnRequest.items || []).map((item) => item.vendorId),
    ]
      .map(idOf)
      .filter(Boolean),
  );
  return ids.size === 1 ? [...ids][0] : null;
}

/**
 * Which seller a product sells as, filed the way an order made now files it
 * (`getOrderItemVendorId`): its own seller, or the store's own when it has
 * none — and the store's own for everything while the store sells alone.
 */
async function sellerScope(settings: Settings) {
  const multiVendor = Boolean(settings.multiVendorMode?.enabled);
  const houseVendorId = (await findDefaultVendorIdReadOnly()) || "";
  return {
    vendorOf: (productVendorId: unknown) =>
      multiVendor ? idOf(productVendorId) || houseVendorId : houseVendorId,
    /** The catalog query for one seller's products, or null when it has none now. */
    productFilter: (sellerId: string): Record<string, unknown> | null => {
      if (!Types.ObjectId.isValid(sellerId)) return null;
      if (!multiVendor) return sellerId === houseVendorId ? {} : null;
      const own = new Types.ObjectId(sellerId);
      return sellerId === houseVendorId
        ? { $or: [{ vendorId: own }, { vendorId: null }] }
        : { vendorId: own };
    },
  };
}

type CatalogVariant = {
  _id?: unknown;
  name?: string;
  sku?: string;
  price?: number;
  stock?: number;
  image?: string;
  inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean } | null;
  preorder?: { enabled?: boolean | null } | null;
};

type CatalogProduct = {
  _id: unknown;
  title?: string;
  name?: string;
  sku?: string;
  price?: number;
  stock?: number;
  images?: string[];
  status?: string;
  vendorId?: unknown;
  priceOnRequest?: boolean;
  shipping?: { isPhysicalProduct?: boolean } | null;
  inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean } | null;
  preorder?: { enabled?: boolean | null } | null;
  variants?: CatalogVariant[];
};

const CATALOG_FIELDS =
  "title name sku price stock images status vendorId priceOnRequest shipping inventory preorder variants";

const variantLabel = (variant?: CatalogVariant) =>
  variant?.name && variant.name !== "Default Title" ? variant.name : "";

function lineName(product: CatalogProduct, variant?: CatalogVariant) {
  const name = product.title || product.name || "Product";
  const label = variantLabel(variant);
  return label ? `${name} - ${label}` : name;
}

/** Units that can go out now, or null when stock is no limit. */
function availableNow(product: CatalogProduct, variant?: CatalogVariant): number | null {
  const policy = { shipping: product.shipping, inventory: variant?.inventory ?? product.inventory };
  const available = getPurchasableQuantity(policy, variant ? variant.stock : product.stock);
  return available >= UNTRACKED_PURCHASE_CAP ? null : available;
}

type ExchangeProductOption = {
  key: string;
  productId: string;
  variantId?: string;
  name: string;
  sku: string;
  price: number;
  /** Units that can go out now; null when stock is no limit. */
  available: number | null;
  image?: string;
};

/**
 * What the store can send in exchange for this return: the returning seller's
 * products that are for sale, sent as a parcel and priced — one option per
 * variant, as the admin order form lists them.
 */
export async function searchExchangeProducts(params: {
  returnRequest: Parameters<typeof returnSellerId>[0];
  search?: string;
  settings: Settings;
}): Promise<ExchangeProductOption[]> {
  const sellerId = returnSellerId(params.returnRequest);
  if (!sellerId) return [];
  const scope = await sellerScope(params.settings);
  const sellerFilter = scope.productFilter(sellerId);
  if (!sellerFilter) return [];

  const search = String(params.search || "").trim().slice(0, 100);
  const pattern = search ? new RegExp(escapeRegExp(search), "i") : null;
  const products = await Product.find({
    $and: [
      {
        status: "active",
        "shipping.isPhysicalProduct": { $ne: false },
        priceOnRequest: { $ne: true },
        "preorder.enabled": { $ne: true },
      },
      sellerFilter,
      ...(pattern
        ? [{ $or: [{ title: pattern }, { name: pattern }, { sku: pattern }, { "variants.sku": pattern }] }]
        : []),
    ],
  })
    .select(CATALOG_FIELDS)
    .sort({ updatedAt: -1 })
    .limit(20)
    .lean<CatalogProduct[]>();

  return products.flatMap((product) => {
    const variants = product.variants || [];
    if (variants.length === 0) {
      return [
        {
          key: `${idOf(product._id)}:default`,
          productId: idOf(product._id),
          name: lineName(product),
          sku: product.sku || "",
          price: Number(product.price ?? 0),
          available: availableNow(product),
          image: product.images?.[0],
        },
      ];
    }
    return variants
      .filter((variant) => !variant.preorder?.enabled)
      .map((variant) => ({
        key: `${idOf(product._id)}:${idOf(variant._id)}`,
        productId: idOf(product._id),
        variantId: idOf(variant._id),
        name: lineName(product, variant),
        sku: variant.sku || product.sku || "",
        price: Number(variant.price ?? product.price ?? 0),
        available: availableNow(product, variant),
        image: variant.image || product.images?.[0],
      }));
  });
}

type ExchangeLineInput = {
  productId: string;
  variantId?: string;
  quantity: number;
  /** The price for one, when the store lowers it; the catalog's otherwise. */
  unitPrice?: number | null;
};

/**
 * The lines the store chose, checked against the catalog as it is now: each
 * one sendable, from the returning seller, in stock, and never dearer than the
 * catalog — the store may only take money off.
 */
export async function resolveExchangeItems(params: {
  returnRequest: Parameters<typeof returnSellerId>[0];
  lines: ReadonlyArray<ExchangeLineInput>;
  settings: Settings;
  currency: string;
  /** Checked again when the order is made; stock moves in between. */
  checkStock?: boolean;
}): Promise<ReturnExchangeItem[]> {
  if (params.lines.length === 0) return [];
  if (params.lines.length > EXCHANGE_MAX_LINES) {
    throw new ValidationError(`An exchange can send at most ${EXCHANGE_MAX_LINES} items.`);
  }
  const sellerId = returnSellerId(params.returnRequest);
  if (!sellerId) {
    throw new ValidationError(
      "This return has items from more than one seller. An exchange comes from one seller only, so open a return per seller.",
    );
  }
  const scope = await sellerScope(params.settings);

  // The same product and variant twice is one line.
  const merged = new Map<string, ExchangeLineInput>();
  for (const line of params.lines) {
    if (!Types.ObjectId.isValid(line.productId)) {
      throw new ValidationError("One of the products to send doesn't exist.");
    }
    if (line.variantId && !Types.ObjectId.isValid(line.variantId)) {
      throw new ValidationError("One of the variants to send doesn't exist.");
    }
    const key = `${line.productId}:${line.variantId || ""}`;
    const seen = merged.get(key);
    merged.set(
      key,
      seen ? { ...seen, quantity: Number(seen.quantity) + Number(line.quantity) } : { ...line },
    );
  }

  const products = await Product.find({
    _id: { $in: [...new Set([...merged.values()].map((line) => line.productId))] },
  })
    .select(CATALOG_FIELDS)
    .lean<CatalogProduct[]>();
  const byId = new Map(products.map((product) => [idOf(product._id), product]));

  return [...merged.values()].map((line) => {
    const product = byId.get(line.productId);
    const variant = line.variantId
      ? product?.variants?.find((item) => idOf(item._id) === line.variantId)
      : undefined;
    if (product && line.variantId && !variant) {
      throw new ValidationError(`${lineName(product)}: that variant no longer exists.`);
    }
    const problem = exchangeProductProblem({
      product,
      variant,
      variantChosen: Boolean(variant),
    });
    if (problem || !product) {
      throw new ValidationError(product ? `${lineName(product, variant)}: ${problem}` : String(problem));
    }
    const name = lineName(product, variant);
    if (scope.vendorOf(product.vendorId) !== sellerId) {
      throw new ValidationError(
        `${name} is sold by another seller. An exchange comes from the seller whose items are coming back.`,
      );
    }
    const quantity = Math.floor(Number(line.quantity));
    if (!(quantity >= 1 && quantity <= 999)) {
      throw new ValidationError(`${name}: send between 1 and 999.`);
    }
    if (params.checkStock !== false) {
      const available = availableNow(product, variant);
      if (available !== null && available < quantity) {
        throw new ValidationError(
          available > 0 ? `${name}: only ${available} left in stock.` : `${name} is out of stock.`,
        );
      }
    }
    const listPrice = quantizeToCurrency(
      Math.max(0, Number(variant?.price ?? product.price ?? 0)),
      params.currency,
    );
    const unitPrice =
      line.unitPrice === undefined || line.unitPrice === null
        ? listPrice
        : quantizeToCurrency(Number(line.unitPrice), params.currency);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new ValidationError(`${name}: the price can't be below 0.`);
    }
    if (unitPrice > listPrice + 0.005) {
      throw new ValidationError(
        `${name}: the price can only be lowered, not raised above ${listPrice}.`,
      );
    }
    return {
      productId: new Types.ObjectId(idOf(product._id)),
      ...(variant ? { variantId: new Types.ObjectId(idOf(variant._id)) } : {}),
      vendorId: new Types.ObjectId(sellerId),
      name,
      sku: variant?.sku || product.sku || "",
      image: variant?.image || product.images?.[0],
      quantity,
      unitPrice,
      listPrice,
    };
  });
}

/** Whether a customer id belongs to an account — a guest order's names its cart. */
async function hasAccount(customerId: unknown): Promise<boolean> {
  const id = idOf(customerId);
  if (!Types.ObjectId.isValid(id)) return false;
  return Boolean(await User.exists({ _id: id }).catch(() => null));
}

/**
 * Whether the credit-first part of a refund on this order goes back by hand
 * rather than as store credit: a guest's exchange order (R7), whose shopper
 * has no account to hold credit. The store's rule, 2026-09-29.
 */
export async function exchangeCreditGoesByHand(order: {
  customerId?: unknown;
  exchangeOf?: { returnId?: unknown } | null;
} | null | undefined): Promise<boolean> {
  if (!order?.exchangeOf?.returnId) return false;
  return !(await hasAccount(order.customerId));
}

type RefundOrderShape = Parameters<typeof createRefundTransaction>[0]["order"];

/**
 * The credit-first part of a refund on a guest's exchange order (R7), owed by
 * hand: with no account to hold it as credit, the shopper is sent the money,
 * as for any refund no gateway carries. Counted as the order's credit going
 * back all the same — its card never took this part, so never gives it back.
 */
export async function refundExchangeCreditByHand(params: {
  order: RefundOrderShape;
  amount: number;
  /** The refund's split, for the whole of `wholeAmount`. */
  allocation?: RefundAllocationShare[] | null;
  wholeAmount?: number;
  consignmentIds?: ReadonlyArray<unknown> | null;
  reason?: string;
  createdBy: string;
  metadata?: Record<string, unknown>;
}): Promise<{ refundTransactionId: string; lotId: string }> {
  const currency = String(params.order.currency || "USD").toUpperCase();
  const amount = quantizeToCurrency(Math.max(0, Number(params.amount) || 0), currency);
  if (!(amount > 0)) throw new ValidationError("Nothing to refund");
  const row = await createRefundTransaction({
    order: params.order,
    amount,
    reason: params.reason || "Refund of an exchange",
    createdBy: params.createdBy,
    gatewayCalled: false,
    allocation:
      params.allocation && params.wholeAmount && params.wholeAmount > amount + 0.001
        ? scaleRefundAllocation(params.allocation, amount, currency)
        : params.allocation ?? null,
    settlement: "required",
    source: "exchange-hand-refund",
    // Never through the order's own charge: the return paid this part.
    apartFromCharge: true,
    metadata: { ...(params.metadata || {}), exchangeCreditByHand: true },
    consignmentIds: params.consignmentIds,
  });
  if (!row) throw new ValidationError("The refund could not be recorded");
  await Order.updateOne(
    { _id: params.order._id },
    { $inc: { "storeCredit.refunded": amount } },
  );
  return { refundTransactionId: idOf(row._id), lotId: "" };
}

/**
 * Take an exchange's refund row back off the returned order: marked failed,
 * as a gateway's refused refund is, so the books and the ledger pass reverse
 * it the same way — against the credit it was booked to.
 */
async function reverseExchangeCreditRow(params: {
  rowId: unknown;
  orderId: unknown;
  amount: number;
  why: string;
}): Promise<boolean> {
  const claimed = await PaymentTransaction.findOneAndUpdate(
    { _id: params.rowId, type: "refund", status: "succeeded" },
    {
      $set: {
        status: "failed",
        "metadata.reversedAt": new Date(),
        "metadata.reversedReason": params.why,
      },
    },
  )
    .select("_id")
    .lean();
  if (!claimed) return false;
  await Order.updateOne(
    { _id: params.orderId },
    { $inc: { "storeCredit.refunded": -params.amount } },
  );
  const { postRefundReversalSafely } = await import("@/lib/finance/post-events");
  postRefundReversalSafely({
    orderId: params.orderId,
    amount: params.amount,
    refundId: params.rowId,
    note: params.why,
  });
  return true;
}

/**
 * Make the exchange order a processed return pays for (R7).
 *
 * The return's money comes off the returned order as a refund to credit — the
 * sale reversed with the same split any refund of these goods would use — and
 * that credit pays the exchange order, so nothing moves through a gateway and
 * the store's cash never changes. The exchange order is an ordinary order from
 * here: shipped, labelled, paid out and refunded the usual way. When the
 * shopper still owes part of it, it waits for that payment like any unpaid
 * order, and cannot be fulfilled until it lands.
 *
 * Called with the refund already claimed on the return and the order. A
 * failure puts back what was written here, so the caller can hand the claims
 * back as for any refund that did not happen.
 */
export async function createReturnExchangeOrder(params: {
  returnRequest: {
    _id: unknown;
    returnNumber?: string;
    orderNumber?: string;
    vendorIds?: ReadonlyArray<unknown> | null;
    items?: ReadonlyArray<{ vendorId?: unknown }> | null;
    exchangeItems?: ReadonlyArray<ReturnExchangeItem> | null;
  };
  /** The returned order, as it stands after the claim. */
  order: {
    _id: unknown;
    orderNumber?: string;
    customerId?: unknown;
    guestEmail?: string | null;
    customerLocale?: string | null;
    shippingAddress?: unknown;
    billingAddress?: unknown;
  };
  /** The returned order, shaped for its refund row. */
  refundOrder: RefundOrderShape;
  price: ExchangePrice;
  /** What of the return pays for the exchange order. */
  credit: number;
  /** The refund's split across sellers, for the whole of `wholeAmount`. */
  allocation?: RefundAllocationShare[] | null;
  wholeAmount: number;
  settings: Settings;
  createdBy: string;
  audit: AuditContext;
}): Promise<{
  refundTransactionId: string;
  orderId: string;
  orderNumber: string;
  total: number;
  owed: number;
}> {
  const { returnRequest, order, settings } = params;
  const currency = String(params.refundOrder.currency || "USD").toUpperCase();
  const credit = quantizeToCurrency(Math.max(0, Number(params.credit) || 0), currency);
  if (!(credit > 0)) throw new ValidationError("Nothing of this return is left to exchange");
  const returnNumber = String(returnRequest.returnNumber || "");
  const orderNumber = String(returnRequest.orderNumber || order.orderNumber || "");

  // Checked against the catalog once more: it may have changed since the
  // items were chosen. Stock is left to the order itself, which takes it.
  const items = await resolveExchangeItems({
    returnRequest,
    lines: (returnRequest.exchangeItems || []).map((item) => ({
      productId: idOf(item.productId),
      variantId: item.variantId ? idOf(item.variantId) : undefined,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
    })),
    settings,
    currency,
    checkStock: false,
  });
  if (items.length === 0) throw new ValidationError("Choose what to send in exchange.");
  const lines = await resolveAdminOrderLines(
    items.map((item) => ({
      productId: idOf(item.productId),
      variantId: item.variantId ? idOf(item.variantId) : undefined,
      quantity: item.quantity,
      price: item.unitPrice,
    })),
  );
  const owed = quantizeToCurrency(Math.max(0, params.price.total - credit), currency);

  const row = await createRefundTransaction({
    order: params.refundOrder,
    amount: credit,
    reason: `Return ${returnNumber}: exchanged`,
    createdBy: params.createdBy,
    gatewayCalled: false,
    allocation:
      params.allocation && params.wholeAmount > credit + 0.001
        ? scaleRefundAllocation(params.allocation, credit, currency)
        : params.allocation ?? null,
    // Nothing to send: the money paid for the exchange order.
    settlement: "not_required",
    notifySettlement: false,
    source: "return-exchange",
    metadata: {
      storeCredit: true,
      exchange: { returnId: idOf(returnRequest._id), returnNumber },
    },
  });
  if (!row) throw new ValidationError("The exchange could not be recorded");
  // Given back as credit, as far as later refunds of this order are concerned:
  // its card never gave this part back — see `orderGatewayRefundRoom`.
  await Order.updateOne({ _id: order._id }, { $inc: { "storeCredit.refunded": credit } });

  let exchangeOrder: Awaited<ReturnType<typeof createAdminOrder>>;
  try {
    exchangeOrder = await createAdminOrder({
      settings,
      lines,
      customerId: order.customerId,
      guestEmail: order.guestEmail || undefined,
      shippingAddress: (order.shippingAddress || {}) as Record<string, unknown>,
      billingAddress: (order.billingAddress || order.shippingAddress || {}) as Record<
        string,
        unknown
      >,
      shippingCost: params.price.shipping,
      // Nothing order-wide: only the prices the store set per item.
      discount: 0,
      taxRate: params.price.taxRate,
      paymentMethod: "store_credit",
      paymentStatus: owed > 0 ? PAYMENT_STATUS.PENDING : PAYMENT_STATUS.PAID,
      // No note: the order page says what it is from `exchangeOf`.
      actorId: params.createdBy,
      audit: params.audit,
      source: "exchange",
      returnNumber,
      // The return's own notice tells the shopper about this order.
      customerNotified: true,
      extra: {
        // The return pays first. Held while the shopper still owes the rest,
        // spent once that lands — with no hold behind it: it is the return's
        // money, not credit on their account.
        storeCredit: { applied: credit, state: owed > 0 ? "held" : "spent" },
        exchangeOf: {
          returnId: new Types.ObjectId(idOf(returnRequest._id)),
          returnNumber,
          orderId: new Types.ObjectId(idOf(order._id)),
          orderNumber,
        },
        ...(order.customerLocale ? { customerLocale: order.customerLocale } : {}),
      },
    });
  } catch (error) {
    // No order, no exchange: the refund row comes back off the returned order.
    await reverseExchangeCreditRow({
      rowId: row._id,
      orderId: order._id,
      amount: credit,
      why: "The exchange order could not be made",
    }).catch((undoError) =>
      console.error("Failed to take back an exchange that made no order:", undoError),
    );
    throw error;
  }

  await PaymentTransaction.updateOne(
    { _id: row._id },
    {
      $set: {
        note: `Return ${returnNumber}: exchanged for order #${exchangeOrder.orderNumber}`,
        "metadata.exchange.orderId": exchangeOrder._id,
        "metadata.exchange.orderNumber": exchangeOrder.orderNumber,
      },
    },
  ).catch((error) => console.error("Failed to link an exchange's refund row to its order:", error));

  return {
    refundTransactionId: idOf(row._id),
    orderId: idOf(exchangeOrder._id),
    orderNumber: String(exchangeOrder.orderNumber),
    total: Number(exchangeOrder.total || 0),
    owed,
  };
}

type ExchangeOrderLike = {
  _id: unknown;
  orderNumber?: string;
  currency?: string;
  customerId?: unknown;
  exchangeOf?: {
    returnId?: unknown;
    returnNumber?: string;
    orderId?: unknown;
    orderNumber?: string;
    undoneAt?: Date | string | null;
  } | null;
};

/**
 * Call off an exchange whose order was cancelled (R7): what the return paid
 * for it goes back to the return, which can be refunded — or exchanged — again.
 *
 * The returned order's exchange refund comes off it again, as though the
 * exchange had never been processed. What the shopper already got back of it
 * as credit on a refund of the exchange order stays theirs, and stays counted
 * on the return.
 *
 * `amount` is what of the return the exchange order still holds. On a paid
 * order it comes off that order as a refund to credit — its sale reversed, the
 * caller having claimed it; on one never paid there was no sale, and its
 * credit simply paid for nothing.
 */
export async function undoReturnExchange(params: {
  exchangeOrder: ExchangeOrderLike;
  amount: number;
  /** The exchange order took its payment: its sale is reversed with a row of its own. */
  paid: boolean;
  /** The exchange order, shaped for that row. */
  refundOrder?: RefundOrderShape;
  consignmentIds?: ReadonlyArray<unknown> | null;
  reason?: string;
  createdBy?: string;
  auditContext?: AuditContext;
}): Promise<{ undone: boolean; amount: number }> {
  const { exchangeOrder } = params;
  if (!isActiveExchangeOrder(exchangeOrder)) return { undone: false, amount: 0 };
  const now = new Date();
  // Once: a cancel run twice, or by two routes at once, finds it done.
  const claimed = await Order.findOneAndUpdate(
    {
      _id: exchangeOrder._id,
      "exchangeOf.returnId": { $exists: true },
      "exchangeOf.undoneAt": { $exists: false },
    },
    { $set: { "exchangeOf.undoneAt": now } },
  )
    .select("_id")
    .lean();
  if (!claimed) return { undone: false, amount: 0 };

  const returnId = idOf(exchangeOrder.exchangeOf?.returnId);
  const returnRequest = await ReturnRequest.findById(returnId)
    .select("returnNumber orderId orderNumber status exchange actualRefund")
    .lean<{
      _id: unknown;
      returnNumber?: string;
      orderId?: unknown;
      orderNumber?: string;
      exchange?: {
        orderId?: unknown;
        credit?: number;
        statusBefore?: string;
        refundTransactionId?: unknown;
        undoneAt?: Date;
      };
    } | null>();
  const exchange = returnRequest?.exchange;
  if (!returnRequest || !exchange || idOf(exchange.orderId) !== idOf(exchangeOrder._id)) {
    console.error(
      `Exchange order ${exchangeOrder.orderNumber} was cancelled, but its return could not be found to put the money back on.`,
    );
    return { undone: false, amount: 0 };
  }
  const currency = String(exchangeOrder.currency || "USD").toUpperCase();
  const whole = quantizeToCurrency(Math.max(0, Number(exchange.credit) || 0), currency);
  const back = quantizeToCurrency(Math.min(whole, Math.max(0, Number(params.amount) || 0)), currency);
  // What the shopper already had back of it, on a refund of the exchange order.
  const kept = quantizeToCurrency(whole - back, currency);
  const returnNumber = String(returnRequest.returnNumber || exchangeOrder.exchangeOf?.returnNumber || "");
  const why = params.reason || `Exchange order #${exchangeOrder.orderNumber} cancelled`;

  // The exchange order's side.
  if (params.paid && back > 0 && params.refundOrder) {
    await createRefundTransaction({
      order: params.refundOrder,
      amount: back,
      reason: `Exchange called off: back on return ${returnNumber}`,
      createdBy: params.createdBy,
      gatewayCalled: false,
      settlement: "not_required",
      notifySettlement: false,
      source: "exchange-undo",
      metadata: { storeCredit: true, exchangeUndo: { returnId, returnNumber } },
      consignmentIds: params.consignmentIds,
    });
    await Order.updateOne(
      { _id: exchangeOrder._id },
      { $inc: { "storeCredit.refunded": back } },
    );
  } else if (!params.paid) {
    // Never paid, so the credit paid for nothing.
    await Order.updateOne(
      { _id: exchangeOrder._id },
      { $set: { "storeCredit.state": "released" } },
    );
  }

  // The returned order's side: its exchange refund comes off, and whatever
  // the shopper kept of it is recorded again on its own.
  const originalId = returnRequest.orderId;
  const original = await Order.findById(originalId).lean<Record<string, unknown> & {
    _id: unknown;
    orderNumber?: string;
    currency?: string;
    total?: number;
  } | null>();
  if (original && exchange.refundTransactionId) {
    const reversed = await reverseExchangeCreditRow({
      rowId: exchange.refundTransactionId,
      orderId: originalId,
      amount: whole,
      why,
    });
    if (reversed && kept > 0) {
      await createRefundTransaction({
        order: {
          _id: idOf(original._id),
          orderNumber: String(original.orderNumber || ""),
          paymentMethod: original.paymentMethod as string | undefined,
          paymentStatus: original.paymentStatus as string | undefined,
          subtotal: original.subtotal as number | undefined,
          shippingCost: original.shippingCost as number | undefined,
          tax: original.tax as number | undefined,
          discount: original.discount as number | undefined,
          total: original.total,
          currency: original.currency || currency,
          channel: (original.channel as string | undefined) || "online",
          createdAt: original.createdAt as Date | undefined,
        },
        amount: kept,
        reason: `Return ${returnNumber}: what exchange order #${exchangeOrder.orderNumber} already gave back`,
        createdBy: params.createdBy,
        gatewayCalled: false,
        settlement: "not_required",
        notifySettlement: false,
        source: "return-exchange",
        metadata: {
          storeCredit: true,
          exchange: { returnId, returnNumber, kept: true },
        },
      });
      await Order.updateOne(
        { _id: originalId },
        { $inc: { "storeCredit.refunded": kept } },
      );
    }
    if (reversed) {
      const { getOrderRefundCeiling } = await import("@/lib/orders/preorder-cancel-refund");
      const ceiling = getOrderRefundCeiling({
        ...(original as Parameters<typeof getOrderRefundCeiling>[0]),
        currency: String(original.currency || currency),
      });
      await Order.updateOne(
        { _id: originalId },
        { $inc: { refundedTotal: -back }, $unset: { goodsRefundedAt: "" } },
      );
      // Its payment reads again what its refunds now come to.
      await Order.updateOne(
        {
          _id: originalId,
          paymentStatus: {
            $in: [PAYMENT_STATUS.PAID, PAYMENT_STATUS.PARTIALLY_REFUNDED, PAYMENT_STATUS.REFUNDED],
          },
        },
        [
          {
            $set: {
              paymentStatus: {
                $cond: [
                  { $gt: [{ $ifNull: ["$refundedTotal", 0] }, 0.001] },
                  {
                    $cond: [
                      { $gte: [{ $ifNull: ["$refundedTotal", 0] }, ceiling - 0.01] },
                      PAYMENT_STATUS.REFUNDED,
                      PAYMENT_STATUS.PARTIALLY_REFUNDED,
                    ],
                  },
                  PAYMENT_STATUS.PAID,
                ],
              },
            },
          },
        ],
      );
      // The points the exchange took off the returned order come back.
      const { reverseOrderLoyaltyPoints } = await import("@/lib/customers/customer");
      await reverseOrderLoyaltyPoints(idOf(originalId)).catch((error) =>
        console.error("Failed to restore loyalty points after an exchange was called off:", error),
      );
    }
  }

  // The return's side: open to refund again for what came back.
  const statusBefore = String(exchange.statusBefore || RETURN_STATUS.RECEIVED);
  await ReturnRequest.updateOne(
    { _id: returnRequest._id, "exchange.orderId": exchangeOrder._id, "exchange.undoneAt": { $exists: false } },
    [
      {
        $set: {
          "actualRefund.amount": {
            $max: [0, { $subtract: [{ $ifNull: ["$actualRefund.amount", 0] }, back] }],
          },
          "actualRefund.exchange": {
            $max: [0, { $subtract: [{ $ifNull: ["$actualRefund.exchange", 0] }, back] }],
          },
          "exchange.undoneAt": now,
          "exchange.undoneReason": why,
        },
      },
      {
        $set: {
          status: {
            $cond: [
              { $gt: ["$actualRefund.amount", 0.01] },
              RETURN_STATUS.PARTIALLY_REFUNDED,
              statusBefore,
            ],
          },
          refundStatus: {
            $cond: [
              { $gt: ["$actualRefund.amount", 0.01] },
              "$refundStatus",
              RETURN_REFUND_STATUS.PENDING,
            ],
          },
          refundedAt: {
            $cond: [{ $gt: ["$actualRefund.amount", 0.01] }, "$refundedAt", "$$REMOVE"],
          },
          closedAt: "$$REMOVE",
        },
      },
    ],
  );

  const { auditOrderExchangeUndone, systemActor } = await import("@/lib/orders/audit-order");
  const audit = params.auditContext || systemActor();
  for (const target of [
    { _id: idOf(originalId), orderNumber: String(returnRequest.orderNumber || "") },
    { _id: idOf(exchangeOrder._id), orderNumber: String(exchangeOrder.orderNumber || "") },
  ]) {
    await auditOrderExchangeUndone(audit, target, {
      returnNumber,
      exchangeOrderNumber: String(exchangeOrder.orderNumber || ""),
      amount: back,
      currency,
    }).catch((error) => console.error("Failed to audit a called-off exchange:", error));
  }
  return { undone: true, amount: back };
}
