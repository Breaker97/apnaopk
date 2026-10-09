import {
  ChangePasswordRequest,
  ME_REASONS,
  PasswordChange,
  type PasswordPolicy,
} from "@/contracts/mobile/shop/v1/me";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { shopAppAuditContext } from "@/lib/api-core/shop/audit-context";
import { changeOwnPassword, type PasswordChangeRefusal } from "@/lib/auth/own-password";
import { MAX_ALLOWED_PASSWORD_LENGTH } from "@/lib/auth/password-policy";

function refusalError(refusal: PasswordChangeRefusal): MobileApiError {
  if (refusal.field === null) {
    return new MobileApiError(403, "AUTHORIZATION_ERROR", refusal.message, {
      reason: refusal.reason,
    });
  }
  const details: PasswordPolicy | undefined =
    refusal.reason === "PASSWORD_POLICY"
      ? {
          minLength: refusal.policy.minPasswordLength,
          maxLength: MAX_ALLOWED_PASSWORD_LENGTH,
          requireUppercase: refusal.policy.requireUppercase,
          requireNumber: refusal.policy.requireNumbers,
          requireSpecialCharacter: refusal.policy.requireSpecialChars,
        }
      : undefined;
  return new MobileApiError(400, "VALIDATION_ERROR", refusal.message, {
    reason: refusal.reason,
    errors: { [refusal.field]: [refusal.message] },
    ...(details ? { details } : {}),
  });
}

/**
 * POST /me/password: the account page's change-password
 * (`changeOwnPassword`, lib/auth/own-password.ts), with the store's password
 * policy, the current-password check, and every other device signed out.
 */
export const changePasswordRoute = defineRoute({
  id: "me.password.change",
  method: "POST",
  path: "/me/password",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "auth:change-password", preset: "strict" },
  // A demo store's shared shopper account must keep the password its
  // visitors are given; the account page's form refuses on demos too.
  demo: "block-mutations",
  input: ChangePasswordRequest,
  output: PasswordChange,
  reasons: { values: ME_REASONS },
  handler: async ({ input, session, client, requestId, locale }) => {
    const result = await changeOwnPassword({
      userId: session.user.id,
      sessionId: session.sessionId,
      signedInAt: session.signedInAt,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      auditContext: shopAppAuditContext({
        session,
        client,
        requestId,
        locale,
        method: "POST",
        path: "/me/password",
      }),
    });
    if (!result.ok) throw refusalError(result.refusal);
    return { mode: result.mode === "changed" ? "CHANGED" : "SET" };
  },
});
