import "server-only";

import { connectDB } from "@/lib/db";
import { getSettings } from "@/models";
import { normalizeContentPagesSettings } from "@/lib/site-config/content-pages-config";
import { normalizeHeaderSettings } from "@/lib/site-config/header-config";
import { normalizeFooterSettings } from "@/lib/site-config/footer-config";
import { normalizeCheckoutSettings } from "@/lib/checkout/checkout-config";
import { resolveStoredProductCardConfig } from "@/lib/storefront/themes/product-card";
import { getCredentialEnvSources, maskSecretHint } from "@/lib/settings/credentials";
import { DEMO_MODE_MESSAGE, isDemoModeEnabled } from "@/lib/demo-mode";
import { resolveAuthBaseUrl } from "@/lib/auth/oauth-callback";
import { resolveCheckoutGatewayReadiness } from "@/lib/payments/checkout-gateways";
import {
  CREDENTIAL_FIELD_PATHS,
  deleteCredentialPath,
  detectKeyMode,
  readCredentialPath,
  type CredentialMetaMap,
} from "@/lib/settings/credential-fields";
import { SETTINGS_SECTION_KEYS } from "@/lib/settings/section-registry";
import { computeSectionVersions } from "@/lib/settings/section-versions";
import { isPlainObject } from "@/lib/utils";

/**
 * Strip credentials from a Settings document and attach the `_meta` block the
 * admin UI relies on (masked previews + "is set" flags, derived gateway key
 * modes, env-source hints, demo mode).
 *
 * Shared by the `GET /api/admin/settings` handler and the server-side settings
 * layout so both emit an identical payload — the layout can seed the client
 * store without a follow-up client fetch. Credential values never leave the
 * server: only presence flags and non-reversible masked previews are surfaced.
 */
export function sanitizeSettings(settings: unknown): Record<string, unknown> {
  if (typeof settings !== "object" || settings === null) return {};
  // Demo instances ship a publicly known admin login, so masked previews of
  // real secrets must never be served there — only the boolean "set" flags.
  const revealHints = !isDemoModeEnabled();
  const secretHint = (value: unknown): string | undefined =>
    revealHints ? maskSecretHint(value as string) : undefined;
  const doc = settings as {
    toObject?: (options?: { flattenMaps?: boolean }) => Record<string, unknown>;
  } & Record<string, unknown>;
  // Maps flattened to plain objects: a Mongoose Map serialises to `{}`, so a
  // map setting (minimum payout by currency) came back empty, and the next
  // save of the form wrote that emptiness over what was stored.
  const safe = doc.toObject ? doc.toObject({ flattenMaps: true }) : { ...doc };
  // Every section the admin can write is an object on the wire; the
  // registry is the one list of them.
  const objectSections = SETTINGS_SECTION_KEYS;

  // Old/corrupted records may contain null for sections that the UI expects as objects.
  for (const section of objectSections) {
    if (!isPlainObject(safe[section])) {
      safe[section] = {};
    }
  }
  safe.header = normalizeHeaderSettings(safe.header);
  safe.footer = normalizeFooterSettings(safe.footer);
  safe.checkout = normalizeCheckoutSettings(safe.checkout);
  safe.productCard = resolveStoredProductCardConfig(
    safe.productCard,
    (safe.onlineStore as { activeTheme?: unknown } | undefined)?.activeTheme,
  );
  safe.contentPages = normalizeContentPagesSettings(safe.contentPages);

  // Every credential is replaced by a masked preview keyed on its dot-path, so
  // the admin UI can confirm which value is stored without receiving it.
  const credentials: CredentialMetaMap = {};
  for (const path of CREDENTIAL_FIELD_PATHS) {
    const value = readCredentialPath(safe, path);
    const isSet = typeof value === "string" && value.trim() !== "";
    const hint = isSet ? secretHint(value) : undefined;
    credentials[path] = hint ? { set: true, hint } : { set: isSet };
  }

  // Test/live is derived from the key prefix here because the raw gateway keys
  // are stripped below and never reach the browser.
  const keyModes = {
    stripe: detectKeyMode(readCredentialPath(safe, "payment.stripe.publishableKey")),
    razorpay: detectKeyMode(readCredentialPath(safe, "payment.razorpay.keyId")),
    paystack: detectKeyMode(readCredentialPath(safe, "payment.paystack.publicKey")),
  };
  // Read before the secrets go, for the same reason: the payment screen can
  // then say exactly what keeps a switched-on gateway off the checkout.
  const checkoutGateways = resolveCheckoutGatewayReadiness(
    safe as Parameters<typeof resolveCheckoutGatewayReadiness>[0],
  );

  for (const path of CREDENTIAL_FIELD_PATHS) {
    deleteCredentialPath(safe, path);
  }

  const security = safe.security;
  if (isPlainObject(security)) {
    delete security.smtpVerificationFingerprint;
  }

  safe._meta = {
    credentials,
    keyModes,
    checkoutGateways,
    // What the form will hand back on save so a stale copy is refused
    // (lib/settings/section-versions.ts). Computed after the secrets are
    // stripped, so the fingerprint is of exactly what the browser sees.
    sectionVersions: computeSectionVersions(safe, objectSections),
    demoMode: {
      enabled: isDemoModeEnabled(),
      message: DEMO_MODE_MESSAGE,
    },
    // Per-field flags reporting whether a `.env` fallback value is present.
    // Drives the read-only "Set via environment" hint in the admin UI.
    envSources: getCredentialEnvSources(),
    // The origin Better Auth builds its OAuth redirect URIs from. The browser
    // cannot derive it (BETTER_AUTH_URL is server-only, and the admin may be on
    // a different host than the configured one), so the OAuth settings screen
    // prints the callback URL from this rather than from window.location.
    authBaseUrl: resolveAuthBaseUrl(),
  };
  return safe;
}

/**
 * Server-side settings loader for the admin settings layout. Returns the exact
 * same sanitized shape the client would otherwise fetch from
 * `GET /api/admin/settings`, JSON-normalized (Dates → ISO strings, ObjectIds →
 * strings) so it is safe to pass as a Server → Client component prop.
 *
 * Returns null on any failure so the client store can fall back to its own
 * fetch instead of rendering an error.
 */
export async function getSanitizedSettings(): Promise<Record<
  string,
  unknown
> | null> {
  try {
    await connectDB();
    const settings = await getSettings();
    return JSON.parse(JSON.stringify(sanitizeSettings(settings))) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}
