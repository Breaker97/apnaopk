import { connectDB } from "@/lib/db";
import { CustomerProfile, User } from "@/models";
import { paginatedResponse, createdResponse } from "@/lib/api/response";
import { ConflictError, ApiError, ValidationError } from "@/lib/api/errors";
import { USER_ACCOUNT_STATUS, USER_ROLES } from "@/config/app.config";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { validateBody, validateQuery } from "@/lib/api/validate";
import { AdminCreateCustomerSchema, CustomerListQuerySchema } from "@/lib/validations";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { computeLoyaltyTier, ensureCustomerProfile } from "@/lib/customers/customer";
import {
  createAuditContext,
  auditCreate,
} from "@/lib/audit";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { notifyAdminsNewCustomer } from "@/lib/notifications/notifications";
import { withApi } from "@/lib/api/handler";
import { fetchAdminCustomerList } from "@/lib/customers/customer-list";
import { getSettings } from "@/models/settings.model";
import { isCountryAllowed } from "@/lib/intl/country-availability";

type ShippingAddressInput = {
  firstName?: string;
  lastName?: string;
  street: string;
  city: string;
  state?: string;
  apartment?: string;
  postalCode: string;
  country: string;
  phone?: string;
  isDefault?: boolean;
  label?: "home" | "work" | "other";
};

function normalizeShippingAddress(address?: ShippingAddressInput) {
  if (!address) return undefined;
  return {
    firstName: address.firstName?.trim() || undefined,
    lastName: address.lastName?.trim() || undefined,
    street: address.street.trim(),
    city: address.city.trim(),
    state: address.state?.trim() || undefined,
    apartment: address.apartment?.trim() || undefined,
    postalCode: address.postalCode.trim(),
    country: address.country.trim(),
    phone: address.phone?.trim() || undefined,
    isDefault: true,
    label: address.label || "home",
  };
}

/**
 * GET /api/admin/customers
 * Get paginated customer list with filters
 */
export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    let staffScope = undefined as
      | Awaited<ReturnType<typeof assertAdminOrStaffPermissions>>["staffScope"]
      | undefined;
    if (session.user.role !== USER_ROLES.ADMIN) {
      const access = await assertAdminOrStaffPermissions(
        session as unknown as { user: { id: string; role: string } },
        [STAFF_PERMISSIONS.VIEW_CUSTOMERS],
      );
      staffScope = access.staffScope;
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:customers:list",
      "lenient",
      session.user.role
    );

    const {
      page,
      limit,
      search,
      status,
      sortBy,
      sortOrder,
      loyaltyTier,
      tag,
      minSpent,
      maxSpent,
    } = validateQuery(request, CustomerListQuerySchema);

    const list = await fetchAdminCustomerList(
      {
        page,
        limit,
        search,
        status,
        sortBy,
        sortOrder,
        loyaltyTier,
        tag,
        minSpent,
        maxSpent,
      },
      staffScope,
    );

    return paginatedResponse(list.items, list.page, list.limit, list.total);
  },
);

/**
 * POST /api/admin/customers
 * Create a new customer with profile
 */
export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    if (session.user.role !== USER_ROLES.ADMIN) {
      await assertAdminOrStaffPermissions(
        session as unknown as { user: { id: string; role: string } },
        [
          STAFF_PERMISSIONS.CREATE_CUSTOMERS,
          STAFF_PERMISSIONS.MANAGE_CUSTOMERS,
        ],
      );
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:customers:create",
      "moderate",
      session.user.role
    );

    const parsed = await validateBody(request, AdminCreateCustomerSchema);
    const email = parsed.email.trim().toLowerCase();
    const shippingAddress = normalizeShippingAddress(parsed.shippingAddress);

    await connectDB();
    if (shippingAddress) {
      const settings = await getSettings();
      if (
        !isCountryAllowed(
          shippingAddress.country,
          settings.general?.countryAvailability,
        )
      ) {
        throw new ValidationError({
          "shippingAddress.country": ["Selected country is not available"],
        });
      }
    }

    const existingUser = await User.findOne({ email }).select("_id role").lean();
    if (existingUser) {
      throw new ConflictError("A user with this email already exists");
    }

    const user = await User.create({
      name: parsed.name.trim(),
      email,
      phone: parsed.phone?.trim() || undefined,
      addresses: shippingAddress ? [shippingAddress] : [],
      role: USER_ROLES.CUSTOMER,
      roles: [USER_ROLES.CUSTOMER],
      status: parsed.status || USER_ACCOUNT_STATUS.ACTIVE,
    });

    const baseProfile = await ensureCustomerProfile(user._id.toString());
    if (!baseProfile) {
      throw new ApiError("Failed to initialize customer profile", 500);
    }

    const tags =
      parsed.tags?.map((tag) => tag.trim()).filter(Boolean) || undefined;

    const profileUpdates: Record<string, unknown> = {};
    if (tags) profileUpdates.tags = Array.from(new Set(tags));
    if (parsed.notes !== undefined) profileUpdates.notes = parsed.notes;
    // A manual adjustment has to move `lifetimePoints` with the balance and
    // re-derive the tier, because the order-backed service derives the tier
    // from `lifetimePoints` on every award and reversal. Setting the two
    // independently meant an adjusted balance was invisible to the tier, and a
    // hand-picked tier was silently reverted by the customer's next order.
    if (parsed.loyaltyPoints !== undefined) {
      const points = Math.max(0, Math.floor(parsed.loyaltyPoints));
      profileUpdates.loyaltyPoints = points;
      profileUpdates.lifetimePoints = points;
      profileUpdates.loyaltyTier = computeLoyaltyTier(points);
    }
    if (parsed.acquisitionSource !== undefined) {
      profileUpdates.acquisitionSource = parsed.acquisitionSource;
    }
    if (shippingAddress) profileUpdates.shippingAddress = shippingAddress;

    if (Object.keys(profileUpdates).length > 0) {
      await CustomerProfile.updateOne(
        { _id: baseProfile._id },
        { $set: profileUpdates },
      );
    }

    const profile = await CustomerProfile.findById(baseProfile._id)
      .populate({
        path: "userId",
        select: "name email image phone role status createdAt",
      })
      .lean();

    const auditContext = createAuditContext(request, session);
    await auditCreate(
      auditContext,
      "user",
      user._id.toString(),
      {
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        customerProfileId: String(baseProfile._id),
      },
      user.email,
    );

    await notifyAdminsNewCustomer({
      customerId: user._id.toString(),
      name: user.name,
      email: user.email,
      createdBy: session.user.id,
    });

    return createdResponse(
      { profile },
      "Customer created successfully",
    );
  },
);
