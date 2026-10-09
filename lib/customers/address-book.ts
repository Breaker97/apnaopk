import "server-only";

import { ObjectId } from "mongodb";
import type * as z from "zod";
import { connectDB, mongoose } from "@/lib/db";
import { ValidationError } from "@/lib/api/errors";
import type { AddressSchema } from "@/lib/validations";
import { getSettingsLean } from "@/models/settings.model";
import { isCountryAllowed } from "@/lib/intl/country-availability";
import {
  resolveAddressIndex,
  type IdentifiableAddress,
} from "@/lib/customers/saved-addresses";

/**
 * A shopper's address book (`User.addresses`): the one place it is read and
 * changed, for the web's account pages (app/api/user/addresses) and the
 * mobile API alike.
 *
 * Written through the raw driver, as it always was: the `user` collection is
 * better-auth's. That also means the sub-schema's `_id` default never runs,
 * so every new address is given its id here.
 *
 * Exactly one address is the default while the book is not empty: the first
 * one added, then whichever the shopper picks; removing the default promotes
 * the first that is left.
 */

type SavedAddressInput = z.infer<typeof AddressSchema>;

/** An address by id, or — for one saved before addresses had ids — by position. */
type AddressSelector = { id?: string; index?: number };

type UserAddressesDoc = { addresses?: IdentifiableAddress[] };

async function users() {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database not connected");
  return db.collection<UserAddressesDoc>("user");
}

async function assertCountryAvailable(country: string) {
  const settings = await getSettingsLean();
  if (!isCountryAllowed(country, settings.general?.countryAvailability)) {
    throw new ValidationError({
      "address.country": ["Selected country is not available"],
    });
  }
}

/**
 * The selector names no address in the book. Answered by the web exactly as
 * the 400 it always was; the mobile API tells it apart by its class.
 */
export class AddressNotFoundError extends ValidationError {
  constructor() {
    super({ index: ["Invalid address index"] });
  }
}

function invalidAddress(): ValidationError {
  return new AddressNotFoundError();
}

async function writeAddresses(userId: string, addresses: IdentifiableAddress[]) {
  await (await users()).updateOne({ _id: new ObjectId(userId) }, { $set: { addresses } });
}

/** The book as stored; `undefined` when the account has never had one. */
export async function readAddresses(userId: string): Promise<IdentifiableAddress[] | undefined> {
  const user = await (await users()).findOne(
    { _id: new ObjectId(userId) },
    { projection: { addresses: 1 } },
  );
  return user?.addresses;
}

/**
 * The book with an id on every address. An address saved before addresses
 * had ids is given one now and the book saved, unless it changed since it was
 * read (then it is answered as read; the next read tries again).
 */
export async function readAddressesWithIds(userId: string): Promise<IdentifiableAddress[]> {
  const addresses = (await readAddresses(userId)) ?? [];
  if (addresses.every((address) => address?._id != null)) return addresses;

  const withIds = addresses.map((address) =>
    address?._id != null ? address : { ...address, _id: new ObjectId() },
  );
  const result = await (await users()).updateOne(
    { _id: new ObjectId(userId), addresses },
    { $set: { addresses: withIds } },
  );
  return result.modifiedCount === 1 ? withIds : addresses;
}

/** Add an address; the first one, or one marked default, becomes the default. */
export async function addAddress(
  userId: string,
  address: SavedAddressInput,
): Promise<IdentifiableAddress[]> {
  await assertCountryAvailable(address.country);
  const currentAddresses = (await readAddresses(userId)) ?? [];

  const normalizedAddress = {
    ...address,
    // Minted here because these routes write through the raw driver, which
    // does not run the sub-schema's `_id` default. Without it a newly added
    // address would be index-only — the very state the id is meant to end.
    _id: new ObjectId(),
    label: address.label || "home",
    isDefault: Boolean(address.isDefault),
  };

  const addresses =
    currentAddresses.length === 0
      ? [{ ...normalizedAddress, isDefault: true }]
      : normalizedAddress.isDefault
        ? [...currentAddresses.map((a) => ({ ...a, isDefault: false })), normalizedAddress]
        : [...currentAddresses, { ...normalizedAddress, isDefault: false }];

  await writeAddresses(userId, addresses);
  return addresses;
}

/**
 * Change one address: the fields of `address` replace its own, the label
 * stays unless one is given. `address` may be worked out from the stored one
 * (a partial change); then the country is checked once it is known.
 */
export async function updateAddress(
  userId: string,
  selector: AddressSelector,
  address: SavedAddressInput | ((existing: IdentifiableAddress) => SavedAddressInput),
): Promise<IdentifiableAddress[]> {
  if (typeof address !== "function") await assertCountryAvailable(address.country);

  const addresses = ((await readAddresses(userId)) ?? []).map((a) => ({ ...a }));
  const index = resolveAddressIndex(addresses, selector);
  if (index === null) throw invalidAddress();

  const existing = addresses[index];
  const fields = typeof address === "function" ? address(existing) : address;
  if (typeof address === "function") await assertCountryAvailable(fields.country);
  const updated = {
    ...existing,
    ...fields,
    label: fields.label || existing.label || "home",
  };
  addresses[index] = updated;

  if (updated.isDefault) {
    for (let i = 0; i < addresses.length; i++) {
      addresses[i] = { ...addresses[i], isDefault: i === index };
    }
  }
  if (!addresses.some((a) => a.isDefault) && addresses.length > 0) {
    addresses[0] = { ...addresses[0], isDefault: true };
  }

  await writeAddresses(userId, addresses);
  return addresses;
}

/** Remove one address. `null` when the account has no book at all. */
export async function deleteAddress(
  userId: string,
  selector: AddressSelector,
): Promise<IdentifiableAddress[] | null> {
  const addresses = await readAddresses(userId);
  if (!addresses) return null;

  const index = resolveAddressIndex(addresses, selector);
  if (index === null) throw invalidAddress();

  const removedWasDefault = Boolean(addresses[index]?.isDefault);
  const updatedAddresses = addresses.filter((_, i) => i !== index);
  if (
    removedWasDefault &&
    updatedAddresses.length > 0 &&
    !updatedAddresses.some((a) => a?.isDefault)
  ) {
    updatedAddresses[0] = { ...updatedAddresses[0], isDefault: true };
  }

  await writeAddresses(userId, updatedAddresses);
  return updatedAddresses;
}

/**
 * Make one address the default. `null` when the account has no book at all.
 *
 * Setting a default by position was the most dangerous of the index-based
 * operations: it silently promotes whichever address moved into that slot,
 * and checkout then auto-fills it. Prefer the id.
 */
export async function setDefaultAddress(
  userId: string,
  selector: AddressSelector,
): Promise<IdentifiableAddress[] | null> {
  const addresses = await readAddresses(userId);
  if (!addresses) return null;

  const index = resolveAddressIndex(addresses, selector);
  if (index === null) throw invalidAddress();

  const updatedAddresses = addresses.map((address, i) => ({ ...address, isDefault: i === index }));
  await writeAddresses(userId, updatedAddresses);
  return updatedAddresses;
}
