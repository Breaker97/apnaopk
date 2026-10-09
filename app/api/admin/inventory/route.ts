import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { successResponse } from "@/lib/api/response";
import {
  handleApiError,
  AuthenticationError,
  ValidationError,
} from "@/lib/api/errors";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import {
  buildStaffProductScopeFilter,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";
import { withApi } from "@/lib/api/handler";
import { fetchInventoryList } from "@/lib/inventory/inventory-list";
import { applyStockEdits } from "@/lib/inventory/stock-adjust";
import { createAuditContext } from "@/lib/audit";
import {
  allowedLocationIds,
  resolveLocationScope,
} from "@/lib/inventory/inventory-location-scope";
import * as z from "zod";
import { validateBody } from "@/lib/api/validate";

export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_INVENTORY],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:inventory:list",
      "lenient",
      session.user.role
    );

    const list = await fetchInventoryList(
      new URL(request.url).searchParams,
      access.staffScope,
    );

    return successResponse({
      items: list.items,
      locations: list.locations,
      pagination: {
        page: list.page,
        limit: list.limit,
        total: list.total,
        totalPages: list.totalPages,
        hasNext: list.page < list.totalPages,
        hasPrev: list.page > 1,
      },
    });
  },
);

const InventoryUpdatesSchema = z.object({
  updates: z
    .array(
      z
        .object({
          productId: z.string().max(64).optional(),
          variantId: z.string().max(64).optional(),
          locationId: z.string().max(64).optional(),
          quantity: z.union([z.number(), z.string().max(20)]).optional(),
          adjustment: z.boolean().optional(),
        })
        .loose(),
    )
    .max(500)
    .optional(),
});

/**
 * PATCH /api/admin/inventory
 * Bulk update inventory quantities
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new AuthenticationError();
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [
        STAFF_PERMISSIONS.EDIT_INVENTORY,
        STAFF_PERMISSIONS.MANAGE_INVENTORY,
      ],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:inventory:update",
      "moderate",
      session.user.role
    );

    const { updates } = await validateBody(request, InventoryUpdatesSchema);

    if (!Array.isArray(updates) || updates.length === 0) {
      throw new ValidationError("Updates array is required");
    }

    await connectDB();

    // Stock may only be adjusted at a location this store owns. The staff
    // restriction narrows further, but on its own it let an unrestricted
    // admin or staff session name any location id at all — including another
    // merchant's — and write a quantity into it.
    const { results, summary } = await applyStockEdits(
      updates,
      {
        locationIds: await allowedLocationIds(
          await resolveLocationScope(session.user, "write"),
        ),
        staffLocationIds: access.staffScope?.locationIds,
        productFilter: mergeScopeFilter(
          {},
          buildStaffProductScopeFilter(access.staffScope),
        ),
      },
      // No vendor id passed: `audit()` stamps a vendor-owned staff member with
      // their vendor, and leaves an admin's edit of a vendor's stock unstamped.
      createAuditContext(request, session),
    );

    return successResponse({ results, summary });
  } catch (error) {
    return handleApiError(error);
  }
}
