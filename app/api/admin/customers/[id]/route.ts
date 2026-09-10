import { connectDB } from "@/lib/db";
import { CustomerProfile, Order, User } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import {
  AuthorizationError,
  ConflictError,
  ValidationError,
} from "@/lib/api/errors";
import { USER_ROLES } from "@/config/app.config";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { AdminUpdateCustomerProfileSchema } from "@/lib/validations";
import { computeLoyaltyTier } from "@/lib/customers/customer";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import {
  createAuditContext,
  auditDelete,
  auditUpdate,
} from "@/lib/audit";
import { Types } from "mongoose";
import { validateBody } from "@/lib/api/validate";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import {
  buildStaffOrderScopeFilter,
  hasStaffScope,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";
import { withApi } from "@/lib/api/handler";
import { cleanupDeletedUserReferences } from "@/lib/customers/user-cleanup";
import { getSettings } from "@/models/settings.model";
import {
  areCountryValuesEquivalent,
  isCountryAllowed,
} from "@/lib/intl/country-availability";

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
 * GET /api/admin/customers/[id]
 * Get a single customer profile with user data
 */
export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ params, session }) => {
    let staffScope: StaffAccessScope | undefined;
    if (session.user.role !== USER_ROLES.ADMIN) {
      const access = await assertAdminOrStaffPermissions(
        session as unknown as { user: { id: string; role: string } },
        [STAFF_PERMISSIONS.VIEW_CUSTOMERS],
      );
      staffScope = access.staffScope;
    }

    const { id } = params;
    if (!Types.ObjectId.isValid(id)) {
      return notFoundResponse("Customer");
    }

    await connectDB();

    const profile = await CustomerProfile.findById(id)
      .populate({
        path: "userId",
        select: "name email image phone role status createdAt",
      })
      .lean();

    if (!profile) {
      return notFoundResponse("Customer profile");
    }
    if (
      hasStaffScope(staffScope) &&
      !(await isProfileInStaffScope(profile, staffScope))
    ) {
      return notFoundResponse("Customer profile");
    }

    return successResponse({ profile });
  },
);

/**
 * PUT /api/admin/customers/[id]
 * Update customer profile (admin fields: tags, notes, loyalty, acquisition)
 */
