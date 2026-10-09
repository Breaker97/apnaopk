import type { RouteEntry } from "@/lib/api-core/registry";
import { configRoute } from "./config";

/**
 * GET /config: what the app needs to know about the store before it shows anything.
 *
 * One module per endpoint in this folder, each exporting its `defineRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const configRoutes: readonly RouteEntry[] = [configRoute];
