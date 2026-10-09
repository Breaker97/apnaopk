import type { RouteEntry } from "@/lib/api-core/registry";
import { meSearchStartRoute, searchStartRoute } from "./start";

/**
 * The search start page, public and private halves.
 *
 * One module per endpoint in this folder, each exporting its `defineRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const searchRoutes: readonly RouteEntry[] = [searchStartRoute, meSearchStartRoute];
