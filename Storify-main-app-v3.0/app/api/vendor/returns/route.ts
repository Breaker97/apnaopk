import { createReturnHandler } from "@/lib/returns/open-return-routes";
import { connectDB } from "@/lib/db";
import { NotFoundError } from "@/lib/api/errors";
import { paginatedResponse } from "@/lib/api/response";
import { isValidObjectId, validateQuery } from "@/lib/api/validate";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { AdminReturnListQuerySchema } from "@/lib/validations";
import { assertVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { getSettings } from "@/models/settings.model";
import { ReturnRequest } from "@/models";
import { escapeRegExp } from "@/lib/strings";
import { withApi } from "@/lib/api/handler";
import { withoutRefundDestinationUnlessPayer } from "@/lib/returns/refund-settlement";
import { markWalkInReturns } from "@/lib/returns/return-walk-in";
import { vendorReturnsFilter } from "@/lib/returns/return-stats";

export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.VIEW_ORDERS,
      "You do not have permission to view returns",
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:returns:list",
      "lenient",
      session.user.role,
    );

    const { page, limit, search, status, sortBy, sortOrder, orderId } =
      validateQuery(request, AdminReturnListQuerySchema);

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    const vendor = await requireApprovedVendorByUserId(session.user.id);

    const andConditions: Record<string, unknown>[] = [
      vendorReturnsFilter(vendor._id),
    ];
    if (status && status !== "all") {
      andConditions.push({ status });
    }
    if (orderId) {
      andConditions.push(isValidObjectId(orderId) ? { orderId } : { _id: null });
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

    const allowedSortFields = new Set(["createdAt", "returnNumber", "status"]);
    const effectiveSortBy =
      sortBy && allowedSortFields.has(sortBy) ? sortBy : "createdAt";
    const sort: Record<string, 1 | -1> = {
      [effectiveSortBy]: sortOrder === "asc" ? 1 : -1,
    };
    const query = { $and: andConditions };
    const skip = (page - 1) * limit;

    const [returns, total] = await Promise.all([
      ReturnRequest.find(query)
        .populate("customerId", "name email")
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      ReturnRequest.countDocuments(query),
    ]);

    // A shopper's refund account only where this seller is the one paying it.
    // A return on a walk-in POS sale names no customer: the seller is never
    // handed the cashier in its place. See markWalkInReturns.
    return paginatedResponse(
      await markWalkInReturns(returns.map(withoutRefundDestinationUnlessPayer)),
      page,
      limit,
      total,
    );
  },
);

/**
 * A seller opening a return for a shopper — asked for by phone, email or chat —
 * approved as it opens. See lib/returns/open-return-routes.ts.
 */
export const POST = createReturnHandler("vendor");
