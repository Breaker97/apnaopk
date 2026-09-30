import { DEFAULT_PRIMARY_COLOR } from "@/config/branding.config";
import { escapeHtml } from "@/lib/email/escape-html";

/**
 * The invitation a new team member gets, from the admin's Team page or a
 * vendor's Staff page. The name is whatever was typed when the account was
 * set up, and a vendor names its own store, so both are escaped along with
 * everything else printed here.
 */
export function staffInviteEmailHtml(params: {
  name: string;
  storeName: string;
  /** "an administrator", "a staff member". */
  roleLabel: string;
  inviteUrl: string;
}): string {
  const name = escapeHtml(params.name);
  const storeName = escapeHtml(params.storeName);
  const roleLabel = escapeHtml(params.roleLabel);
  const inviteUrl = escapeHtml(params.inviteUrl);
  return `
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

      <h2 style="font-size: 20px; font-weight: 600; color: #18181b; margin: 0 0 8px 0;">You're invited!</h2>
      <p style="color: #52525b; font-size: 15px; line-height: 1.6;">
        Hi ${name},
      </p>
      <p style="color: #52525b; font-size: 15px; line-height: 1.6;">
        You've been invited to join <strong>${storeName}</strong> as ${roleLabel}. To get started, please set up your password by clicking the button below.
      </p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${inviteUrl}" style="display: inline-block; padding: 14px 32px; background-color: ${DEFAULT_PRIMARY_COLOR}; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">
          Set Your Password
        </a>
      </div>

      <p style="color: #71717a; font-size: 13px; line-height: 1.6;">
        Or copy and paste this link into your browser:
      </p>
      <p style="color: ${DEFAULT_PRIMARY_COLOR}; font-size: 13px; word-break: break-all;">
        ${inviteUrl}
      </p>

      <div style="height: 1px; background: #e4e4e7; margin: 24px 0;"></div>

      <p style="color: #71717a; font-size: 13px; line-height: 1.6;">
        This link will expire in 1 hour. If it expires, ask for a new invite.
      </p>
      <p style="color: #71717a; font-size: 13px; line-height: 1.6;">
        If you didn't expect this invitation, you can safely ignore this email.
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
}
