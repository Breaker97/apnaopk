/**
 * What a shopper typed into the one "email or mobile phone number" field.
 *
 * Shopify accepts both in a single field and does not publish how it tells
 * them apart; an "@" is the cheap, predictable rule, and it is the only branch
 * point in the whole contact step. The checkout writes the result into the
 * form's own `email` and `contactPhone`, so everything downstream sees the two
 * fields it always has — this is only the rule, in one place, so the server
 * can decide the same way the browser did rather than trusting it to say.
 */
type ContactChannel = "email" | "phone";

export function contactChannelOf(value: unknown): ContactChannel | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.includes("@") ? "email" : "phone";
}