export const PUT = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    let staffScope: StaffAccessScope | undefined;
    if (session.user.role !== USER_ROLES.ADMIN) {
      const access = await assertAdminOrStaffPermissions(
        session as unknown as { user: { id: string; role: string } },
        [
          STAFF_PERMISSIONS.EDIT_CUSTOMERS,
          STAFF_PERMISSIONS.MANAGE_CUSTOMERS,
        ],
      );
      staffScope = access.staffScope;
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:customers:update",
      "moderate",
      session.user.role
    );

    const { id } = params;
    if (!Types.ObjectId.isValid(id)) {
      return notFoundResponse("Customer");
    }

    const parsed = await validateBody(request, AdminUpdateCustomerProfileSchema);

    await connectDB();

    const existingProfile = await CustomerProfile.findById(id).lean();
    if (!existingProfile) {
      return notFoundResponse("Customer profile");
    }

    if (
      hasStaffScope(staffScope) &&
      !(await isProfileInStaffScope(existingProfile, staffScope))
    ) {
      return notFoundResponse("Customer profile");
    }

    // A guest row has no User document behind it, so only the profile-level
    // fields (tags, notes, loyalty, marketing, address) can be edited; the
    // account fields the form also sends are ignored rather than rejected so
    // an admin can still tag or annotate a guest. Name/email edits wait until
    // the shopper registers and the row is claimed.
    const isGuestProfile = !existingProfile.userId;
    const userId = isGuestProfile ? null : String(existingProfile.userId);

    const existingUser = userId
      ? await User.findById(userId)
          .select("name email phone role status addresses")
          .lean()
      : null;
    if (!isGuestProfile && !existingUser) {
      return notFoundResponse("Customer user");
    }

    const profileUpdateFields: Record<string, unknown> = {};
    const userUpdateFields: Record<string, unknown> = {};

    if (parsed.tags !== undefined) {
      profileUpdateFields.tags = Array.from(
        new Set(parsed.tags.map((tag) => tag.trim()).filter(Boolean)),
      );
    }
    if (parsed.notes !== undefined) profileUpdateFields.notes = parsed.notes;
    // A manual adjustment has to move `lifetimePoints` with the balance and
    // re-derive the tier, because the order-backed service derives the tier
    // from `lifetimePoints` on every award and reversal. Setting the two
    // independently meant an adjusted balance was invisible to the tier, and a
    // hand-picked tier was silently reverted by the customer's next order.
    if (parsed.loyaltyPoints !== undefined) {
      const points = Math.max(0, Math.floor(parsed.loyaltyPoints));
      profileUpdateFields.loyaltyPoints = points;
      profileUpdateFields.lifetimePoints = points;
      profileUpdateFields.loyaltyTier = computeLoyaltyTier(points);
    }
    if (parsed.acquisitionSource !== undefined)
      profileUpdateFields.acquisitionSource = parsed.acquisitionSource;
    if (parsed.marketingOptIn !== undefined)
      profileUpdateFields.marketingOptIn = parsed.marketingOptIn;
    if (parsed.emailNotifications !== undefined)
      profileUpdateFields.emailNotifications = parsed.emailNotifications;
    const shippingAddress = normalizeShippingAddress(parsed.shippingAddress);
    if (shippingAddress !== undefined) {
      const settings = await getSettings();
      const previousCountry =
        (existingProfile as { shippingAddress?: { country?: unknown } })
          .shippingAddress?.country;
      const countryChanged = !areCountryValuesEquivalent(
        shippingAddress.country,
        previousCountry,
      );
      if (
        countryChanged &&
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
    if (shippingAddress !== undefined)
      profileUpdateFields.shippingAddress = shippingAddress;

    if (existingUser) {
      if (parsed.name !== undefined) userUpdateFields.name = parsed.name.trim();
      if (parsed.image !== undefined) {
        userUpdateFields.image = parsed.image.trim() || undefined;
      }
      if (parsed.phone !== undefined) {
        userUpdateFields.phone = parsed.phone.trim() || undefined;
      }
      if (parsed.email !== undefined) {
        const normalizedEmail = parsed.email.trim().toLowerCase();
        if (normalizedEmail !== existingUser.email) {
          const otherUser = await User.findOne({
            email: normalizedEmail,
            _id: { $ne: userId },
          })
            .select("_id")
            .lean();
          if (otherUser) {
            throw new ConflictError("Another user already uses this email");
          }
        }
        userUpdateFields.email = normalizedEmail;
      }
      if (parsed.status !== undefined) {
        userUpdateFields.status = parsed.status;
      }
      if (shippingAddress !== undefined) {
        const currentAddresses = Array.isArray(
          (existingUser as { addresses?: unknown[] }).addresses,
        )
          ? ((existingUser as { addresses: ShippingAddressInput[] }).addresses || [])
          : [];
        const remaining = currentAddresses.slice(1).map((address) => ({
          ...address,
          isDefault: false,
        }));
        userUpdateFields.addresses = [shippingAddress, ...remaining];
      }
    }

    if (
      Object.keys(profileUpdateFields).length === 0 &&
      Object.keys(userUpdateFields).length === 0
    ) {
      return successResponse({ message: "No fields to update" });
    }

    if (Object.keys(profileUpdateFields).length > 0) {
      await CustomerProfile.updateOne({ _id: id }, { $set: profileUpdateFields });
    }
    if (userId && Object.keys(userUpdateFields).length > 0) {
      await User.updateOne({ _id: userId }, { $set: userUpdateFields });
    }

    // Audit log — guest rows audit against the profile id and checkout email,
    // there being no user to attribute the record to.
    const auditContext = createAuditContext(request, session);
    const before = {
      profile: existingProfile,
      user: existingUser,
    } as unknown as Record<string, unknown>;
    const after = {
      profile: { ...existingProfile, ...profileUpdateFields },
      user: existingUser
        ? { ...existingUser, ...userUpdateFields }
        : existingUser,
    } as unknown as Record<string, unknown>;

    await auditUpdate(
      auditContext,
      "user",
      userId || id,
      before,
      after,
      existingUser?.email || existingProfile.email,
    );

    return successResponse({ message: "Customer profile updated successfully" });
  },
);

