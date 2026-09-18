import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Order, Product } from "@/models";
import { getNextPosOrderNumber } from "@/lib/orders/order-number";
import { DEFAULT_VENDOR_COMMISSION_RATE } from "@/lib/orders/order-settings";
import { createdResponse } from "@/lib/api/response";
import {
  handleApiError,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
} from "@/lib/api/errors";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { USER_ROLES, ORDER_STATUS } from "@/config/app.config";
import { isStaffRole } from "@/lib/access/staff-role";
import { getSettingsLean } from "@/models";
import {
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
  toStripeAmount,
} from "@/lib/payments/stripe";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import {
  decrementInventory,
  restoreInventory,
  InsufficientStockError,
} from "@/lib/inventory/inventory";
import { markOrderInventoryReserved } from "@/lib/orders/order-inventory";
import { resolvePOSLocationId } from "@/lib/pos/resolve-location";
import { canAccessPOS } from "@/lib/access/rbac";
import { assertPosDiscountAllowed } from "@/lib/pos/pos-discount-guard";
import { findOversoldLines } from "@/lib/pos/oversold";
import { notifyPOSOversold } from "@/lib/pos/notify-oversold";
import { ensureChargeTransaction } from "@/lib/payments/payment-transactions";
import { createAuditContext } from "@/lib/audit";
import { auditOrderPaid, auditOrderPlaced } from "@/lib/orders/audit-order";
import {
  buildVendorSubOrders,
  getOrderItemVendorId,
  groupItemsByOrderVendor,
  resolveOrderVendorContextForItems,
} from "@/lib/orders/order-vendors";
import { notifyOrderCreatedParticipants } from "@/lib/notifications/notifications";
import { validatePOSPaymentInput } from "@/lib/pos/payment";
import {
  calculatePOSOrderTotals,
  computePOSLineDiscountAmount,
  type POSOrderDiscountInput,
  type POSOrderItemInput,
} from "@/lib/pos/order-totals";
import { resolveLocationScope } from "@/lib/inventory/inventory-location-scope";
import { resolveOrderItemCost } from "@/lib/products/item-cost";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

const PosLineDiscountSchema = z.object({
  type: z.enum(["percent", "amount"]),
  value: z.number(),
  amount: z.number().optional(),
});
const PosOrderItemSchema = z.object({
  productId: z.string().max(64),
  variantId: z.string().max(64).optional(),
  name: z.string().max(500),
  sku: z.string().max(200),
  price: z.number(),
  quantity: z.number(),
  image: z.string().max(2048).optional(),
  vendorId: z.string().max(64),
  lineTotal: z.number().optional(),
  lineDiscount: PosLineDiscountSchema.optional(),
  lineNote: z.string().max(1000).optional(),
});
// Shape check; presence ("Items are required", "Payment method is required")
// and every business rule stay below so the terminal's messages do not change.
const PosOrderSchema = z.object({
  items: z.array(PosOrderItemSchema).max(500).optional(),
  paymentMethod: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
  posLocationId: z.string().max(64).optional(),
  customerId: z.string().max(64).optional(),
  cashTendered: z.union([z.number(), z.string().max(40)]).optional(),
  paymentReference: z.string().max(200).optional(),
  paymentNote: z.string().max(1000).optional(),
  stripePaymentIntentId: z.string().max(200).optional(),
  discount: z
    .object({
      type: z.enum(["percent", "amount"]),
      value: z.number(),
      amount: z.number(),
      reason: z.string().max(500).optional(),
      note: z.string().max(1000).optional(),
    })
    .optional(),
  clientRequestId: z.string().max(100).optional(),
  localReceiptNumber: z.string().max(100).optional(),
});

