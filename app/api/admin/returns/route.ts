import { createReturnHandler } from "@/lib/returns/open-return-routes";
import { paginatedResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { isValidObjectId, validateQuery } from "@/lib/api/validate";
import { AdminReturnListQuerySchema } from "@/lib/validations";
import { Order, ReturnRequest } from "@/models";
import { escapeRegExp } from "@/lib/strings";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import {
  buildStaffOrderScopeFilter,
  hasStaffScope,
} from "@/lib/access/staff-scope";
import { buildVendorStaffReturnFilter } from "@/lib/returns/return-staff-scope";
import { withMaskedRefundAccount } from "@/lib/returns/refund-settlement";
import { markWalkInReturns } from "@/lib/returns/return-walk-in";

export const GET = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.VIEW_ORDERS],
    rateLimit: { action: "admin:returns:list", preset: "lenient" },
  },
  // `staff.scope` is set for staff callers and left undefined for a full
  // admin — the same scope the orders list is held to. Without it a staff
  // member limited to one location or one seller could read every return in
  // the shop from here, customer names and addresses included.
  async ({ request, staff }) => {
    const { page, limit, search, status, sortBy, sortOrder, orderId } = validateQuery(
      request,
      AdminReturnListQuerySchema,
    );

    // Every return, whoever owns the items. Vendor-owned requests were filtered
    // out here, which left the admin — the only party that can actually refund,
    // since the money is on the platform's gateway — unable to see, open or act
    // on a return for a vendor's product through any surface at all. The owning
    // vendor is populated instead of excluded, so the queue stays legible.
    const andConditions: Record<string, unknown>[] = [];
    if (status && status !== "all") {
      andConditions.push({ status });
    }
    if (orderId) {
      andConditions.push(isValidObjectId(orderId) ? { orderId } : { _id: null });
    }
    // A vendor's own staff see their vendor's returns only — see
    // `lib/returns/return-staff-scope.ts`. Written in return fields, so it is
    // part of the query and the count.
    if (staff?.vendorOwned && staff.scope) {
      andConditions.push(buildVendorStaffReturnFilter(staff.scope));
    }
    if (search) {
      // Escaped: a return or order number is typed by a person, and one
      // containing `(` or `*` was either a syntax error or a pattern the
      // database ran on every row in the collection.
      const pattern = escapeRegExp(search);
      andConditions.push({
        $or: [
          { returnNumber: { $regex: pattern, $options: "i" } },
          { orderNumber: { $regex: pattern, $options: "i" } },
        ],
      });
    }

    const query = andConditions.length ? { $and: andConditions } : {};
    const allowedSortFields = new Set(["createdAt", "returnNumber", "status"]);
    const effectiveSortBy =
      sortBy && allowedSortFields.has(sortBy) ? sortBy : "createdAt";
    const sort: Record<string, 1 | -1> = {
      [effectiveSortBy]: sortOrder === "asc" ? 1 : -1,
    };
    const skip = (page - 1) * limit;

    const [returns, total] = await Promise.all([
      ReturnRequest.find(query)
        .populate("customerId", "name email")
        .populate("ownerVendorId", "storeName")
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      ReturnRequest.countDocuments(query),
    ]);

    // A return is visible when its ORDER is — the rule `getOrderReturnRequests`
    // already applies one return at a time. Checked on the page rather than
    // folded into the query because the scope is written in order fields
    // (location, delivery region) that a return does not carry: resolving
    // every order in scope to filter by would be the whole order collection.
    // The count is therefore the unscoped one, and a scoped page can come back
    // short — which is a page that shows less, never a page that leaks.
    // Staff never see the shopper's full refund account — the admin sends
    // that money. See `withMaskedRefundAccount`.
    // A return on a walk-in POS sale names no customer — see markWalkInReturns.
    const shown = await markWalkInReturns(
      staff?.permissions ? returns.map(withMaskedRefundAccount) : returns,
    );
    if (hasStaffScope(staff?.scope)) {
      const visible = await Order.find({
        _id: { $in: returns.map((request) => request.orderId) },
        ...buildStaffOrderScopeFilter(staff?.scope),
      })
        .select("_id")
        .lean<Array<{ _id: unknown }>>();
      const allowed = new Set(visible.map((order) => String(order._id)));
      return paginatedResponse(
        shown.filter((request) => allowed.has(String(request.orderId))),
        page,
        limit,
        total,
      );
    }

    return paginatedResponse(shown, page, limit, total);
  },
);

/**
 * The store opening a return for a shopper — asked for by phone, email or chat —
 * approved as it opens. See lib/returns/open-return-routes.ts.
 */
export const POST = createReturnHandler("admin");
