import { connectDB } from "@/lib/db";
import { User, Vendor } from "@/models";
import { createdResponse, paginatedResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { USER_ACCOUNT_STATUS, USER_ROLES, VENDOR_STATUS } from "@/config/app.config";
import { getSettings } from "@/models/settings.model";
import { validateQuery, validateBody } from "@/lib/api/validate";
import { AdminListQuerySchema } from "@/lib/validations";
import { setUserRole } from "@/lib/access/user-role";
import { isStaffRole } from "@/lib/access/staff-role";
import {
  DEFAULT_VENDOR_SLUG,
  syncDefaultVendorWithSettings,
} from "@/lib/vendors/multi-vendor";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import { resolveVendorCommission } from "@/lib/vendors/vendor-commission";
import { withApi } from "@/lib/api/handler";
import { fetchAdminVendorList } from "@/lib/vendors/vendor-list";
import { slugify } from "@/lib/strings";
import { z } from "zod";

/**
 * GET /api/admin/vendors
 * Get all vendors with search and filter
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:vendors:list", preset: "lenient" },
  },
  async ({ request, session }) => {
    const { page, limit, search, status, sortOrder } = validateQuery(
      request,
      AdminListQuerySchema,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    await syncDefaultVendorWithSettings(session.user.id, settings);

    const list = await fetchAdminVendorList({
      page,
      limit,
      search,
      status,
      sortOrder,
    });

    return paginatedResponse(list.items, list.page, list.limit, list.total);
  },
);

// Shape check; presence and uniqueness rules keep their messages below.
const AdminVendorCreateSchema = z.object({
  storeName: z.string().max(200).optional(),
  ownerName: z.string().max(200).optional(),
  ownerEmail: z.string().max(320).optional(),
  ownerPhone: z.string().max(50).optional(),
  slug: z.string().max(120).optional(),
  status: z.enum(VENDOR_STATUS).optional(),
  userStatus: z.enum(USER_ACCOUNT_STATUS).optional(),
  description: z.string().max(5000).optional(),
  logo: z.string().max(2048).optional(),
  banner: z.string().max(2048).optional(),
  commission: z.any().optional(),
});

/**
 * POST /api/admin/vendors
 * Create a vendor and attach it to a user account
 */
export const POST = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:vendors:create", preset: "moderate" },
  },
  async ({ request, session }) => {
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    await syncDefaultVendorWithSettings(session.user.id, settings);

    const body = await validateBody(request, AdminVendorCreateSchema);
    const storeName = String(body.storeName || "").trim();
    const ownerName = String(body.ownerName || "").trim();
    const ownerEmail = String(body.ownerEmail || "").trim().toLowerCase();
    const ownerPhone = String(body.ownerPhone || "").trim();

    if (!storeName) throw new ValidationError("Store name is required");
    if (!ownerName) throw new ValidationError("Owner name is required");
    if (!ownerEmail) throw new ValidationError("Owner email is required");

    const requestedSlug = String(body.slug || "").trim();
    const baseSlug = slugify(requestedSlug || storeName);
    if (!baseSlug) throw new ValidationError("Invalid store slug");
    if (baseSlug === DEFAULT_VENDOR_SLUG) {
      throw new ValidationError("This store slug is reserved for the default store");
    }

    const existingUser = await User.findOne({ email: ownerEmail })
      .select("_id role roles")
      .lean();

    let userId: string;
    if (existingUser) {
      const existingRoles = Array.isArray(
        (existingUser as { roles?: unknown }).roles,
      )
        ? ((existingUser as { roles?: string[] }).roles || [])
        : [];
      if (
        existingUser.role === USER_ROLES.ADMIN ||
        isStaffRole(existingUser.role) ||
        existingRoles.includes(USER_ROLES.ADMIN) ||
        existingRoles.some(isStaffRole)
      ) {
        throw new ValidationError(`User already has ${existingUser.role} role`);
      }
      const existingVendor = await Vendor.findOne({ userId: existingUser._id })
        .select("_id")
        .lean();
      if (existingVendor) {
        throw new ValidationError("A vendor profile already exists for this user");
      }

      await User.updateOne(
        { _id: existingUser._id },
        {
          $set: {
            name: ownerName,
            phone: ownerPhone || undefined,
            status: body.userStatus || USER_ACCOUNT_STATUS.ACTIVE,
          },
        },
      );
      userId = String(existingUser._id);
    } else {
      const user = await User.create({
        name: ownerName,
        email: ownerEmail,
        phone: ownerPhone || undefined,
        role: USER_ROLES.CUSTOMER,
        roles: [USER_ROLES.CUSTOMER],
        status: body.userStatus || USER_ACCOUNT_STATUS.ACTIVE,
      });
      userId = String(user._id);
    }

    const slugExists = await Vendor.findOne({ slug: baseSlug }).select("_id").lean();
    const finalSlug = slugExists ? `${baseSlug}-${Date.now()}` : baseSlug;

    const status =
      body.status && Object.values(VENDOR_STATUS).includes(body.status)
        ? body.status
        : VENDOR_STATUS.PENDING;

    const vendor = await Vendor.create({
      userId,
      storeName,
      slug: finalSlug,
      description: body.description ? String(body.description).trim() : undefined,
      logo: body.logo ? String(body.logo).trim() : undefined,
      banner: body.banner ? String(body.banner).trim() : undefined,
      // Admin-entered commission is the deliberate manual override; otherwise
      // fall back through the single commission authority (no plan at create).
      commission:
        typeof body.commission === "number"
          ? Math.max(0, Math.min(100, body.commission))
          : resolveVendorCommission(null, null, settings),
      // A rate typed on the create form is this vendor's, not the store's, so
      // a later change to the default must not overwrite it.
      commissionSource:
        typeof body.commission === "number" ? "manual" : "default",
      // Access is not copied onto the vendor any more: it is derived from the
      // plan's packs, or the commission-only baseline when no plan governs
      // them. An explicit empty override list is what marks this row as being
      // on that model — an ABSENT list is what makes `resolveVendorAccess` fall
      // back to the legacy `permissions` field for rows the migration has not
      // reached. So write `[]`, never `undefined`.
      permissionOverrides: [],
      status,
    });

    if (status === VENDOR_STATUS.APPROVED) {
      await setUserRole(userId, USER_ROLES.VENDOR);
    }

    const createdVendor = await Vendor.findById(vendor._id)
      .populate("user", "name email image phone status")
      .lean();

    if (status === VENDOR_STATUS.APPROVED) {
      revalidateProductContent();
    }

    return createdResponse(createdVendor);
  },
);
