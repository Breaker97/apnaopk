import { removeCartLineRoute } from "@/lib/api-core/shop/cart/remove-cart-line";
import { privateRoute } from "@/lib/api-next/routes";

export const DELETE = privateRoute(removeCartLineRoute);
