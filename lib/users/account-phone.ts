/**
 * An account's own phone number, as a person types it: digits, optionally a
 * leading "+", with spaces, dashes, dots or brackets between them — at least
 * five digits, at most twenty.
 *
 * Client-safe: the account form checks it before saving, the API refuses
 * anything else, and a value that was stored before the check (an email in
 * the phone field, say) reads back as empty rather than as a phone.
 */

const PHONE_SHAPE = /^\+?[\d\s().-]+$/;

/** The number trimmed, or "" when nothing was typed. */
export function trimAccountPhone(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Whether a non-empty value reads as a phone number. */
export function isAccountPhone(value: string): boolean {
  if (!PHONE_SHAPE.test(value)) return false;
  const digits = value.replace(/\D/g, "").length;
  return digits >= 5 && digits <= 20;
}

/**
 * A stored phone as the account form should show it: the number, or "" for
 * anything that is not one.
 */
export function readableAccountPhone(value: unknown): string {
  const phone = trimAccountPhone(value);
  return phone && isAccountPhone(phone) ? phone : "";
}