async function generatePosOrderNumber(prefix?: string) {
  return getNextPosOrderNumber(prefix || "POS");
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === 11000
  );
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new AuthenticationError();
    const role = session.user.role;
    if (
      role !== USER_ROLES.ADMIN &&
      role !== USER_ROLES.VENDOR &&
      !isStaffRole(role)
    ) {
      throw new AuthorizationError();
    }

    await connectDB();
    const settings = await getSettingsLean();
    if (!(await canAccessPOS(session.user))) {
      throw new AuthorizationError();
    }

    const body = await validateBody(request, PosOrderSchema);
    const {
      items,
      paymentMethod,
      notes,
      posLocationId: requestedPosLocationId,
      customerId,
      cashTendered,
      paymentReference,
      paymentNote,
      stripePaymentIntentId,
      discount,
      clientRequestId,
      localReceiptNumber,
    }: {
      items?: POSOrderItemInput[];
      paymentMethod?: string;
      notes?: string;
      posLocationId?: string;
      customerId?: string;
      cashTendered?: number | string;
      paymentReference?: string;
      paymentNote?: string;
      stripePaymentIntentId?: string;
      discount?: POSOrderDiscountInput;
      clientRequestId?: string;
      localReceiptNumber?: string;
    } = body;

    if (!Array.isArray(items) || items.length === 0) {
      throw new ValidationError("Items are required");
    }
    if (!paymentMethod) {
      throw new ValidationError("Payment method is required");
    }

    // Idempotency: a cashier retry after a network blip must return the order
    // the first attempt already committed, not ring up a second sale.
    const normalizedClientRequestId =
      typeof clientRequestId === "string" &&
      /^[A-Za-z0-9_-]{8,64}$/.test(clientRequestId.trim())
        ? clientRequestId.trim()
        : undefined;
    // Same shape as the idempotency key: terminal prefix plus a counter, from
    // `lib/pos/offline-receipt.ts`. Validated rather than trusted so a crafted
    // body cannot write arbitrary text onto a customer-facing record.
    const normalizedLocalReceiptNumber =
      typeof localReceiptNumber === "string" &&
      /^[A-Za-z0-9-]{3,32}$/.test(localReceiptNumber.trim())
        ? localReceiptNumber.trim()
        : undefined;

    if (normalizedClientRequestId) {
      const existingSale = await Order.findOne({
        posClientRequestId: normalizedClientRequestId,
        staffId: session.user.id,
      }).lean();
      if (existingSale) {
        return createdResponse(existingSale);
      }
    }

    // Validate item shape before pricing. Quantity must be a positive whole
    // number: fractional/negative quantities would skew the client-computed
    // total while inventory only ever decrements positive lines.
    for (const item of items) {
      if (!item || !String(item.productId || "").trim()) {
        throw new ValidationError("Each item must reference a product");
      }
      if (
        typeof item.quantity !== "number" ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1
      ) {
        throw new ValidationError(
          "Item quantity must be a positive whole number",
        );
      }
      if (
        item.lineDiscount &&
        (typeof item.lineDiscount.value !== "number" ||
          item.lineDiscount.value < 0)
      ) {
        throw new ValidationError("Line discount must not be negative");
      }
    }
    if (discount && (typeof discount.value !== "number" || discount.value < 0)) {
      throw new ValidationError("Discount must not be negative");
    }
    await assertPosDiscountAllowed(session.user, { items, discount });

    const productIds = Array.from(
      new Set(
        items.map((item) => String(item.productId || "").trim()).filter(Boolean),
      ),
    );
    if (productIds.length === 0) {
      throw new ValidationError("Items are required");
    }

    // Load authoritative product/variant prices. POS clients MUST NOT be
    // trusted for the price — resolving it server-side is the only thing
    // preventing a $0.01 "sale" that still decrements real stock.
    // `cost` rides along for the margin snapshot on each line — the register is
    // the one channel where the seller is always the principal, so its gross
    // profit is the figure a shop owner asks for first.
    // `stock`, `locationInventory` and the two stock-policy blocks ride along
    // for `findOversoldLines`: without them every non-variant product reads as
    // `available: 0`, so an offline replay would report a shortfall that never
    // happened — and a digital or untracked line would lose the exemption that
    // keeps it out of the report entirely. Mirrors PRODUCT_FIELDS in
    // lib/pos/list-products.ts, which exists for the same reason.
    const affectedProducts = await Product.find({ _id: { $in: productIds } })
      .select(
        // `name` too: without it a genuine oversell alert reads "Product: sold
        // 3, 0 on hand", which tells the merchant nothing about which shelf to
        // recount — the one thing the alert exists to say.
        "_id name slug price cost vendorId variants stock locationInventory " +
          "shipping.isPhysicalProduct inventory.tracked " +
          "inventory.continueSellingWhenOutOfStock",
      )
      .lean();
    const productById = new Map(
      affectedProducts.map((product) => [String(product._id), product]),
    );

    // A register may only ring up its own merchant's catalogue. This used to run
    // for vendors alone, which left the higher-privilege sessions unchecked: an
    // admin or staff POST could name any product id at all and complete a real,
    // inventory-decrementing sale against another merchant's stock. The read
    // path is scoped the same way — see `lib/pos/list-products.ts`.
    const scope = await resolveLocationScope(session.user, "write");
    const vendorScopeId = scope.vendorId;
    for (const productId of productIds) {
      const product = productById.get(productId);
      if (!product || String(product.vendorId) !== vendorScopeId) {
        throw new AuthorizationError(
          "This register can only sell its own products",
        );
      }
    }

    const resolvePosItemPrice = (item: POSOrderItemInput): number => {
      const product = productById.get(String(item.productId).trim());
      if (!product) {
        throw new ValidationError("A selected product no longer exists");
      }
      const variants = (product.variants || []) as Array<{
        _id: unknown;
        price?: number;
      }>;
      if (item.variantId) {
        const variant = variants.find(
          (candidate) => String(candidate._id) === String(item.variantId),
        );
        if (!variant) {
          throw new ValidationError("A selected variant no longer exists");
        }
        if (typeof variant.price === "number") return variant.price;
      }
      if (typeof product.price === "number") return product.price;
      throw new ValidationError("A selected product has no price");
    };

    const normalizedItems: POSOrderItemInput[] = items.map((item) => ({
      ...item,
      price: resolvePosItemPrice(item),
      ...(vendorScopeId ? { vendorId: vendorScopeId } : {}),
    }));

    const taxRate = settings.orders?.taxRate ?? 0;
    const { subtotal, tax, shippingCost, totalDiscount, total } =
      calculatePOSOrderTotals({
        items: normalizedItems,
        discount,
        taxRate,
      });
    const normalizedStripeIntentId =
      typeof stripePaymentIntentId === "string"
        ? stripePaymentIntentId.trim()
        : "";
    const payment = validatePOSPaymentInput({
      paymentMethod,
      enabledMethods: settings.pos?.checkout?.paymentMethods,
      total,
      cashTendered,
      paymentReference: paymentReference || normalizedStripeIntentId,
      paymentNote,
    });
    if (!payment.ok) {
      throw new ValidationError(payment.message);
    }

    let verifiedStripePaymentIntentId: string | undefined;
    if (payment.metadata.posPayment.cardSubMethod === "card_stripe") {
      if (!normalizedStripeIntentId) {
        throw new ValidationError("Stripe payment intent is required");
      }
      const existingStripeOrder = await Order.findOne({
        stripePaymentIntentId: normalizedStripeIntentId,
      })
        .select("_id orderNumber")
        .lean();
      if (existingStripeOrder) {
        throw new ValidationError("Stripe payment has already been used");
      }

      const stripeSettings = settings.payment?.stripe;
      if (!stripeSettings?.enabled) {
        throw new ValidationError("Stripe is disabled");
      }
      const stripeSecretKey = resolveStripeCredentials(stripeSettings).secretKey;
      if (!isStripeSecretKeyConfigured(stripeSecretKey)) {
        throw new ValidationError("Stripe is not configured");
      }

      const currency = (
        settings.general?.defaultCurrency || "USD"
      ).toLowerCase();
      const expectedAmount = toStripeAmount(total, currency);
      const intent = await getStripeForSecretKey(
        stripeSecretKey,
      ).paymentIntents.retrieve(normalizedStripeIntentId);
      if (intent.status !== "succeeded" && intent.status !== "processing") {
        throw new ValidationError("Stripe payment was not completed");
      }
      if (intent.amount !== expectedAmount || intent.currency !== currency) {
        throw new ValidationError(
          "Stripe payment amount does not match order total",
        );
      }
      verifiedStripePaymentIntentId = intent.id;
    }

    // Order number generated below with retry
    const vendorContext = await resolveOrderVendorContextForItems({
      isMultiVendorEnabled: Boolean(settings.multiVendorMode?.enabled),
      items: normalizedItems,
      getVendorId: (item) => item.vendorId,
      defaultVendorOwnerUserId:
        role === USER_ROLES.ADMIN ? session.user.id : undefined,
    });
    const vendorItems = groupItemsByOrderVendor(
      normalizedItems,
      vendorContext,
      (item) => item.vendorId,
    );
    const subOrders = await buildVendorSubOrders(vendorItems, {
      codCollectedByDefault: settings.shipping?.codCollectedBy,
      getProductId: (item) => item.productId,
      getVariantId: (item) => item.variantId,
      getName: (item) => item.name,
      getSku: (item) => item.sku,
      getQuantity: (item) => item.quantity,
      getPrice: (item) => item.price,
      getCost: (item) =>
        resolveOrderItemCost({
          product: productById.get(String(item.productId).trim()),
          variantId: item.variantId,
        }),
      getImage: (item) => item.image,
      getLineDiscount: (item) => item.lineDiscount ?? null,
      getLineNote: (item) =>
        typeof item.lineNote === "string" && item.lineNote.trim().length > 0
          ? item.lineNote.trim()
          : undefined,
      fallbackCommissionPercent:
        settings.orders?.commission?.vendorRate ?? DEFAULT_VENDOR_COMMISSION_RATE,
      status: ORDER_STATUS.DELIVERED,
    });

    // The register sends back the location the page resolved for it, but a
    // location id is a bare string with no ownership of its own — re-resolve it
    // here so a crafted body cannot draw stock from (or stamp a sale onto)
    // another merchant's counter, and so the decrement below scopes itself
    // exactly the way the grid the cashier was looking at did.
    const posLocationId = await resolvePOSLocationId(
      session.user,
      requestedPosLocationId,
    );

    // POS placeholder address (not applicable for in-store sales)
    const posAddress = {
      street: "In-store POS",
      city: "POS",
      state: "POS",
      postalCode: "00000",
      country: "POS",
    };

    /**
     * A sale replayed from a terminal's offline outbox.
     *
     * Only such a sale carries a provisional receipt number: it was printed at
     * the counter while the register had no connection, which is precisely the
     * window in which another terminal can have sold the last unit. The goods
     * are already gone and the money is already taken, so this sale is accepted
     * and the stock is allowed to go negative — refusing it would not recover
     * the goods, it would only leave no record of where they went.
     *
     * The marker is client-supplied, and deliberately so: this endpoint already
     * trusts an authenticated POS session to create orders and move this
     * merchant's stock. Driving one's own shelf count negative is a bookkeeping
     * outcome, not a new capability — which is exactly why it is recorded and
     * reported rather than merely permitted.
     */
    const isOfflineReplay = Boolean(normalizedLocalReceiptNumber);

    // Measured BEFORE the decrement, against the stock this register was
    // scoped to, so the report says what the shelf was actually short.
    const oversoldLines = isOfflineReplay
      ? findOversoldLines(normalizedItems, productById, posLocationId)
      : [];

    const orderData = {
      customerId: customerId || session.user.id,
      currency: settings.general?.defaultCurrency || "USD",
      posClientRequestId: normalizedClientRequestId,
      // Only set for a sale replayed from a terminal's offline outbox. The
      // customer left with this number, so it has to be findable even though
      // `orderNumber` is only assigned here, on arrival.
      posLocalReceiptNumber: normalizedLocalReceiptNumber,
      // Empty for the overwhelming majority of replays — a queue usually syncs
      // against stock that is still there. A non-empty list is the merchant's
      // signal that a shelf count needs correcting.
      posOversoldLines: oversoldLines.length > 0 ? oversoldLines : undefined,
      items: normalizedItems.map((item) => {
        const lineDiscountAmount = computePOSLineDiscountAmount(item);
        return {
          productId: item.productId,
          name: item.name,
          sku: item.sku,
          price: item.price,
          cost: resolveOrderItemCost({
            product: productById.get(String(item.productId).trim()),
            variantId: item.variantId,
          }),
          quantity: item.quantity,
          image: item.image,
          variantId: item.variantId,
          vendorId: getOrderItemVendorId(item.vendorId, vendorContext),
          lineDiscount: item.lineDiscount
            ? {
                type: item.lineDiscount.type,
                value: item.lineDiscount.value,
                amount: lineDiscountAmount,
              }
            : undefined,
          lineNote:
            typeof item.lineNote === "string" && item.lineNote.trim().length > 0
              ? item.lineNote.trim()
              : undefined,
        };
      }),
      subOrders,
      shippingAddress: posAddress,
      billingAddress: posAddress,
      paymentMethod: payment.method,
      paymentStatus: "paid",
      paidAt: new Date(),
      paymentId:
        verifiedStripePaymentIntentId ||
        (payment.method === "card" && payment.reference
          ? payment.reference
          : undefined),
      stripePaymentIntentId: verifiedStripePaymentIntentId,
      subtotal,
      shippingCost,
      tax,
      // Store the TOTAL discount (line + order-level) so finance reports,
      // sales ledger, and analytics all reflect the full markdown.
      discount: totalDiscount,
      discountMeta: discount
        ? {
            type: discount.type,
            value: discount.value,
            reason: discount.reason,
            note: discount.note,
          }
        : undefined,
      total,
      status: ORDER_STATUS.DELIVERED,
      notes,
      channel: "pos",
      posLocationId,
      staffId: session.user.id,
    };

    const inventoryLines = normalizedItems.map((item) => ({
      productId: String(item.productId),
      variantId: item.variantId ? String(item.variantId) : undefined,
      quantity: item.quantity,
    }));

    // Decrement inventory first so we never end up with a phantom order
    // referencing stock we couldn't actually reserve.
    try {
      await decrementInventory(inventoryLines, {
        channel: "pos",
        locationId: posLocationId,
        allowOversell: isOfflineReplay,
      });
    } catch (err) {
      if (err instanceof InsufficientStockError) {
        throw new ValidationError("Insufficient stock for one or more items");
      }
      throw err;
    }

    let order;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          order = await Order.create({
            ...orderData,
            orderNumber: await generatePosOrderNumber(
              settings.pos?.orders?.orderNumberPrefix,
            ),
          });
          break;
        } catch (err) {
          // A duplicate on the idempotency key means a concurrent retry of the
          // SAME sale already committed — hand back that order (after undoing
          // this attempt's decrement) instead of retrying with a new number.
          if (
            isDuplicateKeyError(err) &&
            normalizedClientRequestId &&
            String((err as Error).message || "").includes("posClientRequestId")
          ) {
            const committed = await Order.findOne({
              posClientRequestId: normalizedClientRequestId,
              staffId: session.user.id,
            }).lean();
            if (committed) {
              await restoreInventory(inventoryLines, {
                channel: "pos",
                locationId: posLocationId,
              }).catch((restoreErr) =>
                console.error(
                  "Failed to restore duplicate POS attempt inventory:",
                  restoreErr,
                ),
              );
              return createdResponse(committed);
            }
          }
          if (isDuplicateKeyError(err) && attempt < 2) continue;
          throw err;
        }
      }
    } catch (err) {
      await restoreInventory(inventoryLines, {
        channel: "pos",
        locationId: posLocationId,
      }).catch((restoreErr) =>
        console.error("Failed to restore inventory after POS order failure:", restoreErr),
      );
      throw err;
    }

    if (!order) {
      await restoreInventory(inventoryLines, {
        channel: "pos",
        locationId: posLocationId,
      }).catch((restoreErr) =>
        console.error("Failed to restore inventory after POS order failure:", restoreErr),
      );
      throw new Error("Failed to create POS order after retries");
    }

    // Inventory was decremented before the order was created, so the
    // sub-orders should be marked reserved now that we have the order ID.
    await markOrderInventoryReserved(String(order._id)).catch((err) =>
      console.error("Failed to mark inventory reserved on POS order:", err),
    );

    await ensureChargeTransaction({
      _id: String(order._id),
      orderNumber: order.orderNumber,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      paymentId: order.paymentId,
      stripePaymentIntentId: order.stripePaymentIntentId,
      paypalCaptureId: order.paypalCaptureId,
      subtotal: order.subtotal,
      shippingCost: order.shippingCost,
      tax: order.tax,
      discount: order.discount,
      total: order.total,
      paymentFee: order.paymentFee,
      paymentFeeCurrency: order.paymentFeeCurrency,
      paymentFeeRate: order.paymentFeeRate,
      currency: settings.general?.defaultCurrency,
      channel: order.channel,
      posLocationId: order.posLocationId ? String(order.posLocationId) : undefined,
      paymentMetadata: payment.metadata,
      createdAt: order.createdAt,
    });

    await notifyOrderCreatedParticipants(order).catch((err) =>
      console.error("Failed to create POS order notifications:", err),
    );

    // Raised after the order is safely committed: the sale is never held up by
    // a notification, and nothing is reported that did not actually happen.
    await notifyPOSOversold({
      orderNumber: order.orderNumber,
      localReceiptNumber: normalizedLocalReceiptNumber,
      lines: oversoldLines,
    });

    // A POS sale is born paid and delivered, so it never passes through an
    // admin status transition — which is why every POS order's timeline used
    // to read "No events yet" for its entire life. Record both facts here.
    const posAuditContext = createAuditContext(request, session);
    await auditOrderPlaced(posAuditContext, order, {
      source: "pos",
      total: order.total,
      currency: order.currency,
      itemCount: order.items.length,
      paymentMethod: order.paymentMethod,
    });
    await auditOrderPaid(posAuditContext, order, {
      gateway: order.paymentMethod,
      amount: order.total,
      currency: order.currency,
      transactionId: order.paymentId,
    });

    // Refresh the buyer's denormalized stats (only when a real customer was
    // attached — walk-in sales fall back to the staff user, which isn't a
    // customer profile worth counting).
    if (customerId) {
      const { awardOrderLoyaltyPoints, refreshCustomerStats } = await import(
        "@/lib/customers/customer"
      );
      await awardOrderLoyaltyPoints(String(order._id)).catch((err) =>
        console.error("Failed to award loyalty points:", err),
      );
      refreshCustomerStats(String(customerId))
        .catch((err) =>
          console.error("Failed to refresh customer stats:", err),
        );
    }

    return createdResponse(order);
  } catch (error) {
    return handleApiError(error);
  }
}
