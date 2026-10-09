import { manualOrderCustomersRoute } from "@/lib/api-core/biz/order-creation/registry";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const GET = bizPrivateRoute(manualOrderCustomersRoute);
