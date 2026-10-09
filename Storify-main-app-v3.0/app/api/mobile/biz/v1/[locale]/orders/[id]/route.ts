import { orderDetailRoute } from "@/lib/api-core/biz/orders/detail";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const GET = bizPrivateRoute(orderDetailRoute);
