import { AddressBook, AddressRequest } from "@/contracts/mobile/shop/v1/addresses";
import { parseInput } from "@/lib/api-core/input";
import { defineRoute } from "@/lib/api-core/registry";
import { addAddress } from "@/lib/customers/address-book";
import { AddressSchema } from "@/lib/validations";
import { toAddressBook } from "./app-address";

/**
 * POST /addresses: add one, under the web's rules (the store's address
 * fields and the countries it serves). The first address is the default.
 */
export const addAddressRoute = defineRoute({
  id: "addresses.add",
  method: "POST",
  path: "/addresses",
  auth: "user",
  cache: { kind: "private" },
  status: 201,
  rateLimit: { bucket: "addresses:write", preset: "moderate" },
  demo: "default",
  input: AddressRequest,
  output: AddressBook,
  handler: async ({ input, session }) => {
    const address = parseInput(AddressSchema, input) as ReturnType<typeof AddressSchema.parse>;
    return toAddressBook(session.user.id, await addAddress(session.user.id, address));
  },
});
