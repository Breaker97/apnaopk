import { connectDB } from "@/lib/db";
import { CustomerProfile, User } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import {
  AuthorizationError,
  ConflictError,
  ValidationError,
} from "@/lib/api/errors";
import {
  MARKETING_CONSENT_SOURCE,
  MARKETING_CONSENT_STATE,
  MARKETING_OPT_IN_LEVEL,
  USER_ROLES,
} from "@/config/app.config";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { AdminUpdateCustomerProfileSchema } from "@/lib/validations";
import { computeLoyaltyTier } from "@/lib/customers/customer";
import { isLoyaltyEnabled } from "@/lib/customers/loyalty";
import { setMarketingConsent } from "@/lib/customers/marketing-consent";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import {
  createAuditContext,
  auditDelete,
  auditUpdate,
} from "@/lib/audit";
import { Types } from "mongoose";
import { validateBody } from "@/lib/api/validate";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { isCustomerAccount } from "@/lib/access/customer-account";
import { revokeAllSessions } from "@/lib/auth/session-revocation";
import { notifyAccountStatusChange } from "@/lib/notifications/notifications";
import { afterResponse } from "@/lib/after-response";
import { hasStaffScope, type StaffAccessScope } from "@/lib/access/staff-scope";
import { isProfileInStaffScope } from "@/lib/customers/customer-staff-scope";
import { withApi } from "@/lib/api/handler";
import { cleanupDeletedUserReferences } from "@/lib/customers/user-cleanup";
import { accountEmailOption } from "@/lib/customers/account-email-recipients";
import { getSettings } from "@/models/settings.model";
import {
  areCountryValuesEquivalent,
  isCountryAllowed,
} from "@/lib/intl/country-availability";

/**
 * The customer screen changes shoppers only — see `isCustomerAccount`. Refused
 * for admins too: a team member's or seller's login is changed on the screen
 * that owns their role, where the owner and last-admin rules are kept.
 */
const NOT_A_CUSTOMER_ACCOUNT =
  "This account belongs to a seller or a team member. Change it from their own page.";

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

    // The header's "Send password reset" / "Send account invite", or neither.
    const accountEmail = await accountEmailOption(profile);

    return successResponse({ profile, accountEmail });
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
          .select("name email phone role roles status addresses")
          .lean()
      : null;
    if (!isGuestProfile && !existingUser) {
      return notFoundResponse("Customer user");
    }
    if (existingUser && !isCustomerAccount(existingUser)) {
      throw new AuthorizationError(NOT_A_CUSTOMER_ACCOUNT);
    }

    const profileUpdateFields: Record<string, unknown> = {};
    const userUpdateFields: Record<string, unknown> = {};
    let emailChanged = false;

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
    // While loyalty is hidden (`isLoyaltyEnabled`) the balance takes no edits:
    // the customer page's Save still sends the loaded balance, and rewriting
    // it would also reset `lifetimePoints` behind a screen nobody can see.
    if (parsed.loyaltyPoints !== undefined && isLoyaltyEnabled()) {
      const points = Math.max(0, Math.floor(parsed.loyaltyPoints));
      profileUpdateFields.loyaltyPoints = points;
      profileUpdateFields.lifetimePoints = points;
      profileUpdateFields.loyaltyTier = computeLoyaltyTier(points);
    }
    if (parsed.acquisitionSource !== undefined)
      profileUpdateFields.acquisitionSource = parsed.acquisitionSource;
    // Marketing consent is a state with a date and a source behind it, so it
    // is applied through `setMarketingConsent` rather than `$set` — including
    // for guest rows, which is the whole point of keeping it off the User.
    // Applied after the other writes, below; recorded here for the audit.
    const consentRequested = parsed.marketingOptIn;
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
          // The login email is where a password reset goes, so changing it
          // hands over the account. Only an admin may, the new address is
          // unverified until the shopper confirms it, and every session
          // signed in under the old one ends (below, after the write).
          if (session.user.role !== USER_ROLES.ADMIN) {
            throw new AuthorizationError(
              "Only an admin can change a customer's login email.",
            );
          }
          emailChanged = true;
          userUpdateFields.emailVerified = false;
          userUpdateFields.emailVerifiedAt = null;
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
      Object.keys(userUpdateFields).length === 0 &&
      consentRequested === undefined
    ) {
      return successResponse({ message: "No fields to update" });
    }

    if (Object.keys(profileUpdateFields).length > 0) {
      await CustomerProfile.updateOne({ _id: id }, { $set: profileUpdateFields });
    }
    if (consentRequested !== undefined) {
      await setMarketingConsent({
        state: consentRequested
          ? MARKETING_CONSENT_STATE.SUBSCRIBED
          : MARKETING_CONSENT_STATE.UNSUBSCRIBED,
        // An admin switching it on is vouching for consent given somewhere
        // this store did not record, so the level stays honest about that.
        optInLevel: consentRequested
          ? MARKETING_OPT_IN_LEVEL.UNKNOWN
          : undefined,
        source: MARKETING_CONSENT_SOURCE.ADMIN,
        profileId: id,
      });
      profileUpdateFields.marketingOptIn = consentRequested;
    }
    if (userId && Object.keys(userUpdateFields).length > 0) {
      await User.updateOne({ _id: userId }, { $set: userUpdateFields });
    }
    if (userId && emailChanged) await revokeAllSessions(userId);
    if (userId && userUpdateFields.status !== undefined) {
      afterResponse(() =>
        notifyAccountStatusChange({
          userId,
          from: existingUser?.status,
          to: String(userUpdateFields.status),
        }),
      );
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
        select: "name email role roles",
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
    if (userFromProfile && !isCustomerAccount(userFromProfile)) {
      throw new AuthorizationError(NOT_A_CUSTOMER_ACCOUNT);
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
