import { orderListRoute } from "@/lib/api-core/biz/orders/list";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const GET = bizPrivateRoute(orderListRoute);
