/**
 * How a pre-order's release date is written, everywhere it is written.
 *
 * The date is picked as a calendar day and stored as midnight UTC. Formatted
 * in the viewer's own zone, a shopper west of UTC read the day before — "Ships
 * Sep 30" for an Oct 1 release — and the card authorisation the server stored
 * named Oct 1 while the checkbox the shopper ticked said Sep 30. Read in UTC it
 * is the same day for everyone, on every surface, and on the server.
 *
 * `year: "auto"` prints the year only when it is not this one, for tight
 * spots like a product card: "Jan 5" for a release next January reads as one
 * three months ago. "This one" is `now`'s year: a component passes the
 * render's clock (useRenderNow), so a cached page hydrates to the text it
 * was drawn with.
 *
 * Free of server imports: product cards, the cart, checkout and the mandate
 * text built on both sides all share it.
 */
export function formatPreorderReleaseDate(
  value: unknown,
  options: { locale?: string; year?: "always" | "auto"; now?: number } = {},
): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const showYear =
    options.year !== "auto" ||
    date.getUTCFullYear() !== new Date(options.now ?? Date.now()).getUTCFullYear();
  return new Intl.DateTimeFormat(options.locale, {
    month: "short",
    day: "numeric",
    ...(showYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(date);
}
