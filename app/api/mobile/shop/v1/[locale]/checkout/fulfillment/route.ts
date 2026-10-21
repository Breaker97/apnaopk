import { checkoutFulfillmentRoute } from "@/lib/api-core/shop/checkout/fulfillment";
import { privateRoute } from "@/lib/api-next/routes";

export const GET = privateRoute(checkoutFulfillmentRoute);
