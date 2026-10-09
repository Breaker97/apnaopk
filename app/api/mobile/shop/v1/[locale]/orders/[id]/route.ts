import { orderDetailRoute } from "@/lib/api-core/shop/orders/detail";
import { privateRoute } from "@/lib/api-next/routes";

export const GET = privateRoute(orderDetailRoute);
