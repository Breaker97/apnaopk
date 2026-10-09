import { orderPayRoute } from "@/lib/api-core/shop/orders/pay";
import { privateRoute } from "@/lib/api-next/routes";

export const POST = privateRoute(orderPayRoute);
