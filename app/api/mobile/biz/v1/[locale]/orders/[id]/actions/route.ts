import { orderActionRoute } from "@/lib/api-core/biz/orders/action";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const POST = bizPrivateRoute(orderActionRoute);
