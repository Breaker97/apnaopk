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
import { withApi } from "@/lib/api/handler";

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
      {
        $or: [
          { ownerType: "vendor", ownerVendorId: vendor._id },
          {
            ownerType: { $exists: false },
            vendorIds: vendor._id,
          },
        ],
      },
    ];
    if (status && status !== "all") {
      andConditions.push({ status });
    }
    if (orderId) {
      andConditions.push(isValidObjectId(orderId) ? { orderId } : { _id: null });
    }
    if (search) {
      andConditions.push({
        $or: [
          { returnNumber: { $regex: search, $options: "i" } },
          { orderNumber: { $regex: search, $options: "i" } },
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

    return paginatedResponse(returns, page, limit, total);
  },
);
