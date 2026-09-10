import { connectDB } from "@/lib/db";
import { Brand } from "@/models";
import { successResponse, createdResponse } from "@/lib/api/response";
import { AuthorizationError, NotFoundError } from "@/lib/api/errors";
import { getSettings } from "@/models/settings.model";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { hasVendorPermission } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import {
  slugifyBrand,
  getRequestedBrandSlug,
  normalizeBrandSeo,
  BRAND_APPROVAL_STATUS,
} from "@/lib/catalog/brands";
import { withApi } from "@/lib/api/handler";
import { fetchVendorBrandList } from "@/lib/vendors/vendor-brand-list";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

// Allow-list of what a vendor may set; moderation fields are assigned below.
const VendorBrandSchema = z.object({
  name: z.string().trim().max(120).optional(),
  slug: z.string().max(120).optional(),
  description: z.string().max(5000).optional(),
  logo: z.string().max(2048).optional(),
  website: z.string().max(2048).optional(),
  displayOrder: z.number().optional(),
  seo: z.record(z.string(), z.unknown()).optional(),
});

/**
 * GET /api/vendor/brands
 * Read-only brand catalog for vendors. Lists every brand in the store with the
 * count of the current vendor's products assigned to each brand. Gated behind
 * the VIEW_BRANDS vendor permission.
 */
export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const user = session.user;
    const canView = await hasVendorPermission(
      user,
      VENDOR_PERMISSIONS.VIEW_BRANDS,
    );
    if (!canView) {
      throw new AuthorizationError("You do not have permission to view brands");
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:brands:list",
      "lenient",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });

    const list = await fetchVendorBrandList(
      new URL(request.url).searchParams,
      vendor._id,
    );

    return successResponse({
      data: list.items,
      pagination: {
        page: list.page,
        limit: list.limit,
        total: list.total,
        totalPages: list.totalPages,
        hasNext: list.page < list.totalPages,
        hasPrev: list.page > 1,
      },
    });  },
);

/**
 * POST /api/vendor/brands
 * Create a brand. Gated behind the CREATE_BRANDS vendor permission and only
 * available while multi-vendor mode is enabled.
 */
export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const user = session.user;
    const canCreate = await hasVendorPermission(
      user,
      VENDOR_PERMISSIONS.CREATE_BRANDS,
    );
    if (!canCreate) {
      throw new AuthorizationError(
        "You do not have permission to create brands",
      );
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:brands:create",
      "moderate",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    // Ensures the caller is an approved vendor before allowing writes.
    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });

    const body = await validateBody(request, VendorBrandSchema);

    const requestedSlug = getRequestedBrandSlug(body);
    const slug = requestedSlug || slugifyBrand(String(body.name || ""));
    const seo = normalizeBrandSeo(body);

    const existing = await Brand.findOne({ slug });
    const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

    // Vendor-created brands enter the moderation queue: owned by this vendor,
    // pending review, hidden from the storefront until an admin approves.
    // Privileged fields (status/featured) are not vendor-controllable.
    const brand = await Brand.create({
      name: body.name,
      description: body.description,
      logo: body.logo,
      website: body.website,
      ...(seo ? { seo } : {}),
      slug: finalSlug,
      order: body.displayOrder || 0,
      ownerVendorId: vendor._id,
      approvalStatus: BRAND_APPROVAL_STATUS.PENDING,
      isActive: false,
      featured: false,
    });

    return createdResponse(brand);
  },
);
