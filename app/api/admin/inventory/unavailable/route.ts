import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { connectDB } from "@/lib/db";
import { Product } from "@/models";
import {
  buildStaffProductScopeFilter,
  mergeScopeFilter,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";
import { audit, createAuditContext } from "@/lib/audit";
import { HELD_UNIT_ACTIONS } from "@/lib/returns/held-units";
import {
  listHeldReturnUnits,
  resolveHeldReturnUnits,
} from "@/lib/returns/held-units-actions";

/**
 * The inventory's "Unavailable" units — damaged, incomplete or unusable goods a
 * return brought back — and settling them: back on sale, or written off.
 *
 * GET  /api/admin/inventory/unavailable?productId=&variantId=
 * POST /api/admin/inventory/unavailable  { returnId, itemIndex, quantity, action }
 */

/** Staff limited to some vendors reach only those vendors' products. */
async function assertProductInScope(
  productId: string,
  scope: StaffAccessScope | null | undefined,
) {
  if (!scope) return;
  const visible = await Product.exists(
    mergeScopeFilter({ _id: productId }, buildStaffProductScopeFilter(scope)),
  );
  if (!visible) throw new NotFoundError("Product");
}

const ListQuerySchema = z.object({
  productId: z.string().min(1).max(64),
  variantId: z.string().max(64).optional(),
});

export const GET = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.VIEW_INVENTORY],
    rateLimit: { action: "admin:inventory:unavailable", preset: "lenient" },
  },
  async ({ request, staff }) => {
    const query = ListQuerySchema.parse({
      productId: request.nextUrl.searchParams.get("productId") || "",
      variantId: request.nextUrl.searchParams.get("variantId") || undefined,
    });
    await connectDB();
    await assertProductInScope(query.productId, staff?.scope);

    const entries = await listHeldReturnUnits({
      productId: query.productId,
      variantId: query.variantId,
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
    auth: "admin-or-staff",
    staffPermissions: [
      STAFF_PERMISSIONS.EDIT_INVENTORY,
      STAFF_PERMISSIONS.MANAGE_INVENTORY,
    ],
    rateLimit: { action: "admin:inventory:unavailable:resolve", preset: "moderate" },
  },
  async ({ request, session, staff }) => {
    const body = await validateBody(request, ResolveSchema);
    await connectDB();

    const resolution = await resolveHeldReturnUnits({
      ...body,
      actorId: session.user.id,
      allowedLocationIds: staff?.scope?.locationIds,
      // Checked on the line the return names, before anything moves, so a
      // staff member cannot settle units of a product outside their scope by
      // quoting another return.
      assertProduct: (productId) => assertProductInScope(productId, staff?.scope),
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
