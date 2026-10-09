import { connectDB } from "@/lib/db";
import { paginatedResponse, createdResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { USER_ROLES } from "@/config/app.config";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { validateBody, validateQuery } from "@/lib/api/validate";
import { AdminCreateCustomerSchema, CustomerListQuerySchema } from "@/lib/validations";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { createAuditContext } from "@/lib/audit";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { createCustomerFromForm } from "@/lib/customers/customer-upsert";
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
      emailSubscription,
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
        subscription: emailSubscription,
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

    // One account per email, and a guest row under it becomes that account's
    // row instead of a second one beside it (see createCustomerFromForm).
    const profile = await createCustomerFromForm(
      {
        name: parsed.name.trim(),
        email,
        phone: parsed.phone,
        status: parsed.status,
        tags: parsed.tags,
        notes: parsed.notes,
        loyaltyPoints: parsed.loyaltyPoints,
        acquisitionSource: parsed.acquisitionSource,
        shippingAddress,
      },
      {
        auditContext: createAuditContext(request, session),
        createdBy: session.user.id,
        audience: "admin",
      },
    );

    return createdResponse(
      { profile },
      "Customer created successfully",
    );
  },
);
