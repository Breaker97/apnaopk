/**
 * Startup validation for the Better Auth signing secret.
 *
 * Better Auth only hard-fails on its own sentinel string, so any other value —
 * including the placeholder shipped in `.env.example` — is accepted with a
 * console warning nobody reads. That matters more here than in a normal app:
 * Storify is distributed as source, so a placeholder left unchanged is a secret
 * every other buyer already has, and forged session, OAuth-state, and
 * trust-device cookies follow.
 *
 * Production therefore refuses to boot on a weak secret; development only
 * warns, so a fresh clone still runs before the buyer has written a `.env`.
 */

const MIN_SECRET_LENGTH = 32;

/** Placeholders from our own docs plus the ones people reach for by reflex. */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  "your-secret-here",
  "your-secret",
  "secret",
  "changeme",
  "change-me",
  "please-change-me",
  "better-auth-secret",
  "better-auth-secret-12345678901234567890",
  "storify",
  "test",
  "development",
  "production",
]);

type AuthSecretProblem =
  | { kind: "missing" }
  | { kind: "placeholder"; value: string }
  | { kind: "too-short"; length: number };

export function findAuthSecretProblem(
  secret: string | undefined,
): AuthSecretProblem | null {
  const value = (secret || "").trim();
  if (!value) return { kind: "missing" };
  if (KNOWN_PLACEHOLDER_SECRETS.has(value.toLowerCase())) {
    return { kind: "placeholder", value };
  }
  if (value.length < MIN_SECRET_LENGTH) {
    return { kind: "too-short", length: value.length };
  }
  return null;
}

export function describeAuthSecretProblem(problem: AuthSecretProblem): string {
  const fix =
    "Set BETTER_AUTH_SECRET in your environment to a unique random value: openssl rand -base64 32";

  switch (problem.kind) {
    case "missing":
      return `BETTER_AUTH_SECRET is not set. ${fix}`;
    case "placeholder":
      return `BETTER_AUTH_SECRET is still the example placeholder ("${problem.value}"). Anyone with a copy of this codebase could forge sessions. ${fix}`;
    case "too-short":
      return `BETTER_AUTH_SECRET is only ${problem.length} characters; at least ${MIN_SECRET_LENGTH} are required. ${fix}`;
  }
}

/**
 * Throws in production, warns elsewhere. Called once while the auth instance is
 * built, so a misconfigured production deploy fails on its first auth request
 * rather than silently signing cookies with a public key.
 */
export function assertAuthSecret(
  secret: string | undefined = process.env.BETTER_AUTH_SECRET ||
    process.env.AUTH_SECRET,
  isProduction: boolean = process.env.NODE_ENV === "production",
): void {
  const problem = findAuthSecretProblem(secret);
  if (!problem) return;

  const message = describeAuthSecretProblem(problem);
  if (isProduction) {
    throw new Error(`[storify] Insecure auth configuration: ${message}`);
  }
  console.warn(`[storify] ${message}`);
}
