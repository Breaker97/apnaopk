import type { Address, IOrder, IVendor, OrderItem } from "@/types";
import type { ISettings } from "@/models/settings.model";

export function completeAddress(
  address: Partial<Address> | undefined,
  fallbackName: string,
): Address {
  return {
    fullName:
      address?.fullName ||
      [address?.firstName, address?.lastName].filter(Boolean).join(" ") ||
      fallbackName,
    firstName: address?.firstName,
    lastName: address?.lastName,
    street: address?.street || "",
    apartment: address?.apartment,
    city: address?.city || "",
    state: address?.state || "",
    postalCode: address?.postalCode || "",
    country: address?.country || "",
    phone: address?.phone,
  };
}

/** Where a resolved ship-from address came from, for diagnostics and warnings. */
export type ShipFromSource =
  | "vendor_origin"
  | "vendor_address"
  | "store_origin"
  | "store_profile"
  | "none";

/** The postal half of an address — no name, no phone. */
type PostalFields = Pick<
  Address,
  "street" | "apartment" | "city" | "state" | "postalCode" | "country"
>;

type ShipFromVendor = Pick<IVendor, "storeName"> &
  Partial<Pick<IVendor, "address" | "shipping">>;

type ShipFromSettings = Pick<ISettings, "general"> &
  Partial<Pick<ISettings, "shipping">>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A source only counts when it names a country. Everything downstream —
 * carrier rating, customs, even the printed label — is meaningless without
 * one, and a half-filled source must not shadow a complete one further along
 * the chain.
 */
function usable(fields: PostalFields): PostalFields | null {
  return fields.country ? fields : null;
}

function fromShippingOrigin(origin: unknown): PostalFields | null {
  if (!origin || typeof origin !== "object") return null;
  const o = origin as Record<string, unknown>;
  return usable({
    street: text(o.address1),
    apartment: text(o.address2) || undefined,
    city: text(o.city),
    state: text(o.state),
    postalCode: text(o.postalCode),
    country: text(o.country),
  });
}

function fromVendorAddress(address: Address | undefined): PostalFields | null {
  if (!address) return null;
  return usable({
    street: text(address.street),
    apartment: text(address.apartment) || undefined,
    city: text(address.city),
    state: text(address.state),
    postalCode: text(address.postalCode),
    country: text(address.country),
  });
}

/**
 * The store profile's single free-text address blob. Last resort only: it has
 * no city/state/postcode/country of its own, so a carrier will reject it. It
 * exists so a store that has never opened Settings → Shipping still prints an
 * internal label with something on it.
 */
function fromStoreProfile(
  general: ISettings["general"] | undefined,
): PostalFields | null {
  const street = text(general?.storeAddress);
  if (!street) return null;
  return { street, city: "", state: "", postalCode: "", country: "" };
}

interface ResolvedShipFrom {
  address: Address;
  source: ShipFromSource;
  /** Fields a carrier requires that this address does not supply. */
  missing: Array<"street" | "city" | "state" | "postalCode" | "country" | "phone">;
}

/**
 * The address a parcel is dispatched from.
 *
 * One chain for both the admin and the vendor path, because in single-vendor
 * mode there is still exactly one sub-order pointing at the default vendor —
 * whose `shipping.origin` `syncDefaultVendorWithSettings` already mirrors from
 * `settings.shipping.origin`. Two separate resolvers only guaranteed the two
 * would drift, and the admin one drifted first: it built the whole address out
 * of `general.storeAddress`, leaving city, state, postcode and country empty,
 * which every carrier API rejects.
 *
 * The name and phone are resolved independently of the postal fields: neither
 * shipping origin shape carries them, so taking them from the same source
 * would mean losing them whenever the structured origin wins.
 */
export function resolveShipFrom(params: {
  vendor?: ShipFromVendor | null;
  settings?: ShipFromSettings | null;
}): ResolvedShipFrom {
  const { vendor, settings } = params;

  const candidates: Array<[ShipFromSource, PostalFields | null]> = [
    ["vendor_origin", fromShippingOrigin(vendor?.shipping?.origin)],
    ["vendor_address", fromVendorAddress(vendor?.address)],
    ["store_origin", fromShippingOrigin(settings?.shipping?.origin)],
    ["store_profile", fromStoreProfile(settings?.general)],
  ];

  const picked = candidates.find(([, fields]) => fields !== null);
  const source: ShipFromSource = picked ? picked[0] : "none";
  const fields: PostalFields = picked?.[1] ?? {
    street: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
  };

  const fallbackName =
    text(vendor?.storeName) || text(settings?.general?.storeName) || "Store";
  const phone =
    text(vendor?.address?.phone) || text(settings?.general?.storePhone);

  const address = completeAddress({ ...fields, phone: phone || undefined }, fallbackName);

  const missing: ResolvedShipFrom["missing"] = [];
  if (!address.street) missing.push("street");
  if (!address.city) missing.push("city");
  // State is not universally required (many countries have none), but every
  // carrier we support wants it for US/CA/IN destinations, so report it and
  // let the caller decide.
  if (!address.state) missing.push("state");
  if (!address.postalCode) missing.push("postalCode");
  if (!address.country) missing.push("country");
  if (!address.phone) missing.push("phone");

  return { address, source, missing };
}

/** `resolveShipFrom` without the diagnostics, for callers that only need the address. */
export function shipFromAddress(params: {
  vendor?: ShipFromVendor | null;
  settings?: ShipFromSettings | null;
}): Address {
  return resolveShipFrom(params).address;
}

export function shipmentItemsForOrder(
  order: Pick<IOrder, "items" | "subOrders">,
  vendorId?: string,
): OrderItem[] {
  if (!vendorId) return order.items || [];
  const subOrder = order.subOrders?.find(
    (entry) => String(entry.vendorId) === vendorId,
  );
  return subOrder?.items || [];
}
