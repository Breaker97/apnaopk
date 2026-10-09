import * as z from "zod";
import { Me, PICTURE_REASONS } from "@/contracts/mobile/biz/v1/me";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { bizAppAuditContext } from "@/lib/api-core/biz/audit-context";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineBizRoute, type BizHandlerContext } from "@/lib/api-core/registry";
import { updateOwnProfile } from "@/lib/customers/own-profile";
import {
  APP_UPLOAD_BODY_BYTES,
  ShopperUploadError,
  storeShopperUpload,
} from "@/lib/media-upload/shopper-uploads";
import { readBizMe } from "./me";

/** The form PUT /me/picture reads: one photo, in the field `file`. */
const PictureForm = z.object({ file: z.unknown() });

type AccountContext = BizHandlerContext<unknown, string, "account">;

/**
 * Sets the operator's own picture through the change the website's profile
 * form and the shopper app make (lib/customers/own-profile.ts), then answers
 * them as GET /me does. `""` removes it.
 */
async function setPicture(ctx: AccountContext, image: string, method: "PUT" | "DELETE") {
  const { session, client, requestId, locale } = ctx;
  const result = await updateOwnProfile(
    {
      userId: session.user.id,
      sessionId: session.sessionId,
      signedInAt: session.signedInAt,
      auditContext: bizAppAuditContext({ session, client, requestId, locale, method, path: "/me/picture" }),
    },
    { image },
  );
  // The account went between the session check and here.
  if (!result.ok) throw new MobileApiError(401, "AUTHENTICATION_ERROR", "Sign in to continue.");
  return readBizMe(ctx);
}

/**
 * PUT /me/picture: a new profile picture from a photo taken or chosen on the
 * phone, stored as the shopper app stores a profile photo (photos only, the
 * store's limits under the app's own ceiling) and set at once.
 */
export const bizMePictureUpdateRoute = defineBizRoute({
  id: "me.picture.update",
  method: "PUT",
  path: "/me/picture",
  auth: "user",
  ...BIZ_ACCESS.account,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:account:picture", preset: "moderate" },
  demo: "block-mutations",
  form: { maxBytes: APP_UPLOAD_BODY_BYTES, files: ["file"] },
  reasons: { values: PICTURE_REASONS },
  input: PictureForm,
  output: Me,
  handler: async (ctx) => {
    let url: string;
    try {
      url = (await storeShopperUpload(ctx.session.user.id, ctx.input.file)).url;
    } catch (error) {
      if (!(error instanceof ShopperUploadError)) throw error;
      throw new MobileApiError(error.reason === "UPLOAD_TOO_LARGE" ? 413 : 400, "VALIDATION_ERROR", error.message, {
        reason: error.reason,
        errors: { file: [error.message] },
      });
    }
    return setPicture(ctx, url, "PUT");
  },
});

/** DELETE /me/picture: no profile picture. */
export const bizMePictureRemoveRoute = defineBizRoute({
  id: "me.picture.remove",
  method: "DELETE",
  path: "/me/picture",
  auth: "user",
  ...BIZ_ACCESS.account,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:account:picture", preset: "moderate" },
  demo: "block-mutations",
  output: Me,
  handler: (ctx) => setPicture(ctx, "", "DELETE"),
});
