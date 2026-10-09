import { addAddressRoute } from "@/lib/api-core/shop/addresses/add-address";
import { listAddressesRoute } from "@/lib/api-core/shop/addresses/list-addresses";
import { privateRoute } from "@/lib/api-next/routes";

export const GET = privateRoute(listAddressesRoute);
export const POST = privateRoute(addAddressRoute);
