import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Brand } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { getSettings } from "@/models/settings.model";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { hasVendorPermission } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import {
  getRequestedBrandSlug,
  normalizeBrandSeo,
  BRAND_APPROVAL_STATUS,
} from "@/lib/catalog/brands";
import { revalidateBrandContent } from "@/lib/cache-invalidation";
import { withApi } from "@/lib/api/handler";
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
 * GET /api/vendor/brands/[id]
 * Fetch a single brand for the vendor edit form. Gated behind VIEW_BRANDS.
 */
export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ params, session }) => {
    const user = session.user;
    const canView = await hasVendorPermission(
      user,
      VENDOR_PERMISSIONS.VIEW_BRANDS,
    );
    if (!canView) {
      throw new AuthorizationError("You do not have permission to view brands");
    }

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });

    const { id } = params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return notFoundResponse("Invalid brand ID");
    }

    // Only the owning vendor can load their brand into the edit form.
    const brand = await Brand.findOne({
      _id: id,
      deletedAt: null,
      ownerVendorId: vendor._id,
    }).lean();
    if (!brand) return notFoundResponse("Brand");

    return successResponse(brand);
  },
);

/**
 * PUT /api/vendor/brands/[id]
 * Update a brand. Gated behind the EDIT_BRANDS vendor permission.
 */
export const PUT = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const user = session.user;
    const canEdit = await hasVendorPermission(
      user,
      VENDOR_PERMISSIONS.EDIT_BRANDS,
    );
    if (!canEdit) {
      throw new AuthorizationError("You do not have permission to edit brands");
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:brands:update",
      "moderate",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });

    const { id } = params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return notFoundResponse("Invalid brand ID");
    }

    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });

    const current = await Brand.findOne({ _id: id, deletedAt: null });
    if (!current) return notFoundResponse("Brand");

    // Owner-scoped: a vendor may only edit a brand they created. Platform
    // ("official") brands and other vendors' brands are off-limits.
    if (
      !current.ownerVendorId ||
      String(current.ownerVendorId) !== String(vendor._id)
    ) {
      throw new AuthorizationError("You can only edit brands you created");
    }

    const body = await validateBody(request, VendorBrandSchema);

    const requestedSlug = getRequestedBrandSlug(body);
    if (requestedSlug) {
      const existing = await Brand.findOne({
        slug: requestedSlug,
        _id: { $ne: id },
      });
      if (existing) {
        throw new ValidationError("Brand URL handle is already in use");
      }
      body.slug = requestedSlug;
    }

    const seo = normalizeBrandSeo(body);

    // Vendors cannot set privileged/moderation fields directly.
    const update: Record<string, unknown> = {
      name: body.name ?? current.name,
      description: body.description,
      logo: body.logo,
      website: body.website,
      ...(requestedSlug ? { slug: requestedSlug } : {}),
      ...(seo ? { seo } : { seo: undefined }),
      ...(body.displayOrder !== undefined ? { order: body.displayOrder } : {}),
    };

    // Re-moderation: if an already-approved brand's name or logo changes, send
    // it back to the queue so the edit is reviewed before going live again.
    const nameChanged =
      typeof body.name === "string" && body.name.trim() !== current.name;
    const logoChanged =
      body.logo !== undefined && body.logo !== current.logo;
    if (
      current.approvalStatus === BRAND_APPROVAL_STATUS.APPROVED &&
      (nameChanged || logoChanged)
    ) {
      update.approvalStatus = BRAND_APPROVAL_STATUS.PENDING;
      update.isActive = false;
    }

    const brand = await Brand.findByIdAndUpdate(
      id,
      { $set: update },
      { returnDocument: "after", runValidators: true },
    );

    if (!brand) return notFoundResponse("Brand");

    // If the brand was live on the storefront before this edit, refresh the
    // brand pages/labels: either its visible fields changed, or a name/logo edit
    // just sent it back to moderation (so it should disappear). A pending brand
    // isn't shown, so editing it needs no revalidation. Include the old slug in
    // case the slug changed.
    if (current.isActive) {
      revalidateBrandContent({ slugs: [brand.slug, current.slug] });
    }

    return successResponse(brand);
  },
);
