import { Me } from "@/contracts/mobile/shop/v1/me";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { readAccountProfile } from "@/lib/customers/account-profile";
import { absoluteUrl } from "../absolute-url";
import { imageSet } from "../images";

/** The shopper as `Me`, read fresh (a change shows at once). GET and PATCH /me answer it. */
export async function readMe(userId: string): Promise<Me> {
  const profile = await readAccountProfile(userId);
  // Deleted between the session check and here.
  if (!profile) throw new MobileApiError(401, "AUTHENTICATION_ERROR", "Sign in to continue.");
  // An avatar stored as a path on the store's own address, made absolute.
  const imageUrl = absoluteUrl(profile.image);
  const image = imageSet(profile.image, profile.name);
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    emailVerified: profile.emailVerified,
    ...(imageUrl ? { imageUrl } : {}),
    ...(image ? { image } : {}),
    ...(profile.phone ? { phone: profile.phone } : {}),
    ...(profile.birthday ? { birthday: profile.birthday } : {}),
    ...(profile.gender ? { gender: profile.gender } : {}),
  };
}

/** GET /me: the signed-in shopper. */
export const meRoute = defineRoute({
  id: "me.get",
  method: "GET",
  path: "/me",
  auth: "user",
  cache: { kind: "private" },
  output: Me,
  handler: async ({ session }) => readMe(session.user.id),
});
