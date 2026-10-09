import { DEFAULT_PRIMARY_COLOR } from "@/config/branding.config";
import { escapeHtml } from "@/lib/email/escape-html";
import type { PasswordTokenPurpose } from "@/models/password-reset.model";

/** "1 hour", "7 days": how long a link works, as the email words it. */
function describeLifetime(ms: number): string {
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Whose words an account email speaks in. "vendor-moved": an imported store's
 * owner, whose store has moved to this marketplace; "vendor-approved": a store
 * owner with no password, whose store an admin just approved.
 */
export type AccountAccessCopy = "customer" | "vendor-moved" | "vendor-approved";

/**
 * The email behind every "set a password" link a shopper gets: a reset of a
 * password they forgot, or an invitation to set the first one on an account
 * the store made for them (an admin's "Send account invite", a guest asked to
 * claim their orders, an imported customer).
 *
 * The name is whatever was typed at sign-up or checkout, and the store name is
 * the merchant's own, so everything printed here is escaped. English, like the
 * store's other emails.
 */
export function accountAccessEmail(params: {
  purpose: PasswordTokenPurpose;
  name: string;
  storeName: string;
  url: string;
  /** How long the link works, as the token was made. */
  lifetimeMs: number;
  /**
   * The account's owner asked for it on the forgot-password page, rather than
   * the store sending it. An account with no password then gets the "set"
   * wording, without being told the store set one up for them.
   */
  selfService?: boolean;
  copy?: AccountAccessCopy;
  /** The owner's own store, named by the vendor wordings. */
  vendorStoreName?: string;
}): { subject: string; html: string } {
  const name = escapeHtml(params.name || "there");
  const storeName = escapeHtml(params.storeName);
  const url = escapeHtml(params.url);
  const invite = params.purpose === "invite";
  const lifetime = describeLifetime(params.lifetimeMs);
  // A store owner's invitation. `storeName` stays the marketplace's own name,
  // as in every account email; the owner's store is named alongside it.
  const vendorCopy =
    invite &&
    !params.selfService &&
    params.vendorStoreName &&
    (params.copy === "vendor-moved" || params.copy === "vendor-approved")
      ? params.copy
      : null;
  const vendorStore = escapeHtml(params.vendorStoreName ?? "");

  const heading = vendorCopy === "vendor-moved"
    ? `Your store has moved to ${storeName}`
    : vendorCopy === "vendor-approved"
      ? "Your store is approved"
      : invite
        ? params.selfService
          ? "Set your password"
          : "Set up your account"
        : "Reset your password";
  const lead = vendorCopy === "vendor-moved"
    ? `Your store <strong>${vendorStore}</strong> is now on <strong>${storeName}</strong>. Choose a password to sign in to your seller dashboard and manage your store. If you already have an account here, you can sign in with your current password instead.`
    : vendorCopy === "vendor-approved"
      ? `Your store <strong>${vendorStore}</strong> has been approved on <strong>${storeName}</strong>. Choose a password to sign in to your seller dashboard.`
      : invite
        ? params.selfService
          ? `We received a request to set a password for your <strong>${storeName}</strong> account. Click the button below to choose one.`
          : `An account has been set up for you at <strong>${storeName}</strong>. Choose a password to sign in, see your orders and check out faster.`
        : `We received a request to reset the password for your <strong>${storeName}</strong> account. Click the button below to choose a new one.`;
  const button = invite ? "Set your password" : "Reset password";
  const expiry = vendorCopy
    ? `This link will expire in ${lifetime}. If it expires, use "Forgot password" on the sign-in page to get a new one.`
    : invite && !params.selfService
      ? `This link will expire in ${lifetime}. If it expires, ask the store for a new one.`
      : `This link will expire in ${lifetime}.`;
  const ignore =
    vendorCopy || (invite && !params.selfService)
      ? "If you weren't expecting this, you can safely ignore this email."
      : invite
        ? "If you didn't ask to set a password, you can safely ignore this email."
        : "If you didn't ask to reset your password, you can safely ignore this email.";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: white; border-radius: 8px; padding: 32px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #e4e4e7; margin-bottom: 24px;">
        <h1 style="font-size: 24px; font-weight: bold; color: #18181b; margin: 0;">${storeName}</h1>
      </div>

      <h2 style="font-size: 20px; font-weight: 600; color: #18181b; margin: 0 0 8px 0;">${heading}</h2>
      <p style="color: #52525b; font-size: 15px; line-height: 1.6;">
        Hi ${name},
      </p>
      <p style="color: #52525b; font-size: 15px; line-height: 1.6;">
        ${lead}
      </p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${url}" style="display: inline-block; padding: 14px 32px; background-color: ${DEFAULT_PRIMARY_COLOR}; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">
          ${button}
        </a>
      </div>

      <p style="color: #71717a; font-size: 13px; line-height: 1.6;">
        Or copy and paste this link into your browser:
      </p>
      <p style="color: ${DEFAULT_PRIMARY_COLOR}; font-size: 13px; word-break: break-all;">
        ${url}
      </p>

      <div style="height: 1px; background: #e4e4e7; margin: 24px 0;"></div>

      <p style="color: #71717a; font-size: 13px; line-height: 1.6;">
        ${expiry}
      </p>
      <p style="color: #71717a; font-size: 13px; line-height: 1.6;">
        ${ignore}
      </p>
    </div>
    <div style="text-align: center; padding: 16px 0;">
      <p style="color: #a1a1aa; font-size: 12px; margin: 0;">
        &copy; ${new Date().getFullYear()} ${storeName}. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>`;

  return {
    subject:
      vendorCopy === "vendor-moved"
        ? `Your store ${params.vendorStoreName} has moved to ${params.storeName} - set your password`
        : vendorCopy === "vendor-approved"
          ? `Your store ${params.vendorStoreName} is approved - set your password for ${params.storeName}`
          : invite
            ? `Set your password for ${params.storeName}`
            : `Reset your password - ${params.storeName}`,
    html,
  };
}
