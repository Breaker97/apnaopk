import { manualOrderCreateRoute } from "@/lib/api-core/biz/order-creation/create";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const POST = bizPrivateRoute(manualOrderCreateRoute);