/**
 * DELETE /api/admin/customers/[id]
 * Delete customer profile and associated user account
 */
export const DELETE = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    let staffScope: StaffAccessScope | undefined;
    if (session.user.role !== USER_ROLES.ADMIN) {
      const access = await assertAdminOrStaffPermissions(
        session as unknown as { user: { id: string; role: string } },
        [
          STAFF_PERMISSIONS.DELETE_CUSTOMERS,
          STAFF_PERMISSIONS.MANAGE_CUSTOMERS,
        ],
      );
      staffScope = access.staffScope;
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:customers:delete",
      "strict",
      session.user.role
    );

    const { id } = params;
    if (!Types.ObjectId.isValid(id)) {
      return notFoundResponse("Customer");
    }

    await connectDB();

    const profile = await CustomerProfile.findById(id)
      .populate({
        path: "userId",
        select: "name email role",
      })
      .lean();
    if (!profile) {
      return notFoundResponse("Customer profile");
    }

    const userFromProfile =
      profile.userId && typeof profile.userId === "object"
        ? (profile.userId as { _id?: Types.ObjectId; name?: string; email?: string; role?: string })
        : null;

    // Guest rows have no User document at all — deleting one removes only the
    // customer record; there is no account, cart, or wishlist to clean up.
    const targetUserId = userFromProfile?._id
      ? String(userFromProfile._id)
      : profile.userId
        ? String(profile.userId)
        : null;
    if (
      hasStaffScope(staffScope) &&
      !(await isProfileInStaffScope(profile, staffScope))
    ) {
      return notFoundResponse("Customer profile");
    }

    if (targetUserId === session.user.id) {
      throw new AuthorizationError("Cannot delete your own account");
    }

    await CustomerProfile.deleteOne({ _id: id });
    if (targetUserId) {
      await User.deleteOne({ _id: targetUserId });
      // Remove owned documents (cart, wishlist, notifications, push
      // subscriptions, reviews) so nothing references a ghost user.
      await cleanupDeletedUserReferences(targetUserId);
    }

    const auditContext = createAuditContext(request, session);
    await auditDelete(
      auditContext,
      "user",
      targetUserId || id,
      {
        customerProfileId: id,
        name: userFromProfile?.name || profile.name,
        email: userFromProfile?.email || profile.email,
      },
      userFromProfile?.email || profile.email,
    );

    return successResponse({ message: "Customer deleted successfully" });
  },
);

async function isCustomerInStaffScope(
  userId: string,
  staffScope?: StaffAccessScope,
) {
  if (!hasStaffScope(staffScope)) return true;
  // Guest profiles reach here with no userId at all; the string then isn't a
  // castable ObjectId, and matching on it would throw rather than filter.
  if (!Types.ObjectId.isValid(userId)) return false;
  const count = await Order.countDocuments({
    customerId: userId,
    ...buildStaffOrderScopeFilter(staffScope),
  });
  return count > 0;
}

/**
 * The profile-shaped variant: registered rows are scoped by their orders'
 * customerId, guest rows by the checkout email their orders carry.
 */
async function isProfileInStaffScope(
  profile: { userId?: unknown; email?: string },
  staffScope?: StaffAccessScope,
) {
  if (!hasStaffScope(staffScope)) return true;
  const userId = getCustomerProfileUserId(profile);
  if (Types.ObjectId.isValid(userId)) {
    return isCustomerInStaffScope(userId, staffScope);
  }
  if (!profile.email) return false;
  const count = await Order.countDocuments({
    guestEmail: profile.email,
    ...buildStaffOrderScopeFilter(staffScope),
  });
  return count > 0;
}

function getCustomerProfileUserId(profile: { userId?: unknown }) {
  const user = profile.userId;
  if (user && typeof user === "object" && "_id" in user) {
    return String((user as { _id?: unknown })._id || "");
  }
  return String(user || "");
}
