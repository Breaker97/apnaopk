import { orderListRoute } from "@/lib/api-core/shop/orders/list";
import { privateRoute } from "@/lib/api-next/routes";

export const GET = privateRoute(orderListRoute);
