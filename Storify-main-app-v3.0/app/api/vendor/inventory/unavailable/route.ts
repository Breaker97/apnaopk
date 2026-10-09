import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { AuthorizationError, NotFoundError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { connectDB } from "@/lib/db";
import { Product } from "@/models";
import { getSettingsLean } from "@/models/settings.model";
import { hasVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { audit, createAuditContext } from "@/lib/audit";
import { HELD_UNIT_ACTIONS } from "@/lib/returns/held-units";
import {
  listHeldReturnUnits,
  resolveHeldReturnUnits,
} from "@/lib/returns/held-units-actions";

/**
 * The vendor's own "Unavailable" units — see the admin route of the same name.
 * Scoped to the vendor's lines: a return that also carries another seller's
 * goods shows and settles only this vendor's.
 *
 * GET  /api/vendor/inventory/unavailable?productId=&variantId=
 * POST /api/vendor/inventory/unavailable  { returnId, itemIndex, quantity, action }
 */

async function requireVendorId(
  user: Parameters<typeof hasVendorPermission>[0],
  userId: string,
  permission: (typeof VENDOR_PERMISSIONS)[keyof typeof VENDOR_PERMISSIONS],
): Promise<string> {
  if (!(await hasVendorPermission(user, permission))) {
    throw new AuthorizationError("You do not have permission to manage inventory");
  }
  await connectDB();
  const settings = await getSettingsLean();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
  const vendor = await requireApprovedVendorByUserId(userId, {
    allowPaymentRequiredSetup: true,
  });
  return String(vendor._id);
}

async function assertOwnProduct(productId: string, vendorId: string) {
  const own = await Product.exists({ _id: productId, vendorId });
  if (!own) throw new NotFoundError("Product");
}

const ListQuerySchema = z.object({
  productId: z.string().min(1).max(64),
  variantId: z.string().max(64).optional(),
});

export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:inventory:unavailable", preset: "lenient" },
  },
  async ({ request, session }) => {
    const vendorId = await requireVendorId(
      session.user,
      session.user.id,
      VENDOR_PERMISSIONS.VIEW_PRODUCTS,
    );
    const query = ListQuerySchema.parse({
      productId: request.nextUrl.searchParams.get("productId") || "",
      variantId: request.nextUrl.searchParams.get("variantId") || undefined,
    });
    await assertOwnProduct(query.productId, vendorId);

    const entries = await listHeldReturnUnits({
      productId: query.productId,
      variantId: query.variantId,
      vendorId,
    });
    return successResponse({ entries });
  },
);

const ResolveSchema = z.object({
  returnId: z.string().min(1).max(64),
  itemIndex: z.number().int().min(0).max(1000),
  quantity: z.number().int().min(1).max(100_000),
  action: z.enum(HELD_UNIT_ACTIONS),
});

export const POST = withApi(
  {
    auth: "user",
    rateLimit: {
      action: "vendor:inventory:unavailable:resolve",
      preset: "moderate",
    },
  },
  async ({ request, session }) => {
    const vendorId = await requireVendorId(
      session.user,
      session.user.id,
      VENDOR_PERMISSIONS.EDIT_PRODUCTS,
    );
    const body = await validateBody(request, ResolveSchema);

    const resolution = await resolveHeldReturnUnits({
      ...body,
      actorId: session.user.id,
      vendorId,
      assertProduct: (productId) => assertOwnProduct(productId, vendorId),
    });

    void audit(createAuditContext(request, session), {
      action: "UPDATE",
      resource: "inventory",
      resourceId: resolution.productId,
      resourceName: resolution.returnNumber,
      changes: {
        summary:
          body.action === "restocked"
            ? `Put ${body.quantity} unsellable returned unit(s) back on sale (${resolution.returnNumber})`
            : `Wrote off ${body.quantity} unsellable returned unit(s) (${resolution.returnNumber})`,
      },
      metadata: {
        vendorId,
        returnId: body.returnId,
        itemIndex: body.itemIndex,
        variantId: resolution.variantId,
        action: body.action,
        quantity: body.quantity,
      },
    });

    return successResponse({ held: resolution.held });
  },
);
