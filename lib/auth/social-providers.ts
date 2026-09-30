import { resolveOAuthCredentials } from "@/lib/settings/credentials";

/** What Better Auth is handed for one OAuth provider. */
type SocialProviderConfig = {
  clientId: string;
  clientSecret: string;
  disableIdTokenSignIn: true;
};

/** The slice of the security settings that decides which providers are on. */
type SocialProviderSettings = {
  googleOAuthEnabled: boolean;
  googleClientId?: string;
  googleClientSecret?: string;
  facebookOAuthEnabled: boolean;
  facebookAppId?: string;
  facebookAppSecret?: string;
};

/**
 * The OAuth providers a store has switched on, in the shape Better Auth takes.
 *
 * Credentials come from two sources: DB settings win, .env is the per-field
 * fallback. The admin toggle is the single source of truth for whether a
 * provider is active — .env only supplies credentials, it never auto-enables
 * the provider (otherwise the admin could not disable it).
 *
 * Every provider signs in through the redirect flow and nothing else. Better
 * Auth also accepts a provider ID token posted straight to `/sign-in/social`,
 * and that door skips both checks the redirect flow goes through: the
 * customer-only rule in the session hook recognises the OAuth callback path
 * alone (`isOAuthCallbackPath`), and the two-factor challenge only runs on
 * credential sign-ins. An admin or vendor whose Google or Facebook account —
 * same email — fell into someone else's hands would be let in without their
 * second factor. The storefront never uses ID tokens. A native app that needs
 * them must first get the session hook to guard `/sign-in/social` too.
 */
export function buildSocialProviders(
  settings: SocialProviderSettings,
): Record<string, SocialProviderConfig> {
  const oauth = resolveOAuthCredentials(settings);
  const providers: Record<string, SocialProviderConfig> = {};

  if (
    oauth.google.clientId &&
    oauth.google.clientSecret &&
    settings.googleOAuthEnabled
  ) {
    providers.google = {
      clientId: oauth.google.clientId,
      clientSecret: oauth.google.clientSecret,
      disableIdTokenSignIn: true,
    };
  }

  if (
    oauth.facebook.appId &&
    oauth.facebook.appSecret &&
    settings.facebookOAuthEnabled
  ) {
    providers.facebook = {
      clientId: oauth.facebook.appId,
      clientSecret: oauth.facebook.appSecret,
      disableIdTokenSignIn: true,
    };
  }

  return providers;
}
