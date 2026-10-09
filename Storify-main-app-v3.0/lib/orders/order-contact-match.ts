/**
 * Whether what a guest typed to find an order — an email address or a phone
 * number — is one the order was placed with. The public order tracker and the
 * sales assistant's order lookup both ask; the assistant had its own copy,
 * which compared digits alone, so a "phone" with no digits in it matched any
 * order with no phone on it.
 */

/** Fewer digits than this identify nobody. */
const MIN_PHONE_DIGITS = 7;

const digitsOf = (value: string) => value.replace(/\D+/g, "");

export function orderContactMatches(
  typed: string | null | undefined,
  known: {
    emails: Array<string | null | undefined>;
    phones: Array<string | null | undefined>;
  },
): boolean {
  const value = typed?.trim() ?? "";
  if (!value) return false;
  if (value.includes("@")) {
    const email = value.toLowerCase();
    return known.emails.some(
      (candidate) => candidate?.trim().toLowerCase() === email,
    );
  }
  const digits = digitsOf(value);
  if (digits.length < MIN_PHONE_DIGITS) return false;
  return known.phones.some(
    (candidate) => Boolean(candidate) && digitsOf(candidate!) === digits,
  );
}
