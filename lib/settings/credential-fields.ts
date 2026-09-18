/**
 * Registry of every settings field whose stored value is a credential.
 *
 * The admin API never returns these values. `sanitizeSettings` strips each one
 * and publishes a masked preview instead (`_meta.credentials[path]`), so the
 * admin UI can confirm *which* value is stored without ever receiving it.
 * Shared by the server (sanitize + save) and the client (settings tabs), so
 * this module must stay free of server-only imports.
 */

export interface CredentialFieldMeta {
  /** A non-empty value is stored in the database. */
  set: boolean;
  /** Masked preview of the stored value; absent in demo mode. */
  hint?: string;
}

export type CredentialMetaMap = Record<string, CredentialFieldMeta>;

/**
 * Dot-paths of credential fields, grouped by the settings section that owns
 * them. Identifiers (publishable keys, client IDs, wallet IDs…) are included
 * alongside outright secrets: they are still account-identifying values that
 * should not sit in plain sight on an admin screen.
 */
export const CREDENTIAL_FIELD_PATHS: readonly string[] = [
  // Payments
  "payment.stripe.publishableKey",
  "payment.stripe.secretKey",
  "payment.stripe.webhookSecret",
  "payment.paypal.clientId",
  "payment.paypal.clientSecret",
  "payment.paypal.webhookId",
  "payment.razorpay.keyId",
  "payment.razorpay.keySecret",
  "payment.razorpay.webhookSecret",
  "payment.paystack.publicKey",
  "payment.paystack.secretKey",
  "payment.pesapal.consumerKey",
  "payment.pesapal.consumerSecret",
  "payment.pesapal.ipnId",
  "payment.iotec.clientId",
  "payment.iotec.clientSecret",
  "payment.iotec.walletId",
  // `country` and `mode` are deliberately absent: they are routing config, not
  // account-identifying values, and stripping them would blank the admin form.
  "payment.orange_money.clientId",
  "payment.orange_money.clientSecret",
  "payment.orange_money.merchantKey",
  // `targetEnvironment` and `mode` stay visible for the same reason as
  // Orange's `country`/`mode`: routing config, not account-identifying values.
  "payment.mtn_momo.subscriptionKey",
  "payment.mtn_momo.apiUser",
  "payment.mtn_momo.apiKey",
  // OAuth / social login
  "security.googleClientId",
  "security.googleClientSecret",
  "security.facebookAppId",
  "security.facebookAppSecret",
  // Shipping carriers. The Shiprocket email is an account identifier and the
  // cached login token is a live bearer credential, so both are masked
  // alongside the outright secrets.
  "shipping.carriers.shippo.testToken",
  "shipping.carriers.shippo.liveToken",
  "shipping.carriers.shippo.webhookSecret",
  // The hash is server-side comparison material, not something the browser has
  // any use for — and stripping it also stops the client echoing it back on a
  // save and overwriting the real one.
  "shipping.carriers.shippo.webhookSecretHash",
  "shipping.carriers.shiprocket.email",
  "shipping.carriers.shiprocket.password",
  "shipping.carriers.shiprocket.webhookToken",
  "shipping.carriers.shiprocket.tokenCache.token",
  // Object storage — one block per provider, so the inactive provider's keys
  // are masked too (they are still stored, just not in use).
  "storage.r2.accountId",
  "storage.r2.accessKeyId",
  "storage.r2.secretAccessKey",
  "storage.s3.accessKeyId",
  "storage.s3.secretAccessKey",
  "storage.minio.accessKeyId",
  "storage.minio.secretAccessKey",
  "storage.digitalocean.accessKeyId",
  "storage.digitalocean.secretAccessKey",
  // Deprecated pre-v1.5 flat fields. Listed so an un-migrated document still
  // has its secrets stripped from the admin payload — dropping these paths
  // would leak them until the migration runs.
  "storage.accountId",
  "storage.accessKeyId",
  "storage.secretAccessKey",
  // Email delivery
  "email.smtp.password",
  "email.apiKey",
  // SMS (Twilio). The Messaging Service SID and the From number stay visible:
  // they are routing config, and the number is printed on every text anyway.
  "sms.twilio.accountSid",
  "sms.twilio.authToken",
  // Analytics. Only the Plausible API key is here: it is a real secret. The
  // four tracking IDs are not — `/api/settings/public` serves them in full to
  // every visitor, because the storefront cannot inject a tag it has not been
  // given. Masking them from the admin who owns them protected nothing and cost
  // them the ability to read back what they had configured.
  "analytics.plausibleApiKey",
  // AI authoring
  "aiAuthoring.apiKey",
];

/**
 * Credential paths that are safe to echo back on save as an empty string. The
 * save handler drops these when blank so an untouched form never clears a
 * stored credential (the field renders empty by design — its value lives only
 * in the masked hint).
 */
export function credentialPathsForSection(section: string): string[] {
  const prefix = `${section}.`;
  return CREDENTIAL_FIELD_PATHS.filter((path) => path.startsWith(prefix)).map(
    (path) => path.slice(prefix.length),
  );
}

function walk(
  target: Record<string, unknown>,
  path: string,
): { parent: Record<string, unknown>; key: string } | null {
  const keys = path.split(".");
  const key = keys.pop();
  if (!key) return null;

  let current: unknown = target;
  for (const segment of keys) {
    if (typeof current !== "object" || current === null) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  if (typeof current !== "object" || current === null) return null;
  return { parent: current as Record<string, unknown>, key };
}

/** Read a dot-path value, or undefined when any segment is missing. */
export function readCredentialPath(
  target: Record<string, unknown>,
  path: string,
): unknown {
  const found = walk(target, path);
  return found ? found.parent[found.key] : undefined;
}

/** Delete a dot-path value in place; a no-op when the path is absent. */
export function setCredentialPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const found = walk(target, path);
  if (found) found.parent[found.key] = value;
}

export function deleteCredentialPath(
  target: Record<string, unknown>,
  path: string,
): void {
  const found = walk(target, path);
  if (found) delete found.parent[found.key];
}

/**
 * Classify a gateway key as test or live from its own prefix. Computed on the
 * server because the raw key never reaches the browser.
 */
/**
 * Replaces every credential value under `target` with `marker`, by path.
 *
 * The audit trail redacts by key-name heuristics ("password", "secret" …),
 * which is how MTN's `subscriptionKey`, Orange's `merchantKey` and Pesapal's
 * `consumerKey` reached audit rows in clear. This walks the declared paths
 * instead, so what counts as a credential is decided in one place. Pass the
 * section when `target` is one section's data rather than the whole document.
 */
export function redactCredentialPaths(
  target: Record<string, unknown>,
  section?: string,
  marker = "[REDACTED]",
): Record<string, unknown> {
  const paths = section ? credentialPathsForSection(section) : CREDENTIAL_FIELD_PATHS;
  for (const path of paths) {
    const found = walk(target, path);
    if (!found) continue;
    const value = found.parent[found.key];
    if (value !== undefined && value !== null && value !== "") {
      found.parent[found.key] = marker;
    }
  }
  return target;
}

export function detectKeyMode(
  value: unknown,
): "test" | "live" | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const key = value.toLowerCase();
  if (key.includes("test")) return "test";
  if (key.includes("live")) return "live";
  return undefined;
}
