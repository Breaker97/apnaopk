import { setCartLineRoute } from "@/lib/api-core/shop/cart/set-cart-line";
import { privateRoute } from "@/lib/api-next/routes";

export const PUT = privateRoute(setCartLineRoute);
