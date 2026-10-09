import { ME_REASONS, Me, UpdateMeRequest } from "@/contracts/mobile/shop/v1/me";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { shopAppAuditContext } from "@/lib/api-core/shop/audit-context";
import { RECENT_SIGN_IN_MESSAGE } from "@/lib/auth/recent-sign-in";
import { updateOwnProfile } from "@/lib/customers/own-profile";
import { uploadUrls } from "@/lib/api-core/shop/reviews/dto";
import { readMe } from "./me";

/**
 * PATCH /me: the shopper changes their profile, through the same change the
 * website's account form makes (lib/customers/own-profile.ts). Refused on a
 * demo store, as the website's profile form is.
 *
 * The picture is `imageUploadId`: a photo the shopper uploaded (POST
 * /uploads), named by its id; `null` removes it.
 */
export const updateMeRoute = defineRoute({
  id: "me.update",
  method: "PATCH",
  path: "/me",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "account:profile", preset: "moderate" },
  demo: "block-mutations",
  reasons: { values: ME_REASONS },
  input: UpdateMeRequest,
  output: Me,
  handler: async ({ input, session, client, requestId, locale }) => {
    const image =
      input.imageUploadId === undefined
        ? undefined
        : input.imageUploadId === null
          ? ""
          : (await uploadUrls(session.user.id, [input.imageUploadId], "imageUploadId"))[0];
    const result = await updateOwnProfile(
      {
        userId: session.user.id,
        sessionId: session.sessionId,
        signedInAt: session.signedInAt,
        auditContext: shopAppAuditContext({
          session,
          client,
          requestId,
          locale,
          method: "PATCH",
          path: "/me",
        }),
      },
      {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
        ...(input.birthday !== undefined ? { birthday: input.birthday } : {}),
        ...(input.gender !== undefined ? { gender: input.gender } : {}),
        ...(image !== undefined ? { image } : {}),
      },
    );
    if (!result.ok) {
      switch (result.refusal) {
        case "NO_ACCOUNT":
          throw new MobileApiError(401, "AUTHENTICATION_ERROR", "Sign in to continue.");
        case "EMAIL_CHANGE_NOT_ALLOWED":
          throw new MobileApiError(403, "AUTHORIZATION_ERROR", "The login email is not changed here.", {
            reason: "EMAIL_CHANGE_NOT_ALLOWED",
          });
        case "RECENT_SIGN_IN_REQUIRED":
          throw new MobileApiError(403, "AUTHORIZATION_ERROR", RECENT_SIGN_IN_MESSAGE, {
            reason: "RECENT_SIGN_IN_REQUIRED",
          });
        case "EMAIL_TAKEN":
          throw new MobileApiError(409, "CONFLICT", "Another account already uses this email.", {
            reason: "EMAIL_TAKEN",
            errors: { email: ["Another account already uses this email."] },
          });
      }
    }
    return readMe(session.user.id);
  },
});
