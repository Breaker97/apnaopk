import type { BizRouteEntry } from "@/lib/api-core/registry";
import { configRoutes } from "./config/registry";
import { customersRoutes } from "./customers/registry";
import { devicesRoutes } from "./devices/registry";
import { homeRoutes } from "./home/registry";
import { inboxRoutes } from "./inbox/registry";
import { meRoutes } from "./me/registry";
import { notificationsRoutes } from "./notifications/registry";
import { ordersRoutes } from "./orders/registry";
import { orderCreationRoutes } from "./order-creation/registry";
import { payoutsRoutes } from "./payouts/registry";
import { productsRoutes } from "./products/registry";
import { returnsRoutes } from "./returns/registry";
import { uploadsRoutes } from "./uploads/registry";
import { operationsRoutes } from "./operations/registry";
import { vendorApplicationsRoutes } from "./vendor-applications/registry";

/**
 * Every endpoint of `/api/mobile/biz/v1/{locale}`, for the tests that hold
 * the policy (tests/mobile-api/biz-registry-policy.test.ts) and for anything
 * that lists the API. Route files never import this: each imports its own
 * entry, so a route's bundle carries its own handler and no other.
 *
 * Each domain's list is its session's own file (`./<domain>/registry.ts`);
 * this one changes only for a new domain.
 */
export const BIZ_V1_ROUTES: readonly BizRouteEntry[] = [
  ...configRoutes,
  ...meRoutes,
  ...homeRoutes,
  ...ordersRoutes,
  ...orderCreationRoutes,
  ...customersRoutes,
  ...productsRoutes,
  ...returnsRoutes,
  ...uploadsRoutes,
  ...operationsRoutes,
  ...inboxRoutes,
  ...payoutsRoutes,
  ...vendorApplicationsRoutes,
  ...notificationsRoutes,
  ...devicesRoutes,
];
