import { connectDB } from "@/lib/db";
import { Vendor } from "@/models";
import { getSettings } from "@/models/settings.model";
import {
  VENDOR_ACCESS_REQUEST_STATUS,
  VendorAccessRequest,
} from "@/models/vendorAccessRequest.model";
import {
  VENDOR_PACK_LABELS,
  VENDOR_PERMISSION_PACKS,
  type VendorPermissionPack,
} from "@/config/permissions.config";
import { NotFoundError } from "@/lib/api/errors";
import { paginatedResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { plansInForce } from "@/lib/vendors/vendor-permissions";
import { parsePageLimit } from "@/lib/api/list-query";

/**
 * GET /api/admin/access-requests?status=pending
 *
 * The queue. Each row carries what an admin needs to decide without opening the
 * vendor: the store, its plan, the pack asked for, the permissions it expands
 * to, and the vendor's reason. The plan name is what makes "suggest an upgrade
 * instead" answerable at a glance.
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:accessRequests:list", preset: "lenient" },
  },
  async ({ request }) => {
    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const { searchParams } = new URL(request.url);
    const status = (searchParams.get("status") || "pending").trim();
    const { page, limit } = parsePageLimit(searchParams, {
      defaultLimit: 25,
      maxLimit: 100,
    });
    const query: Record<string, unknown> = {};
    if (status !== "all") {
      if (status === "decided") {
        // Withdrawn rows belong here too. They are closed history, and a
        // request the vendor pulled back is exactly the kind of thing an admin
        // looks for when they remember reading one that is no longer pending.
        query.status = {
          $in: [
            VENDOR_ACCESS_REQUEST_STATUS.APPROVED,
            VENDOR_ACCESS_REQUEST_STATUS.DECLINED,
            VENDOR_ACCESS_REQUEST_STATUS.WITHDRAWN,
          ],
        };
      } else {
        query.status = status;
      }
    }

    const [rows, total] = await Promise.all([
      VendorAccessRequest.find(query)
        .sort({ requestedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      VendorAccessRequest.countDocuments(query),
    ]);

    const vendorIds = Array.from(new Set(rows.map((row) => String(row.vendorId))));
    const vendors = vendorIds.length
      ? await Vendor.find({ _id: { $in: vendorIds } })
          .select("storeName slug planId")
          .populate("planId", "name price billingInterval capabilities")
          .lean<
            {
              _id: unknown;
              storeName?: string;
              slug?: string;
              planId?: { name?: string; capabilities?: { packs?: string[] } } | null;
            }[]
          >()
      : [];
    const vendorById = new Map(
      vendors.map((vendor) => [String(vendor._id), vendor]),
    );

    const plansOn = plansInForce(settings);

    return paginatedResponse(
      rows.map((row) => {
        const vendor = vendorById.get(String(row.vendorId));
        const pack = row.pack as VendorPermissionPack;
        return {
          _id: String(row._id),
          vendorId: String(row.vendorId),
          storeName: vendor?.storeName ?? "Unknown store",
          vendorSlug: vendor?.slug ?? null,
          // Null when the marketplace sells no plans, so the UI knows to say
          // "commission-only" rather than inventing a plan name.
          planName: plansOn ? (vendor?.planId?.name ?? null) : null,
          plansAvailable: plansOn,
          pack,
          packLabel: VENDOR_PACK_LABELS[pack],
          permissions: VENDOR_PERMISSION_PACKS[pack],
          reason: row.reason,
          duration: row.duration,
          status: row.status,
          requestedBy: row.requestedBy,
          requestedAt: row.requestedAt,
          decidedBy: row.decidedBy ?? null,
          decidedAt: row.decidedAt ?? null,
          decisionNote: row.decisionNote ?? null,
        };
      }),
      page,
      limit,
      total,
    );
  },
);
