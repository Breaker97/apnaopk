import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import { getSettingsLean } from "@/models/settings.model";
import { resolveOAuthCredentials } from "@/lib/settings/credentials";
import { isCurrentSmtpConfigurationVerified } from "@/lib/email/smtp-verification";

/**
 * Server-side flags for the login/register pages and the storefront's account
 * drawer, mirroring the same rules as /api/settings/public: a provider shows
 * only when the admin toggle is on AND usable credentials resolve (DB wins,
 * .env is the fallback — matches lib/auth.ts). Rendering these on the server
 * means the OAuth buttons appear in the initial HTML instead of popping in
 * after a client fetch. (The demo card's accounts come from
 * `demoLoginCredentials`.)
 *
 * Cached under the settings tag like every other storefront settings reader.
 * The store layout calls this on every storefront request, and the plain lean
 * read it used to do was the only uncached query left on a warm page — one
 * database round trip per page view, for four booleans that change when an
 * admin saves settings (which revalidates the tag).
 */
const loadAuthPageFlags = unstable_cache(
  async () => {
    await connectDB();
    const settings = await getSettingsLean();
    const oauth = resolveOAuthCredentials(settings.security);
    const googleOAuthEnabled =
      Boolean(settings.security?.googleOAuthEnabled) &&
      Boolean(oauth.google.clientId && oauth.google.clientSecret);

    return {
      googleOAuthEnabled,
      // Public: Google shows it in every sign-in URL. The shopper app hands it
      // to the phone's Google SDK (GET /config, `auth.google`). The secret is
      // never part of these flags.
      googleClientId: googleOAuthEnabled ? oauth.google.clientId || null : null,
      facebookOAuthEnabled:
        Boolean(settings.security?.facebookOAuthEnabled) &&
        Boolean(oauth.facebook.appId && oauth.facebook.appSecret),
      emailVerificationRequired:
        Boolean(settings.security?.emailVerificationRequired) &&
        isCurrentSmtpConfigurationVerified(settings),
    };
  },
  ["auth-page-settings"],
  { revalidate: 60, tags: [CACHE_TAGS.settings] },
);

export async function getAuthPageSettings() {
  return loadAuthPageFlags();
}
