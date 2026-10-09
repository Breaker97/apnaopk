import { orderCancelRoute } from "@/lib/api-core/shop/orders/cancel";
import { privateRoute } from "@/lib/api-next/routes";

export const POST = privateRoute(orderCancelRoute);
