import type { RouteEntry } from "@/lib/api-core/registry";
import { addAddressRoute } from "./add-address";
import { deleteAddressRoute } from "./delete-address";
import { listAddressesRoute } from "./list-addresses";
import { setDefaultAddressRoute } from "./set-default-address";
import { updateAddressRoute } from "./update-address";

/**
 * The shopper's saved addresses.
 *
 * One module per endpoint in this folder, each exporting its `defineRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const addressesRoutes: readonly RouteEntry[] = [
  listAddressesRoute,
  addAddressRoute,
  updateAddressRoute,
  deleteAddressRoute,
  setDefaultAddressRoute,
];
