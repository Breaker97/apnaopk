import type { BizRouteEntry } from "@/lib/api-core/registry";
import { homeRoute } from "./home";

/**
 * GET /home (session B2).
 *
 * One module per endpoint in this folder, each exporting its `defineBizRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const homeRoutes: readonly BizRouteEntry[] = [homeRoute];
