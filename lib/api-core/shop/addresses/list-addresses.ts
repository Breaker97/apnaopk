import { AddressBook } from "@/contracts/mobile/shop/v1/addresses";
import { defineRoute } from "@/lib/api-core/registry";
import { readAddressesWithIds } from "@/lib/customers/address-book";
import { toAddressBook } from "./app-address";

/** GET /addresses: the shopper's address book. */
export const listAddressesRoute = defineRoute({
  id: "addresses.list",
  method: "GET",
  path: "/addresses",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "addresses:list", preset: "lenient" },
  output: AddressBook,
  handler: async ({ session }) =>
    toAddressBook(session.user.id, await readAddressesWithIds(session.user.id)),
});
