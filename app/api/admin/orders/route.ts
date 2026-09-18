import { Types } from "mongoose";
import { Order, Product, User } from "@/models";
import { connectDB } from "@/lib/db";
import { NextRequest } from "next/server";
import { createdResponse, paginatedResponse } from "@/lib/api/response";
import {
  handleApiError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { PAYMENT_STATUS, USER_ROLES } from "@/config/app.config";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { validateBody, validateQuery } from "@/lib/api/validate";
import { AdminCreateOrderSchema, OrderListQuerySchema } from "@/lib/validations";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import {
  buildStaffProductScopeFilter,
  hasStaffScope,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";
import { fetchAdminOrderList } from "@/lib/orders/order-list";
import { getSettings } from "@/models/settings.model";
import { getNextOnlineOrderNumber } from "@/lib/orders/order-number";
import { createAuditContext } from "@/lib/audit";
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
import { withApi } from "@/lib/api/handler";
import { isCountryAllowed } from "@/lib/intl/country-availability";
import { resolveOrderItemCost } from "@/lib/products/item-cost";
import { roundMoney } from "@/lib/intl/money";

type AdminCreateOrderLine = {
  productId: string;
  variantId?: string;
  quantity: number;
};

type ResolvedAdminOrderLine = AdminCreateOrderLine & {
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

async function resolveAdminOrderLines(
  lines: AdminCreateOrderLine[],
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
      price: Number(variant?.price ?? product.price ?? 0),
      image: variant?.image || product.images?.[0],
    };
  });
}

/**
 * GET /api/admin/orders
 * Get all orders for admin
 */
export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_ORDERS],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:orders:list",
      "lenient",
      session.user.role
    );

    const params = validateQuery(request, OrderListQuerySchema);

    const { items, page, limit, total } = await fetchAdminOrderList(
      params,
      access.staffScope,
    );

    return paginatedResponse(items, page, limit, total);
  },
);

/**
 * POST /api/admin/orders
 * Create a manual admin order
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new AuthenticationError();
    if (session.user.role !== USER_ROLES.ADMIN) {
      await assertAdminOrStaffPermissions(
        session as unknown as { user: { id: string; role: string } },
        [STAFF_PERMISSIONS.CREATE_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS],
      );
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:orders:create",
      "moderate",
      session.user.role,
    );

    const body = await validateBody(request, AdminCreateOrderSchema);

    await connectDB();

    const customer = await User.findOne({
      _id: body.customerId,
      role: USER_ROLES.CUSTOMER,
    })
      .select("_id")
      .lean();

    if (!customer) {
      throw new NotFoundError("Customer");
    }

    const settings = await getSettings();
    if (
      body.shippingAddress.country &&
      !isCountryAllowed(
        body.shippingAddress.country,
        settings.general?.countryAvailability,
      )
    ) {
      throw new ValidationError({
        "shippingAddress.country": ["Selected country is not available"],
      });
    }
    if (
      body.billingAddress?.country &&
      !isCountryAllowed(
        body.billingAddress.country,
        settings.general?.countryAvailability,
      )
    ) {
      throw new ValidationError({
        "billingAddress.country": ["Selected country is not available"],
      });
    }
    const resolvedLines = await resolveAdminOrderLines(body.items);
    if (session.user.role !== USER_ROLES.ADMIN) {
      const access = await assertAdminOrStaffPermissions(
        session as unknown as { user: { id: string; role: string } },
        [STAFF_PERMISSIONS.CREATE_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS],
      );
      if (hasStaffScope(access.staffScope)) {
        const productIds = Array.from(
          new Set(resolvedLines.map((line) => String(line.product._id))),
        );
        const allowedProducts = await Product.countDocuments(
          mergeScopeFilter(
            { _id: { $in: productIds } },
            buildStaffProductScopeFilter(access.staffScope),
          ),
        );
        if (allowedProducts !== productIds.length) {
          throw new ValidationError(
            "One or more products are outside this staff member's assigned scope",
          );
        }
      }
    }
    const isMultiVendorEnabled = Boolean(settings.multiVendorMode?.enabled);
    const vendorContext = await resolveOrderVendorContextForItems({
      isMultiVendorEnabled,
      items: resolvedLines,
      getVendorId: (item) => item.product.vendorId,
      defaultVendorOwnerUserId: session.user.id,
    });
    const vendorGroups = groupItemsByOrderVendor(
      resolvedLines,
      vendorContext,
      (item) => item.product.vendorId,
    );
    const subtotal = roundMoney(
      resolvedLines.reduce((sum, item) => sum + item.price * item.quantity, 0),
    );
    const discount = Math.min(roundMoney(body.discount), subtotal);
    const taxableSubtotal = Math.max(subtotal - discount, 0);
    const tax = roundMoney(taxableSubtotal * (body.taxRate / 100));
    const shippingCost = roundMoney(body.shippingCost);
    const total = roundMoney(taxableSubtotal + tax + shippingCost);

    const subOrders = await buildVendorSubOrders(vendorGroups, {
      codCollectedByDefault: settings.shipping?.codCollectedBy,
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

    const inventoryLines: InventoryAdjustmentLine[] = resolvedLines.map((item) => ({
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
      body.paymentStatus === PAYMENT_STATUS.PAID ? new Date() : undefined;
    const subOrdersToSave = paidAt
      ? subOrders.map((sub) => ({
          ...sub,
          paymentStatus: PAYMENT_STATUS.PAID,
          paidAt,
          paymentCollectedBy: session.user.id,
        }))
      : subOrders;

    let order;
    try {
      order = await Order.create({
        orderNumber: await getNextOnlineOrderNumber(settings.orders?.prefix),
        currency: settings.general?.defaultCurrency || "USD",
        customerId: body.customerId,
        items: resolvedLines.map((item) => ({
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
        shippingAddress: body.shippingAddress,
        billingAddress: body.billingAddress || body.shippingAddress,
        paymentMethod: body.paymentMethod,
        paymentStatus: body.paymentStatus,
        ...(paidAt ? { paidAt } : {}),
        subtotal,
        shippingCost,
        tax,
        discount,
        total,
        status: "pending",
        channel: "online",
        staffId: session.user.id,
        notes: body.notes,
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

    await notifyOrderCreatedParticipants(order).catch((err) =>
      console.error("Failed to create admin order notifications:", err),
    );

    // A staff member hand-creating an order for a customer, at prices they
    // chose, is exactly what an audit trail is for — and it wrote nothing.
    await auditOrderPlaced(createAuditContext(request, session), order, {
      source: "admin",
      total: order.total,
      currency: order.currency,
      itemCount: order.items.length,
      paymentMethod: order.paymentMethod,
    });

    return createdResponse(
      {
        _id: order._id,
        orderNumber: order.orderNumber,
        total: order.total,
        paymentStatus: order.paymentStatus || PAYMENT_STATUS.PENDING,
      },
      "Order created successfully",
    );
  } catch (error) {
    return handleApiError(error);
  }
}
