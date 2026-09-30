import { Product, User } from "@/models";
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
import { createAuditContext } from "@/lib/audit";
import { withApi } from "@/lib/api/handler";
import {
  createAdminOrder,
  resolveAdminOrderLines,
} from "@/lib/orders/create-admin-order";
import { isCountryAllowed } from "@/lib/intl/country-availability";

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
    const order = await createAdminOrder({
      settings,
      lines: resolvedLines,
      customerId: body.customerId,
      shippingAddress: body.shippingAddress,
      billingAddress: body.billingAddress,
      shippingCost: body.shippingCost,
      discount: body.discount,
      taxRate: body.taxRate,
      paymentMethod: body.paymentMethod,
      paymentStatus: body.paymentStatus,
      notes: body.notes,
      actorId: session.user.id,
      audit: createAuditContext(request, session),
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
