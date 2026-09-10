/**
 * Server-side enforcement of the admin's password rules.
 *
 * Admin -> Settings -> Security exposes minimum length plus uppercase, number,
 * and special-character requirements. Better Auth only understands the length,
 * so without this module the three complexity switches were stored, rendered
 * as enabled, and enforced nowhere — a merchant could turn all three on and
 * still have `password123` accepted.
 *
 * Every password entry point runs `assertPasswordPolicy`: sign-up and
 * change-password (intercepted in the Better Auth catch-all route) and the
 * custom reset-password route.
 */

export const MIN_ALLOWED_PASSWORD_LENGTH = 8;
export const MAX_ALLOWED_PASSWORD_LENGTH = 128;

export type PasswordPolicy = {
  minPasswordLength: number;
  requireUppercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
};

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minPasswordLength: MIN_ALLOWED_PASSWORD_LENGTH,
  requireUppercase: false,
  requireNumbers: false,
  requireSpecialChars: false,
};

/**
 * Clamps the admin-supplied minimum into a sane range. The settings API accepts
 * any number, so without the floor a `minPasswordLength: 1` save would let the
 * whole store sign up with single-character passwords.
 */
export function normalizePasswordPolicy(
  security:
    | {
        minPasswordLength?: unknown;
        requireUppercase?: unknown;
        requireNumbers?: unknown;
        requireSpecialChars?: unknown;
      }
    | undefined
    | null,
): PasswordPolicy {
  const raw = Number(security?.minPasswordLength);
  const minPasswordLength = Number.isFinite(raw)
    ? Math.min(
        MAX_ALLOWED_PASSWORD_LENGTH,
        Math.max(MIN_ALLOWED_PASSWORD_LENGTH, Math.floor(raw)),
      )
    : MIN_ALLOWED_PASSWORD_LENGTH;

  return {
    minPasswordLength,
    requireUppercase: Boolean(security?.requireUppercase),
    requireNumbers: Boolean(security?.requireNumbers),
    requireSpecialChars: Boolean(security?.requireSpecialChars),
  };
}

/** Human-readable reason the password was rejected, or null when it passes. */
export function checkPasswordPolicy(
  password: string,
  policy: PasswordPolicy,
): string | null {
  if (typeof password !== "string" || !password) {
    return "Password is required.";
  }
  if (password.length < policy.minPasswordLength) {
    return `Password must be at least ${policy.minPasswordLength} characters.`;
  }
  if (password.length > MAX_ALLOWED_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_ALLOWED_PASSWORD_LENGTH} characters.`;
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    return "Password must include at least one uppercase letter.";
  }
  if (policy.requireNumbers && !/[0-9]/.test(password)) {
    return "Password must include at least one number.";
  }
  if (policy.requireSpecialChars && !/[^A-Za-z0-9]/.test(password)) {
    return "Password must include at least one special character.";
  }
  return null;
}

/** Describes the active policy for UI hints and error context. */
export function describePasswordPolicy(policy: PasswordPolicy): string {
  const parts = [`at least ${policy.minPasswordLength} characters`];
  if (policy.requireUppercase) parts.push("one uppercase letter");
  if (policy.requireNumbers) parts.push("one number");
  if (policy.requireSpecialChars) parts.push("one special character");
  return parts.join(", ");
}
