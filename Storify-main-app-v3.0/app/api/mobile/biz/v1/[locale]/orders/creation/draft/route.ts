import { manualOrderDraftRoute } from "@/lib/api-core/biz/order-creation/registry";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const POST = bizPrivateRoute(manualOrderDraftRoute);
