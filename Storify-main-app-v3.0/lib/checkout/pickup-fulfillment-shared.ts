/** Client-safe pickup fulfillment primitives. Keep this module free of DB imports. */
export type CheckoutFulfillmentMethod = "delivery" | "pickup";

/**
 * A pickup's booked window, when the order has one.
 *
 * Only orders placed through the old slot-booking system carry `startAt`/
 * `endAt`. Everything since is collected during opening hours and has no window
 * at all, so absence is the normal case and must render as nothing.
 *
 * Three copies of this formatter existed, and two of them took the two dates as
 * required strings — so an order without a window formatted `new Date(undefined)`
 * and printed the literal text "undefined – undefined" on the customer's own
 * order page.
 */
export function formatPickupWindow(
  /** Omit to follow the runtime's own locale, as the tracking page does. */
  locale: string | undefined,
  pickup:
    | { startAt?: string | Date; endAt?: string | Date; timeZone?: string }
    | null
    | undefined,
): string | null {
  const startAt = pickup?.startAt;
  const endAt = pickup?.endAt;
  if (!startAt || !endAt) return null;

  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  try {
    const timeZone = pickup?.timeZone || undefined;
    const dateFormat = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    });
    const timeFormat = new Intl.DateTimeFormat(locale, {
      timeStyle: "short",
      timeZone,
    });
    return `${dateFormat.format(start)} – ${timeFormat.format(end)}`;
  } catch {
    // An unusable stored time zone must not take the page down with it.
    return `${start.toISOString()} – ${end.toISOString()}`;
  }
}

/**
 * Whether the shopper still has a pickup choice to make before they can pay.
 *
 * Choosing the branch is the whole selection — collection happens during that
 * branch's opening hours, so there is no time to pick and nothing to hold.
 */
export function requiresPickupSelection(input: {
  method: CheckoutFulfillmentMethod;
  locationId?: string | null;
}): boolean {
  return input.method === "pickup" && !input.locationId?.trim();
}
