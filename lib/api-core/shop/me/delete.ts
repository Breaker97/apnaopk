import {
  AccountDeleted,
  DeleteAccountRequest,
  ME_REASONS,
} from "@/contracts/mobile/shop/v1/me";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { shopAppAuditContext } from "@/lib/api-core/shop/audit-context";
import { verifyOwnPassword } from "@/lib/auth/own-password";
import { isRecentSignIn, RECENT_SIGN_IN_MESSAGE } from "@/lib/auth/recent-sign-in";
import {
  deleteOwnAccount,
  findAccountDeletionRefusal,
} from "@/lib/customers/account-deletion";

/**
 * DELETE /me: the shopper deletes their own account (App Store 5.1.1(v),
 * Google Play).
 *
 * The same rules as Better Auth's /api/auth/delete-user, which the account
 * page uses, in the same order: the password, or else a sign-in from the
 * last ten minutes; then the account's own refusals
 * (lib/customers/account-deletion.ts); then the delete and its cleanup. It
 * cannot call that endpoint itself: a handler never sees the request's
 * cookie.
 */
export const deleteAccountRoute = defineRoute({
  id: "me.delete",
  method: "DELETE",
  path: "/me",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "auth:delete-account", preset: "strict" },
  demo: "block-mutations",
  // A DELETE often goes without a body: no body is no password.
  input: DeleteAccountRequest.optional(),
  output: AccountDeleted,
  reasons: { values: ME_REASONS },
  handler: async ({ input, session, client, requestId, locale }) => {
    const userId = session.user.id;
    const password = input?.password;

    if (password) {
      const check = await verifyOwnPassword(userId, password);
      if (check === "not_set") {
        throw new MobileApiError(
          400,
          "VALIDATION_ERROR",
          "This account has no password. Sign in again, then delete it within ten minutes.",
          { reason: "PASSWORD_NOT_SET", errors: { password: ["This account has no password."] } },
        );
      }
      if (check === "incorrect") {
        throw new MobileApiError(400, "VALIDATION_ERROR", "The password is incorrect.", {
          reason: "PASSWORD_INCORRECT",
          errors: { password: ["The password is incorrect."] },
        });
      }
    } else if (!isRecentSignIn(session.signedInAt)) {
      throw new MobileApiError(403, "AUTHORIZATION_ERROR", RECENT_SIGN_IN_MESSAGE, {
        reason: "RECENT_SIGN_IN_REQUIRED",
      });
    }

    const refusal = await findAccountDeletionRefusal(userId);
    if (refusal?.reason === "DEMO_MODE") {
      throw new MobileApiError(403, "DEMO_MODE_READ_ONLY", refusal.message);
    }
    if (refusal) {
      throw new MobileApiError(403, "AUTHORIZATION_ERROR", refusal.message, {
        reason: "NOT_A_CUSTOMER",
      });
    }

    await deleteOwnAccount(
      userId,
      shopAppAuditContext({ session, client, requestId, locale, method: "DELETE", path: "/me" }),
    );
    return { deleted: true as const };
  },
});
