import { AddressBook } from "@/contracts/mobile/shop/v1/addresses";
import { defineRoute } from "@/lib/api-core/registry";
import {
  AddressNotFoundError,
  deleteAddress,
  readAddressesWithIds,
} from "@/lib/customers/address-book";
import { toAddressBook } from "./app-address";

/**
 * DELETE /addresses/{id}. Removing the default makes the first address left
 * the default. An address that is already gone answers the book as it is,
 * so a retry is harmless.
 */
export const deleteAddressRoute = defineRoute({
  id: "addresses.delete",
  method: "DELETE",
  path: "/addresses/{id}",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "addresses:write", preset: "moderate" },
  demo: "allow",
  output: AddressBook,
  handler: async ({ params, session }) => {
    const userId = session.user.id;
    try {
      return await toAddressBook(userId, await deleteAddress(userId, { id: params.id }));
    } catch (error) {
      if (!(error instanceof AddressNotFoundError)) throw error;
      return toAddressBook(userId, await readAddressesWithIds(userId));
    }
  },
});
