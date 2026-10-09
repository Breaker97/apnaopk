/**
 * The shopper's saved addresses: the address book checkout fills itself from.
 *
 * Every change answers with the whole book, which is short: the app replaces
 * what it shows in one go, default and all. There is always exactly one
 * default while the book is not empty.
 *
 * An address carries no map coordinates.
 */
import * as z from "zod";

export const Address = z.object({
  /** Names the address in PATCH, DELETE and PUT …/default. */
  id: z.string(),
  /** "home", "work" or "other" today; show another value as it is. */
  label: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  street: z.string(),
  apartment: z.string().optional(),
  city: z.string(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  /** As the store's country list writes it. */
  country: z.string(),
  phone: z.string().optional(),
  isDefault: z.boolean(),
});
export type Address = z.infer<typeof Address>;

/** GET /addresses, and the answer to every change. */
export const AddressBook = z.object({
  items: z.array(Address),
});
export type AddressBook = z.infer<typeof AddressBook>;

export const ADDRESS_LABELS = ["home", "work", "other"] as const;

/**
 * POST /addresses. The store decides which countries it serves and may ask
 * for more than this requires: a refusal names the field.
 */
export const AddressRequest = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  street: z.string().min(1).max(200),
  apartment: z.string().max(100).optional(),
  city: z.string().min(1).max(100),
  state: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().min(1).max(100),
  phone: z.string().max(50).optional(),
  label: z.enum(ADDRESS_LABELS).optional(),
  /** Make it the default. The first address always is. */
  isDefault: z.boolean().optional(),
});
export type AddressRequest = z.infer<typeof AddressRequest>;

/** PATCH /addresses/{id}: only the fields sent change. */
export const AddressUpdateRequest = AddressRequest.partial();
export type AddressUpdateRequest = z.infer<typeof AddressUpdateRequest>;
