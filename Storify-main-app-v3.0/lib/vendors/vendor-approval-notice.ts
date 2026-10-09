import "server-only";

import { defaultLocale } from "@/config/i18n.config";
import { requestEmailVerification } from "@/lib/auth/auth";
import {
  resolveAccountAccessPurpose,
  sendAccountAccessEmail,
} from "@/lib/auth/account-access";
import { sendVendorApprovedEmail } from "@/lib/email/vendor-emails";
import { normalizeNotificationSettings } from "@/lib/notifications/notification-settings";
import { vendorApprovalEmail } from "@/lib/vendors/vendor-approval-email";
import type { ISettings } from "@/models/settings.model";

/**
 * The email for a store an admin makes already approved ("Add vendor" with
 * the status Approved).
 *
 * Approving a pending store sends its own email from the vendor route. A store
 * created approved used to get nothing at all, and an owner the form had just
 * made — an account with no password — had no way to sign in. The rule is the
 * approval route's (`vendorApprovalEmail`): an owner with no password gets the
 * invitation to set one, worded as the approval; anyone else the approval
 * email. Nothing is sent when the store has switched those emails off.
 *
 * As there, an owner who signs in with an address not yet confirmed is asked
 * to confirm it when the store requires vendors to — the set-password link
 * proves the address on its own.
 */
export async function emailOwnerOfApprovedVendor(params: {
  userId: string;
  email: string;
  name: string;
  storeName: string;
  emailVerified?: boolean;
  settings: ISettings;
}): Promise<"off" | "set-password" | "approved"> {
  const kind = vendorApprovalEmail({
    paymentRequired: false,
    ownerHasPassword: (await resolveAccountAccessPurpose(params.userId)) === "reset",
  });
  if (
    kind === "approved" &&
    params.settings.security?.emailVerificationForVendors &&
    params.email &&
    !params.emailVerified
  ) {
    await requestEmailVerification(params.email, `/${defaultLocale}/email-verified`).catch(
      (error) => {
        console.error("Failed to request vendor email verification:", error);
      },
    );
  }

  const channels = normalizeNotificationSettings(params.settings.notifications).vendor
    .applicationStatus;
  if (!channels.email || !params.email) return "off";
  if (kind === "set-password") {
    await sendAccountAccessEmail({
      userId: params.userId,
      purpose: "invite",
      copy: "vendor-approved",
    });
    return "set-password";
  }
  await sendVendorApprovedEmail({
    vendorEmail: params.email,
    vendorName: params.name,
    storeName: params.storeName,
    settings: params.settings,
  });
  return "approved";
}
