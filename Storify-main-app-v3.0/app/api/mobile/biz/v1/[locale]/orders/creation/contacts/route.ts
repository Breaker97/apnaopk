import { orderContactCreateRoute } from "@/lib/api-core/biz/order-creation/contacts";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const POST = bizPrivateRoute(orderContactCreateRoute);
