import { AddressBook } from "@/contracts/mobile/shop/v1/addresses";
import { defineRoute } from "@/lib/api-core/registry";
import { setDefaultAddress } from "@/lib/customers/address-book";
import { toAddressBook, withAddressFound } from "./app-address";

/** PUT /addresses/{id}/default: the one checkout fills itself from. */
export const setDefaultAddressRoute = defineRoute({
  id: "addresses.default",
  method: "PUT",
  path: "/addresses/{id}/default",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "addresses:write", preset: "moderate" },
  demo: "default",
  output: AddressBook,
  handler: async ({ params, session }) => {
    const addresses = await withAddressFound(() =>
      setDefaultAddress(session.user.id, { id: params.id }),
    );
    return toAddressBook(session.user.id, addresses);
  },
});
