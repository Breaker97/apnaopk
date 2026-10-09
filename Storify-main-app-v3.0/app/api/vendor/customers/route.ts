import { connectDB } from "@/lib/db";
import { fetchVendorCustomerList } from "@/lib/customers/customer-list";
import { paginatedResponse, createdResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import {
  requireVendorCustomerListPermission,
  requireVendorOrderPermission,
} from "@/lib/vendors/vendor-customer-access";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { validateBody, validateQuery } from "@/lib/api/validate";
import {
  AdminCreateCustomerSchema,
  CustomerListQuerySchema,
} from "@/lib/validations";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { createAuditContext } from "@/lib/audit";
import { createCustomerFromForm } from "@/lib/customers/customer-upsert";
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

    // The same account the admin's form makes — a guest row under the email
    // becomes its row — minus the store-only fields (points, source).
    const profile = await createCustomerFromForm(
      {
        name: parsed.name.trim(),
        email,
        phone: parsed.phone,
        status: parsed.status,
        tags: parsed.tags,
        notes: parsed.notes,
        shippingAddress,
      },
      {
        auditContext: createAuditContext(request, session),
        createdBy: session.user.id,
        audience: "vendor",
        settings,
      },
    );

    return createdResponse({ profile }, "Customer created successfully");
  },
);
