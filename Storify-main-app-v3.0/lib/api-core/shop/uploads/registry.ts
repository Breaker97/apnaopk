import type { RouteEntry } from "@/lib/api-core/registry";
import { uploadRoute } from "./create";

/**
 * The shopper's photo uploads.
 *
 * One module per endpoint in this folder, each exporting its `defineRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const uploadsRoutes: readonly RouteEntry[] = [uploadRoute];
