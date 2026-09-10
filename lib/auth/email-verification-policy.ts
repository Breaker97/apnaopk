import { USER_ROLES, type UserRole } from "@/config/app.config";

export type EmailVerificationStatus =
  | "verified"
  | "not_required"
  | "grace_pending"
  | "blocked_pending";

type EmailVerificationPolicySettings = {
  emailVerificationRequired: boolean;
  emailVerificationForVendors: boolean;
  emailVerificationRequiredSince?: Date;
  emailVerificationForVendorsSince?: Date;
  emailDeliveryReady: boolean;
};

type EmailVerificationPolicyUser = {
  /** The account's real role, as stored by the server. */
  role: UserRole;
  /**
   * `emailVerificationAudience` — the sign-up-time "I am registering as a
   * vendor" marker. Client-supplied, so it is never trusted to *reduce* the
   * requirement; see `resolveEmailVerificationStatus`.
   */
  audience?: string;
  emailVerified: boolean;
  createdAt?: Date;
  emailVerificationRequiredAt?: Date;
};

/**
 * Which onboarding flow a user is in — a vendor applicant is still a customer
 * by role until an admin approves them. Used for routing and for keeping the
 * vendor onboarding endpoints reachable, NOT for choosing a verification
 * policy (that lives in `resolveEmailVerificationStatus`, which must not take
 * a client-supplied claim at face value).
 */
export function resolveEmailVerificationPolicyRole(
  role: UserRole,
  audience?: string,
): UserRole {
  return role === USER_ROLES.VENDOR || audience === USER_ROLES.VENDOR
    ? USER_ROLES.VENDOR
    : role;
}

/** Higher wins when two policies disagree. */
const STATUS_STRICTNESS: Record<EmailVerificationStatus, number> = {
  verified: 0,
  not_required: 1,
  grace_pending: 2,
  blocked_pending: 3,
};

function resolveForPolicy(
  user: EmailVerificationPolicyUser,
  settings: EmailVerificationPolicySettings,
  isVendorPolicy: boolean,
): EmailVerificationStatus {
  const enabled = isVendorPolicy
    ? settings.emailVerificationForVendors
    : settings.emailVerificationRequired;
  if (!enabled || !settings.emailDeliveryReady) return "not_required";

  const enforcedFrom = isVendorPolicy
    ? settings.emailVerificationForVendorsSince
    : settings.emailVerificationRequiredSince;
  if (!enforcedFrom) return "grace_pending";

  const requirementStartedAt = isVendorPolicy
    ? user.emailVerificationRequiredAt || user.createdAt
    : user.createdAt;

  if (!requirementStartedAt || requirementStartedAt < enforcedFrom) {
    return "grace_pending";
  }

  return "blocked_pending";
}

/**
 * Verification state for one account.
 *
 * Approved vendors (role `vendor`, set only by an admin) follow the vendor
 * policy. Everyone else follows the customer policy — and if they carry the
 * client-supplied `vendor` audience marker, the *stricter* of the two applies.
 *
 * That asymmetry is the security property: the marker rides in on the sign-up
 * body, so if it could select the vendor policy outright, anyone could post
 * `emailVerificationAudience: "vendor"` on the common
 * customers-must-verify / vendors-need-not configuration and walk past the
 * verification gate on an address they do not own. Letting it only ever add
 * strictness keeps the vendor-registration flow honest without handing the
 * client a downgrade switch.
 */
export function resolveEmailVerificationStatus(
  user: EmailVerificationPolicyUser,
  settings: EmailVerificationPolicySettings,
): EmailVerificationStatus {
  if (user.emailVerified) return "verified";

  const isCustomer = user.role === USER_ROLES.CUSTOMER;
  const isVendor = user.role === USER_ROLES.VENDOR;
  if (!isCustomer && !isVendor) return "not_required";

  if (isVendor) return resolveForPolicy(user, settings, true);

  const customerStatus = resolveForPolicy(user, settings, false);
  if (user.audience !== USER_ROLES.VENDOR) return customerStatus;

  const vendorStatus = resolveForPolicy(user, settings, true);
  return STATUS_STRICTNESS[vendorStatus] > STATUS_STRICTNESS[customerStatus]
    ? vendorStatus
    : customerStatus;
}
