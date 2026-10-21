import { Vendor, VendorTaxRequest } from "@/models";
import { VENDOR_TAX_REQUEST_STATUS } from "@/models/vendorTaxRequest.model";
import { getSettingsLean } from "@/models/settings.model";
import { withApi } from "@/lib/api/handler";
import { paginatedResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { parsePageLimit } from "@/lib/api/list-query";

/**
 * GET /api/admin/tax-requests — vendors' tax change requests for Settings →
 * Tax Settings → Vendors. `?status=pending` (the default) is the queue;
 * `decided` is the history.
 */
export const GET = withApi(
  { auth: "admin", rateLimit: { action: "admin:taxRequests:list", preset: "lenient" } },
  async ({ request }) => {
    const settings = await getSettingsLean();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status") || VENDOR_TAX_REQUEST_STATUS.PENDING;
    const filter =
      status === "decided"
        ? {
            status: {
              $in: [
                VENDOR_TAX_REQUEST_STATUS.APPROVED,
                VENDOR_TAX_REQUEST_STATUS.DECLINED,
                VENDOR_TAX_REQUEST_STATUS.WITHDRAWN,
              ],
            },
          }
        : { status: VENDOR_TAX_REQUEST_STATUS.PENDING };
    const { page, limit } = parsePageLimit(searchParams, { defaultLimit: 25, maxLimit: 100 });
    const [rows, total] = await Promise.all([
      VendorTaxRequest.find(filter)
        .sort({ requestedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      VendorTaxRequest.countDocuments(filter),
    ]);
    const vendors = await Vendor.find({ _id: { $in: rows.map((row) => row.vendorId) } })
      .select("storeName slug")
      .lean<Array<{ _id: unknown; storeName?: string; slug?: string }>>();
    const vendorById = new Map(vendors.map((vendor) => [String(vendor._id), vendor]));
    return paginatedResponse(
      rows.map((row) => {
        const vendor = vendorById.get(String(row.vendorId));
        return { ...row, storeName: vendor?.storeName || "", vendorSlug: vendor?.slug || "" };
      }),
      page,
      limit,
      total,
    );
  },
);
