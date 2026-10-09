import type { Address, AddressBook } from "@/contracts/mobile/shop/v1/addresses";
import { MobileApiError } from "@/lib/api-core/errors";
import {
  AddressNotFoundError,
  readAddressesWithIds,
} from "@/lib/customers/address-book";
import type { IdentifiableAddress } from "@/lib/customers/saved-addresses";

/**
 * The address book as the contract sends it. Every address has an id: one
 * saved before addresses had ids is given one the first time the app sees it
 * (`readAddressesWithIds`). Saved addresses hold no coordinates, and none are
 * sent.
 */

const OPTIONAL_FIELDS = ["firstName", "lastName", "apartment", "state", "postalCode", "phone"] as const;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toAppAddress(raw: IdentifiableAddress): Address {
  const address: Address = {
    id: String(raw._id),
    label: text(raw.label) || "home",
    street: text(raw.street),
    city: text(raw.city),
    country: text(raw.country),
    isDefault: raw.isDefault === true,
  };
  for (const field of OPTIONAL_FIELDS) {
    const value = text(raw[field]);
    if (value) address[field] = value;
  }
  return address;
}

/**
 * The book after a change. A change answers the stored book as written; when
 * an address in it predates ids, it is read again with every id in place.
 */
export async function toAddressBook(
  userId: string,
  addresses: IdentifiableAddress[] | null | undefined,
): Promise<AddressBook> {
  const book = addresses ?? [];
  const complete = book.every((address) => address?._id != null)
    ? book
    : await readAddressesWithIds(userId);
  return { items: complete.map(toAppAddress) };
}

/** Runs an address change; an id that names no address is a 404. */
export async function withAddressFound<T>(change: () => Promise<T>): Promise<T> {
  try {
    return await change();
  } catch (error) {
    if (error instanceof AddressNotFoundError) {
      throw new MobileApiError(404, "NOT_FOUND", "There is no such address.");
    }
    throw error;
  }
}

/**
 * The stored address as a request would send it, for a partial change to be
 * laid over. A label outside today's three is left out, so the stored one is
 * kept rather than refused.
 */
export function storedAddressFields(existing: IdentifiableAddress): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const field of ["street", "city", "country", ...OPTIONAL_FIELDS] as const) {
    const value = text(existing[field]);
    if (value) fields[field] = value;
  }
  if (["home", "work", "other"].includes(text(existing.label))) fields.label = text(existing.label);
  if (typeof existing.isDefault === "boolean") fields.isDefault = existing.isDefault;
  return fields;
}
