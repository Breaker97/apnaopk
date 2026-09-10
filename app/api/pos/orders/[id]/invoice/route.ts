import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { getSettingsLean } from "@/models/settings.model";
import { notFoundResponse } from "@/lib/api/response";
import {
  AuthenticationError,
  AuthorizationError,
} from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { isValidObjectId } from "@/lib/api/validate";
import { canAccessPOS } from "@/lib/access/rbac";
import { isStaffRole } from "@/lib/access/staff-role";
import { buildStaffOrderScopeFilter, mergeScopeFilter } from "@/lib/access/staff-scope";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { USER_ROLES } from "@/config/app.config";
import {
  canAccessPOSInvoiceOrder,
} from "@/lib/pos/payment";
import {
  generateOrderInvoicePdf,
  type OrderInvoiceSource,
} from "@/lib/orders/order-invoice";

/**
 * GET /api/pos/orders/[id]/invoice
 * Download or print a PDF invoice for an accessible POS order.
 */
export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ params, session, request }) => {
    if (!session?.user) throw new AuthenticationError();

    const role = session.user.role;
    if (
      role !== USER_ROLES.ADMIN &&
      role !== USER_ROLES.VENDOR &&
      !isStaffRole(role)
    ) {
      throw new AuthorizationError();
    }

    await connectDB();
    if (!(await canAccessPOS(session.user))) {
      throw new AuthorizationError();
    }

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Order");

    let query: Record<string, unknown> = { _id: id, channel: "pos" };
    let vendorId: unknown;

    if (isStaffRole(role)) {
      const access = await assertAdminOrStaffPermissions(
        session as unknown as { user: { id: string; role: string } },
        [STAFF_PERMISSIONS.ACCESS_POS],
      );
      query = mergeScopeFilter(query, buildStaffOrderScopeFilter(access.staffScope));
    } else if (role === USER_ROLES.VENDOR) {
      const vendor = await requireApprovedVendorByUserId(session.user.id);
      vendorId = vendor._id;
      query = {
        $and: [
          query,
          {
            $or: [
              { "items.vendorId": vendor._id },
              { "subOrders.vendorId": vendor._id },
            ],
          },
        ],
      };
    }

    const order = await Order.findOne(query)
      .populate("customerId", "name email")
      .lean<OrderInvoiceSource>();

    if (!order) {
      return notFoundResponse("Order");
    }

    if (
      !canAccessPOSInvoiceOrder({
        user: session.user,
        order,
        vendorId,
      })
    ) {
      throw new AuthorizationError();
    }

    const settings = await getSettingsLean();
    const customer =
      order.customerId && typeof order.customerId === "object"
        ? (order.customerId as { name?: string })
        : null;
    const customerName =
      customer?.name || order.shippingAddress?.fullName || "Customer";
    const pdfBuffer = await generateOrderInvoicePdf(
      order,
      settings,
      customerName,
    );
    const disposition =
      request.nextUrl.searchParams.get("disposition") === "inline"
        ? "inline"
        : "attachment";

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="invoice-${order.orderNumber}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  },
);
