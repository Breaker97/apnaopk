import { connectDB } from "@/lib/db";
import { InventoryLocation, Product } from "@/models";
import {
  locationOwnerFilter,
  resolveLocationScope,
} from "@/lib/inventory/inventory-location-scope";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { ValidationError } from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { escapeRegExp } from "@/lib/strings";

export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_INVENTORY],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:transfers:catalog",
      "lenient",
      session.user.role,
    );

    const { searchParams } = new URL(request.url);
    const fromLocationId = (searchParams.get("fromLocationId") || "").trim();
    const search = (searchParams.get("search") || "").trim();
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 50)));

    if (!fromLocationId) {
      throw new ValidationError("fromLocationId is required");
    }

    await connectDB();

    // Only the caller's own catalogue, and only from a location they own. This
    // endpoint answers "what can I move out of here", so an unscoped answer
    // would enumerate another merchant's stock levels.
    const scope = await resolveLocationScope(session.user, "read");
    const sourceLocation = await InventoryLocation.exists(
      locationOwnerFilter(scope, { _id: fromLocationId }),
    );
    if (!sourceLocation) {
      throw new ValidationError("Source location is invalid");
    }

    const query: Record<string, unknown> = { vendorId: scope.vendorId };
    if (search) {
      const escaped = escapeRegExp(search);
      query.$or = [
        { title: { $regex: escaped, $options: "i" } },
        { name: { $regex: escaped, $options: "i" } },
        { sku: { $regex: escaped, $options: "i" } },
        { "variants.name": { $regex: escaped, $options: "i" } },
        { "variants.sku": { $regex: escaped, $options: "i" } },
      ];
    }

    const products = await Product.find(query)
      .select("title name variants")
      .sort({ updatedAt: -1 })
      .limit(300)
      .lean();

    const lines: Array<{
      productId: string;
      variantId: string;
      productTitle: string;
      variantTitle: string;
      sku: string;
      availableAtSource: number;
    }> = [];

    for (const product of products) {
      const productTitle = product.title || product.name || "Untitled";
      if (!Array.isArray(product.variants) || !product.variants.length) {
        continue;
      }

      for (const variant of product.variants) {
        const sourceEntry = (variant.locationInventory || []).find(
          (entry: { locationId: string }) =>
            String(entry.locationId) === fromLocationId,
        );
        const availableAtSource = Number(sourceEntry?.quantity || 0);

        if (availableAtSource <= 0) {
          continue;
        }

        lines.push({
          productId: String(product._id),
          variantId: String(variant._id),
          productTitle,
          variantTitle: variant.name || "Default",
          sku: variant.sku || "",
          availableAtSource,
        });
      }
    }

    return successResponse({
      items: lines.slice(0, limit),
    });
  },
);
