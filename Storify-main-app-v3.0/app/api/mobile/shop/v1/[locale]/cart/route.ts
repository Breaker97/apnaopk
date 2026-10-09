import { getCartRoute } from "@/lib/api-core/shop/cart/get-cart";
import { privateRoute } from "@/lib/api-next/routes";

export const GET = privateRoute(getCartRoute);
