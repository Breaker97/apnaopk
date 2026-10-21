import * as z from "zod";
import { Product } from "@/models";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { withApi } from "@/lib/api/handler";
import { paginatedResponse } from "@/lib/api/response";
import { validateQuery } from "@/lib/api/validate";
import { AdminListQuerySchema } from "@/lib/validations";
import { buildStaffProductScopeFilter, mergeScopeFilter } from "@/lib/access/staff-scope";
import { fetchAdminCustomerList } from "@/lib/customers/customer-list";

const QuerySchema = AdminListQuerySchema.extend({
  resource: z.enum(["products", "customers"]),
});

/** Only the catalog/contact fields needed to place an order, within the staff scope. */
export const GET = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.CREATE_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS],
    rateLimit: { action: "admin:orders:form-options", preset: "lenient" },
  },
  async ({ request, staff }) => {
    const { resource, page, limit, search } = validateQuery(request, QuerySchema);
    if (resource === "customers") {
      const list = await fetchAdminCustomerList({ page, limit, search }, staff?.scope);
      const customers = list.items.map((item) => {
        const row = item as {
          userId?: unknown;
          user?: { _id?: unknown; name?: string; email?: string; phone?: string };
          shippingAddress?: unknown;
        };
        return {
        userId: row.userId,
        user: row.user ? {
          _id: row.user._id,
          name: row.user.name,
          email: row.user.email,
          phone: row.user.phone,
        } : null,
        shippingAddress: row.shippingAddress,
        };
      });
      return paginatedResponse(customers, list.page, list.limit, list.total);
    }

    const filter = mergeScopeFilter({
      status: "active",
      ...(search ? { $or: [
        { name: { $regex: search, $options: "i" } },
        { title: { $regex: search, $options: "i" } },
        { sku: { $regex: search, $options: "i" } },
      ] } : {}),
    }, buildStaffProductScopeFilter(staff?.scope));
    const [products, total] = await Promise.all([
      Product.find(filter)
        .select("name title sku price stock images variants._id variants.name variants.sku variants.price variants.stock variants.image")
        .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Product.countDocuments(filter),
    ]);
    return paginatedResponse(products, page, limit, total);
  },
);
