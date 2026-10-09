import { setDefaultAddressRoute } from "@/lib/api-core/shop/addresses/set-default-address";
import { privateRoute } from "@/lib/api-next/routes";

export const PUT = privateRoute(setDefaultAddressRoute);
