import type { BizRouteEntry } from "@/lib/api-core/registry";
import { orderActionRoute } from "./action";
import { orderDetailRoute } from "./detail";
import { orderListRoute } from "./list";

/**
 * Orders: the list and one order (B2), the workflow's actions (B3).
 *
 * One module per endpoint in this folder, each exporting its `defineBizRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const ordersRoutes: readonly BizRouteEntry[] = [
  orderListRoute,
  orderDetailRoute,
  orderActionRoute,
];
