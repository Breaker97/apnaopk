/**
 * Address values are always rendered as plain text, never HTML. Reject markup
 * delimiters and control characters at the input boundary as well so malformed
 * values cannot be stored and later confuse fulfillment screens.
 */
const UNSAFE_ADDRESS_TEXT = /[<>\u0000-\u001F\u007F-\u009F]/u;

export function hasUnsafeAddressText(value: string): boolean {
  return UNSAFE_ADDRESS_TEXT.test(value);
}

export function isSafeAddressText(value: unknown): value is string {
  return typeof value === "string" && !hasUnsafeAddressText(value);
}
