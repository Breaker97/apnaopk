import { connectDB } from "@/lib/db";
import { CustomerProfile, User } from "@/models";
import { fetchVendorCustomerList } from "@/lib/customers/customer-list";
import { paginatedResponse, createdResponse } from "@/lib/api/response";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ApiError,
  ValidationError,
} from "@/lib/api/errors";
import { USER_ACCOUNT_STATUS, USER_ROLES } from "@/config/app.config";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { hasVendorPermission, isAdmin, type MinimalUser } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { validateBody, validateQuery } from "@/lib/api/validate";
import {
  AdminCreateCustomerSchema,
  CustomerListQuerySchema,
} from "@/lib/validations";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { ensureCustomerProfile } from "@/lib/customers/customer";
import { createAuditContext, auditCreate } from "@/lib/audit";
import { notifyAdminsNewCustomer } from "@/lib/notifications/notifications";
import { withApi } from "@/lib/api/handler";
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

async function requireVendorOrderPermission(user: MinimalUser) {
  if (isAdmin(user)) return;
  const canCreate = await hasVendorPermission(
    user,
    VENDOR_PERMISSIONS.CREATE_ORDERS,
  );
  if (canCreate) return;
  const canManage = await hasVendorPermission(
    user,
    VENDOR_PERMISSIONS.MANAGE_ORDERS,
  );
  if (canManage) return;
  throw new AuthorizationError(
    "You do not have permission to create orders",
  );
}

/**
 * Reading the list additionally opens to view_orders: the customers page
 * derives entirely from orders the vendor can already see, so it exposes
 * nothing an order-viewing member doesn't have. Creating customers (POST)
 * stays behind the order-creation permissions.
 */
async function requireVendorCustomerListPermission(user: MinimalUser) {
  if (isAdmin(user)) return;
  if (await hasVendorPermission(user, VENDOR_PERMISSIONS.VIEW_ORDERS)) return;
  return requireVendorOrderPermission(user);
}

/**
 * GET /api/vendor/customers
 * Returns everyone — registered or guest — who has placed an order containing
 * this vendor's items, with vendor-scoped stats. Response shape mirrors
 * /api/admin/customers so the same client mapper can consume it.
 */
export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    await requireVendorCustomerListPermission(session.user);

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:customers:list",
      "lenient",
      session.user.role,
    );

    const { page, limit, search, status, sortBy, sortOrder } = validateQuery(
      request,
      CustomerListQuerySchema,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id);

    const list = await fetchVendorCustomerList(vendor._id, {
      page,
      limit,
      search,
      status,
      sortBy,
      sortOrder,
    });

    return paginatedResponse(list.items, list.page, list.limit, list.total);
  },
);

/**
 * POST /api/vendor/customers
 * Vendor-side create-customer used during order creation. Mirrors the admin
 * endpoint but gated by vendor order permissions.
 */
export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    await requireVendorOrderPermission(session.user);

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:customers:create",
      "moderate",
      session.user.role,
    );

    const parsed = await validateBody(request, AdminCreateCustomerSchema);
    const email = parsed.email.trim().toLowerCase();
    const shippingAddress = normalizeShippingAddress(parsed.shippingAddress);

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    await requireApprovedVendorByUserId(session.user.id);

    if (
      shippingAddress?.country &&
      !isCountryAllowed(
        shippingAddress.country,
        settings.general?.countryAvailability,
      )
    ) {
      throw new ValidationError({
        "shippingAddress.country": ["Selected country is not available"],
      });
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
        createdViaVendor: session.user.id,
      },
      user.email,
    );

    await notifyAdminsNewCustomer(
      {
        customerId: user._id.toString(),
        name: user.name,
        email: user.email,
        createdBy: session.user.id,
      },
      { settings },
    );

    return createdResponse({ profile }, "Customer created successfully");
  },
);
