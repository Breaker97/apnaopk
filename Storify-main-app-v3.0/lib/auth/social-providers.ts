import { resolveOAuthCredentials } from "@/lib/settings/credentials";

/** What Better Auth is handed for one OAuth provider. */
type SocialProviderConfig = {
  clientId: string;
  clientSecret: string;
  /** Set: the provider signs in through the redirect flow only. */
  disableIdTokenSignIn?: true;
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
 * The storefront signs in through the redirect flow. Google also accepts an ID
 * token posted to `/sign-in/social`: the shopper app's native "Continue with
 * Google", where the phone's Google SDK signs the shopper in and hands the app
 * a token (the app gets the client ID from `GET /config`, `auth.google`).
 * Better Auth checks the token's signature against Google's keys, its issuer,
 * its age, and that its audience is `clientId`: the store's own web client.
 * The phone SDKs are given that same client ID (`webClientId` on Android,
 * `serverClientID` on iOS), so the token they issue names it as its audience;
 * a token Google issued to any other app is refused. The Android and iOS
 * OAuth clients only identify the app to Google and are never an audience.
 *
 * That door is guarded like the redirect flow: the session hook's
 * customer-only rule covers `/sign-in/social` too (`isOAuthCallbackPath`), so
 * an ID token opens a shopper's session and nothing else. An admin, vendor or
 * staff account is refused there, which is what keeps it from skipping its
 * second factor (the two-factor challenge only runs on credential sign-ins).
 * Facebook keeps the redirect flow only: the app has no Facebook sign-in, and
 * an unused door stays shut.
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
