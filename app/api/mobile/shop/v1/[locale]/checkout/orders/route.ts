import { placeOrderRoute } from "@/lib/api-core/shop/checkout/place-order";
import { privateRoute } from "@/lib/api-next/routes";

export const POST = privateRoute(placeOrderRoute);
