import { deleteAddressRoute } from "@/lib/api-core/shop/addresses/delete-address";
import { updateAddressRoute } from "@/lib/api-core/shop/addresses/update-address";
import { privateRoute } from "@/lib/api-next/routes";

export const PATCH = privateRoute(updateAddressRoute);
export const DELETE = privateRoute(deleteAddressRoute);
