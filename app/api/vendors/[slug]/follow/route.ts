import { VENDOR_STATUS } from "@/config/app.config";
import { NotFoundError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { successResponse } from "@/lib/api/response";
import { connectDB } from "@/lib/db";
import {
  getExternalVendorFilter,
  isMultiVendorEnabled,
} from "@/lib/vendors/multi-vendor";
import { Vendor, VendorFollow } from "@/models";

/**
 * Resolve a followable store from its public slug.
 *
 * Applies the same visibility rules as the storefront page: an unapproved or
 * deactivated store is not followable, and neither is the platform's own default
 * vendor record. Otherwise the endpoint would leak which slugs exist.
 */
async function requireFollowableVendor(slug: string) {
  await connectDB();

  if (!(await isMultiVendorEnabled())) throw new NotFoundError("Vendor");

  const vendor = await Vendor.findOne({
    ...getExternalVendorFilter(),
    slug: slug.toLowerCase(),
    status: VENDOR_STATUS.APPROVED,
    storeActive: { $ne: false },
  })
    .select("_id")
    .lean<{ _id: unknown } | null>();

  if (!vendor) throw new NotFoundError("Vendor");
  return vendor;
}

/**
 * POST /api/vendors/[slug]/follow
 *
 * Idempotent: following an already-followed store succeeds. The unique
 * { userId, vendorId } index is what makes a double-tap safe — the duplicate-key
 * error means the follow already exists, which is the desired end state.
 */
export const POST = withApi<{ slug: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:follow",
      "moderate",
      session.user.role,
    );

    const vendor = await requireFollowableVendor(params.slug);

    try {
      await VendorFollow.create({
        userId: session.user.id,
        vendorId: vendor._id,
      });
    } catch (error) {
      const isDuplicate =
        typeof error === "object" &&
        error !== null &&
        (error as { code?: number }).code === 11000;
      if (!isDuplicate) throw error;
    }

    const followerCount = await VendorFollow.countDocuments({
      vendorId: vendor._id,
    });

    return successResponse({ isFollowing: true, followerCount });
  },
);

/**
 * DELETE /api/vendors/[slug]/follow
 *
 * Also idempotent: unfollowing a store you do not follow succeeds.
 */
export const DELETE = withApi<{ slug: string }>(
  // Shopper-owned data: unfollowing a store stays available on demo.
  { auth: "user", demo: "allow" },
  async ({ request, params, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:follow",
      "moderate",
      session.user.role,
    );

    const vendor = await requireFollowableVendor(params.slug);

    await VendorFollow.deleteOne({
      userId: session.user.id,
      vendorId: vendor._id,
    });

    const followerCount = await VendorFollow.countDocuments({
      vendorId: vendor._id,
    });

    return successResponse({ isFollowing: false, followerCount });
  },
);
