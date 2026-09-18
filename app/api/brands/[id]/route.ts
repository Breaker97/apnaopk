import { Brand, Product } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { isAdmin } from "@/lib/access/rbac";
import {
  getRequestedBrandSlug,
  normalizeBrandSeo,
  BRAND_APPROVAL_STATUS,
  APPROVED_BRAND_CONDITION,
} from "@/lib/catalog/brands";
import mongoose from "mongoose";
import { revalidateBrandContent, revalidateProductContent } from "@/lib/cache-invalidation";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

type RouteParams = { id: string };

const BrandSeoSchema = z.record(z.string(), z.unknown());
// Shape check + allow-list: only these keys reach `Brand.create` / `$set`.
const BrandUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  restore: z.boolean().optional(),
  approvalStatus: z.string().max(40).optional(),
  rejectionReason: z.string().max(1000).optional(),
  slug: z.string().max(120).optional(),
  description: z.string().max(5000).optional(),
  logo: z.string().max(2048).optional(),
  website: z.string().max(2048).optional(),
  displayOrder: z.number().optional(),
  order: z.number().optional(),
  isActive: z.boolean().optional(),
  featured: z.boolean().optional(),
  seo: BrandSeoSchema.optional(),
});

/**
 * GET /api/brands/[id]
 * Get single brand by ID OR slug
 */
export const GET = withApi<RouteParams>(
  { auth: "optional" },
  async ({ params, session }) => {
    const { id } = params;

    // Admins (brand edit/restore form) may load any brand; everyone else only
    // sees approved, live, non-archived brands.
    const visibility = isAdmin(session?.user)
      ? {}
      : {
          approvalStatus: APPROVED_BRAND_CONDITION,
          isActive: true,
          deletedAt: null,
        };

    let brand;
    if (mongoose.Types.ObjectId.isValid(id)) {
      brand = await Brand.findOne({ _id: id, ...visibility }).lean();
    }

    if (!brand) {
      brand = await Brand.findOne({ slug: id, ...visibility }).lean();
    }

    if (!brand) {
      return notFoundResponse("Brand");
    }

    return successResponse(brand);
  },
);

/**
 * PUT /api/brands/[id]
 * Update brand (Admin only) - requires ID
 */
export const PUT = withApi<RouteParams>(
  { auth: "admin" },
  async ({ request, params }) => {
    const { id } = params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return notFoundResponse("Brand");
    }

    const body = await validateBody(request, BrandUpdateSchema);
    const before = await Brand.findById(id).select("slug").lean();

    // Restore a soft-deleted (archived) brand.
    if (body.restore === true) {
      const restored = await Brand.findByIdAndUpdate(
        id,
        { $set: { deletedAt: null } },
        { returnDocument: "after" },
      );
      if (!restored) return notFoundResponse("Brand");
      return successResponse(restored);
    }

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
    if (seo) {
      body.seo = seo;
    } else {
      delete body.seo;
    }

    // Remap displayOrder to order
    if (body.displayOrder !== undefined) {
      body.order = body.displayOrder;
      delete body.displayOrder;
    }

    // Moderation: approving publishes the brand; rejecting hides it and keeps
    // the reason. Editing other fields leaves the moderation state untouched.
    if (body.approvalStatus === BRAND_APPROVAL_STATUS.APPROVED) {
      body.isActive = true;
      body.rejectionReason = "";
    } else if (body.approvalStatus === BRAND_APPROVAL_STATUS.REJECTED) {
      body.isActive = false;
    }

    const brand = await Brand.findByIdAndUpdate(
      id,
      { $set: body },
      { returnDocument: "after", runValidators: true }
    );

    if (!brand) {
      return notFoundResponse("Brand");
    }

    revalidateBrandContent({ slugs: [before?.slug, brand.slug] });

    return successResponse(brand);
  },
);

/**
 * DELETE /api/brands/[id]
 * Soft-delete a brand by default. With ?permanent=true, hard-delete it and
 * clear product references.
 */
export const DELETE = withApi<RouteParams>(
  { auth: "admin" },
  async ({ request, params }) => {
    const { id } = params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return notFoundResponse("Brand");
    }

    const permanentlyDelete = request.nextUrl.searchParams.get("permanent") === "true";

    if (permanentlyDelete) {
      const brand = await Brand.findByIdAndDelete(id);

      if (!brand) {
        return notFoundResponse("Brand");
      }

      await Product.updateMany(
        { brand: brand._id },
        { $set: { brand: null } },
      );

      revalidateBrandContent({ slugs: [brand.slug] });
      revalidateProductContent();

      return successResponse({ message: "Brand permanently deleted" });
    }

    const brand = await Brand.findByIdAndUpdate(
      id,
      { $set: { deletedAt: new Date(), isActive: false } },
      { returnDocument: "after" },
    );

    if (!brand) {
      return notFoundResponse("Brand");
    }

    // Archived (soft-deleted) brands keep their product references so the brand
    // can be restored later; STOREFRONT_BRAND_FILTER hides them in the meantime.
    // Still refresh brand + product caches so the storefront reflects the change.
    revalidateBrandContent({ slugs: [brand.slug] });
    revalidateProductContent();

    return successResponse({ message: "Brand archived successfully" });
  },
);
