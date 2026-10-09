import { connectDB } from "@/lib/db";
import { Vendor } from "@/models";
import { createdResponse, paginatedResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { USER_ACCOUNT_STATUS, VENDOR_STATUS } from "@/config/app.config";
import { getSettings } from "@/models/settings.model";
import { validateQuery, validateBody } from "@/lib/api/validate";
import { AdminListQuerySchema } from "@/lib/validations";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import { withApi } from "@/lib/api/handler";
import { createAuditContext } from "@/lib/audit";
import { fetchAdminVendorList } from "@/lib/vendors/vendor-list";
import { createVendorWithOwner } from "@/lib/vendors/vendor-create";
import { emailOwnerOfApprovedVendor } from "@/lib/vendors/vendor-approval-notice";
import { afterResponse } from "@/lib/after-response";
import * as z from "zod";

/**
 * GET /api/admin/vendors
 * Get all vendors with search and filter
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:vendors:list", preset: "lenient" },
  },
  async ({ request }) => {
    const { page, limit, search, status, sortOrder } = validateQuery(
      request,
      AdminListQuerySchema,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

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
  commission: z.number().finite().min(0).max(100).optional(),
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

    const body = await validateBody(request, AdminVendorCreateSchema);
    // The form's rate arrives pre-filled with the default; the service marks it
    // manual only when the admin changed it.
    const created = await createVendorWithOwner(
      {
        storeName: body.storeName,
        ownerName: body.ownerName,
        ownerEmail: body.ownerEmail,
        ownerPhone: body.ownerPhone,
        slug: body.slug,
        status: body.status,
        userStatus: body.userStatus,
        description: body.description,
        logo: body.logo,
        banner: body.banner,
        commission: body.commission,
      },
      {
        userId: session.user.id,
        auditContext: createAuditContext(request, session),
      },
      { settings, existingAccount: "replace" },
    );

    const createdVendor = await Vendor.findById(created.vendorId)
      .populate("user", "name email image phone status emailVerified")
      .lean();

    if (created.status === VENDOR_STATUS.APPROVED) {
      revalidateProductContent();
      // A store made approved is told so — and a new owner, who has no
      // password yet, gets the way in. After the response: an email never
      // holds up the save.
      const owner = (
        createdVendor as {
          user?: { email?: string; name?: string; emailVerified?: boolean };
        } | null
      )?.user;
      afterResponse(() =>
        emailOwnerOfApprovedVendor({
          userId: created.userId,
          email: String(owner?.email ?? body.ownerEmail ?? "").trim().toLowerCase(),
          name: String(owner?.name ?? body.ownerName ?? ""),
          storeName: String(body.storeName ?? "").trim(),
          emailVerified: owner?.emailVerified === true,
          settings,
        }),
      );
    }

    return createdResponse(createdVendor);
  },
);
