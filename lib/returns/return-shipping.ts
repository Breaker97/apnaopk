/**
 * How a returned parcel gets back: the rules the approval, the shopper's order
 * page and the emails all read.
 *
 * An approved return used to tell the shopper only that it was approved.
 * Nothing said where the parcel should go or how, so every return became an
 * email thread, and a label the model had a field for was never set or shown.
 * Shopify asks the merchant at approval: a label, the shopper's own postage,
 * or nothing to send back at all. So do we.
 *
 * Kept free of server imports: the return card renders the instructions and
 * builds its label link in the browser.
 */

/** How the goods come back, chosen when the return is approved. */
export const RETURN_METHODS = [
  /** The store hands the shopper a label: an uploaded file or a link. */
  "label",
  /** The shopper posts it themselves and adds the tracking number. */
  "customer_ships",
  /** Nothing comes back, as with a cheap or broken item the store writes off. */
  "no_shipping",
] as const;

export type ReturnMethod = (typeof RETURN_METHODS)[number];

export function isReturnMethod(value: unknown): value is ReturnMethod {
  return (RETURN_METHODS as readonly string[]).includes(String(value));
}

/**
 * The method a return is handled by. One approved before the question was
 * asked was always the shopper's to post, which is what it reads as.
 */
export function returnMethodOf(value: unknown): ReturnMethod {
  return isReturnMethod(value) ? value : "customer_ships";
}

/**
 * The states in which the parcel is still the shopper's to send: how it comes
 * back may be set or changed, and a tracking number may be added. Past these
 * it has arrived, or the return is over.
 */
export const RETURN_SHIPPING_OPEN_STATUSES = [
  "approved",
  "awaiting_shipment",
  "in_transit",
] as const;

/** Where the store may still change how the parcel comes back: before it is posted. */
export const RETURN_METHOD_CHANGEABLE_STATUSES = [
  "approved",
  "awaiting_shipment",
] as const;

/** Where a label may still be uploaded: from the request until the parcel is posted. */
export const RETURN_LABEL_UPLOAD_STATUSES = [
  "requested",
  "approved",
  "awaiting_shipment",
] as const;

// ---------------------------------------------------------------- label files

/**
 * A label carries the shopper's name and address, so it is kept in PRIVATE
 * storage like an expense receipt, and opened only through the return's own
 * label routes.
 */
export const RETURN_LABEL_KEY_PREFIX = "return-labels/";

/** A carrier's PDF, or a photo or screenshot of one. */
export const RETURN_LABEL_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
] as const;

export const RETURN_LABEL_ACCEPT = RETURN_LABEL_MIME_TYPES.join(",");

export const RETURN_LABEL_MAX_SIZE_MB = 10;

const SAFE_KEY_SEGMENT = /^[a-zA-Z0-9._-]+$/;

/**
 * A private-storage key minted by the label upload. The segment check keeps
 * the label routes scoped: vendor identity documents and digital products live
 * in the same private store, and "." or ".." segments would climb out of the
 * prefix on the local provider.
 */
export function isReturnLabelKey(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (!value.startsWith(RETURN_LABEL_KEY_PREFIX)) return false;
  if (value.length > 512) return false;
  return value
    .split("/")
    .every(
      (segment) =>
        SAFE_KEY_SEGMENT.test(segment) && segment !== "." && segment !== "..",
    );
}

/** A label link a shopper may be sent to: an http(s) address, nothing else. */
export function isReturnLabelUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim() || value.length > 1000) {
    return false;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

// --------------------------------------------------------------- instructions

export const RETURN_INSTRUCTIONS_MAX_LENGTH = 2000;

/**
 * What the shopper is told when the store has written nothing of its own.
 * `{returnNumber}` is filled in; the address is shown above it.
 */
export const DEFAULT_RETURN_INSTRUCTIONS =
  "Pack the items securely with everything they came with, and write {returnNumber} on the parcel. Send it to the address above, then add the tracking number on your order page.";

/**
 * The same, for a guest: their order page is the public tracking page, which
 * has nowhere to add a tracking number, so the store records it instead.
 */
export const DEFAULT_GUEST_RETURN_INSTRUCTIONS =
  "Pack the items securely with everything they came with, and write {returnNumber} on the parcel. Send it to the address above, and keep the tracking number until your refund arrives.";

/** The store's own instructions, or undefined when it has written none. */
export function customReturnInstructions(
  settings:
    | { orders?: { returns?: { instructions?: string | null } | null } | null }
    | null
    | undefined,
): string | undefined {
  const text = String(settings?.orders?.returns?.instructions || "").trim();
  return text ? text.slice(0, RETURN_INSTRUCTIONS_MAX_LENGTH) : undefined;
}

/** Instructions with `{returnNumber}` and `{address}` filled in. */
export function renderReturnInstructions(
  template: string,
  values: { returnNumber?: string | null; address?: string | null },
): string {
  return template
    .replace(/\{returnNumber\}/g, String(values.returnNumber || ""))
    .replace(/\{address\}/g, String(values.address || ""))
    .trim();
}

// -------------------------------------------------------------------- address

/** Where a parcel goes, as a return stores it. */
export interface ReturnDestination {
  locationId?: unknown;
  name?: string | null;
  address?: string | null;
}

/** The destination on one line: the place, then its address. */
export function describeReturnDestination(
  destination: ReturnDestination | null | undefined,
): string {
  const name = String(destination?.name || "").trim();
  const address = String(destination?.address || "").trim();
  if (name && address) return `${name}, ${address}`;
  return name || address;
}
