import * as z from "zod";
import { Types } from "mongoose";
import { VendorTaxRequest } from "@/models";
import { VENDOR_TAX_REQUEST_STATUS } from "@/models/vendorTaxRequest.model";
import { getSettingsLean } from "@/models/settings.model";
import { withApi } from "@/lib/api/handler";
import { createdResponse, successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { AuthorizationError, NotFoundError } from "@/lib/api/errors";
import { createAuditContext } from "@/lib/audit";
import { assertVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { USER_ROLES } from "@/config/app.config";
import { VENDOR_PERMISSIONS, type VendorPermission } from "@/config/permissions.config";
import {
  MAX_TAX_REQUEST_PRODUCTS,
  createVendorTaxRequest,
} from "@/lib/vendors/vendor-tax-requests";

/**
 * A vendor's tax change requests (lib/vendors/vendor-tax-requests.ts).
 * GET lists them — `?productId=` for one product's, `?status=pending` for the
 * open ones; POST asks for one tax for some of the vendor's products.
 */

async function vendorFor(
  session: { user: Parameters<typeof assertVendorPermission>[0] & { id: string; role?: string } },
  permission: VendorPermission,
  message: string,
) {
  if (session.user.role !== USER_ROLES.VENDOR && session.user.role !== USER_ROLES.ADMIN) {
    throw new AuthorizationError();
  }
  await assertVendorPermission(session.user, permission, message);
  const settings = await getSettingsLean();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
  const vendor = await requireApprovedVendorByUserId(session.user.id, { allowPaymentRequiredSetup: true });
  if (!vendor) throw new AuthorizationError("Vendor profile not found");
  return vendor as unknown as { _id: unknown; storeName?: string };
}

export const GET = withApi(
  { auth: "user", rateLimit: { action: "vendor:taxRequests:list", preset: "lenient" } },
  async ({ request, session }) => {
    const vendor = await vendorFor(
      session!,
      VENDOR_PERMISSIONS.VIEW_PRODUCTS,
      "You do not have permission to view products",
    );
    const params = request.nextUrl.searchParams;
    const productId = params.get("productId");
    const status = params.get("status");
    const filter: Record<string, unknown> = { vendorId: vendor._id };
    if (productId && Types.ObjectId.isValid(productId)) filter.productIds = productId;
    if (status && (Object.values(VENDOR_TAX_REQUEST_STATUS) as string[]).includes(status)) {
      filter.status = status;
    }
    const requests = await VendorTaxRequest.find(filter).sort({ requestedAt: -1 }).limit(50).lean();
    return successResponse(requests);
  },
);

const CreateSchema = z.object({
  productIds: z.array(z.string().max(40)).min(1).max(MAX_TAX_REQUEST_PRODUCTS),
  chargeTax: z.boolean().optional(),
  taxClass: z.string().max(40).nullable().optional(),
  taxRate: z.number().min(0).max(100).nullable().optional(),
  reason: z.string().max(2000),
});

export const POST = withApi(
  { auth: "user", rateLimit: { action: "vendor:taxRequests:create", preset: "strict" } },
  async ({ request, session }) => {
    const vendor = await vendorFor(
      session!,
      VENDOR_PERMISSIONS.EDIT_PRODUCTS,
      "You do not have permission to edit products",
    );
    const body = await validateBody(request, CreateSchema);
    const created = await createVendorTaxRequest({
      vendor,
      userId: session!.user.id,
      productIds: body.productIds,
      requested: { chargeTax: body.chargeTax, taxClass: body.taxClass, taxRate: body.taxRate },
      reason: body.reason,
      auditContext: createAuditContext(request, session!, { vendorId: String(vendor._id) }),
    });
    return createdResponse(created.toObject());
  },
);
