import type { BizRouteEntry } from "@/lib/api-core/registry";
import { vendorApplicationDecideRoute } from "./decide";
import { vendorApplicationDetailRoute } from "./detail";
import { vendorApplicationListRoute } from "./list";

/**
 * Sellers' applications (session B6).
 *
 * One module per endpoint in this folder, each exporting its `defineBizRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const vendorApplicationsRoutes: readonly BizRouteEntry[] = [
  vendorApplicationListRoute,
  vendorApplicationDetailRoute,
  vendorApplicationDecideRoute,
];
