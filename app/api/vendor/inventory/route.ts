import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { successResponse } from "@/lib/api/response";
import {
  handleApiError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { getSettings } from "@/models/settings.model";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { applyStockChangeAtomic } from "@/lib/inventory/inventory";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import { hasVendorPermission } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { withApi } from "@/lib/api/handler";
import { fetchVendorInventoryList } from "@/lib/vendors/vendor-inventory-list";
import {
  allowedLocationIds,
  vendorLocationScope,
} from "@/lib/inventory/inventory-location-scope";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

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

export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const user = session.user;
    const canView = await hasVendorPermission(
      user,
      VENDOR_PERMISSIONS.VIEW_PRODUCTS,
    );
    if (!canView) {
      throw new AuthorizationError("You do not have permission to view inventory");
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:inventory:list",
      "lenient",
      session.user.role,
    );

    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });

    const list = await fetchVendorInventoryList(
      new URL(request.url).searchParams,
      vendor._id,
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

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new AuthenticationError();

    const user = session.user;
    const canEdit = await hasVendorPermission(
      user,
      VENDOR_PERMISSIONS.EDIT_PRODUCTS,
    );
    if (!canEdit) {
      throw new AuthorizationError("You do not have permission to update inventory");
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:inventory:update",
      "moderate",
      session.user.role,
    );

    const { updates } = await validateBody(request, InventoryUpdatesSchema);

    if (!Array.isArray(updates) || updates.length === 0) {
      throw new ValidationError("Updates array is required");
    }

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });

    const results: Array<{
      success: boolean;
      productId: string;
      variantId?: string;
      error?: string;
    }> = [];

    // A vendor may only adjust stock at their own locations. `scopeFilter`
    // below pins the product to them, but `locationId` is a bare string with no
    // ownership of its own, so without this a crafted request could write a
    // quantity into another merchant's warehouse.
    const ownLocationIds = await allowedLocationIds(
      vendorLocationScope(String(vendor._id)),
    );

    for (const update of updates) {
      const { productId, variantId, quantity, locationId, adjustment } = update;

      if (!productId) {
        results.push({ success: false, productId: "", error: "productId is required" });
        continue;
      }
      if (locationId && !ownLocationIds.has(String(locationId))) {
        results.push({
          success: false,
          productId,
          variantId,
          error: "Location does not belong to this store",
        });
        continue;
      }

      try {
        // Guarded compare-and-swap update — see applyStockChangeAtomic for why
        // a document save() must never be used for stock changes.
        const outcome = await applyStockChangeAtomic({
          productId: String(productId),
          variantId: variantId ? String(variantId) : undefined,
          locationId: locationId ? String(locationId) : undefined,
          quantity: Number(quantity),
          adjustment: Boolean(adjustment),
          scopeFilter: { vendorId: vendor._id },
        });
        results.push({
          success: outcome.success,
          productId,
          variantId,
          ...(outcome.error ? { error: outcome.error } : {}),
        });
      } catch (err) {
        results.push({
          success: false,
          productId,
          variantId,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const successCount = results.filter((result) => result.success).length;

    // Refresh storefront product caches so a vendor's manual stock edit reflects
    // immediately (applyStockChangeAtomic does not self-invalidate).
    if (successCount > 0) {
      revalidateProductContent();
    }

    return successResponse({
      results,
      summary: {
        total: results.length,
        success: successCount,
        failed: results.filter((result) => !result.success).length,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
