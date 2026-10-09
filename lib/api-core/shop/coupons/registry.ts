import type { RouteEntry } from "@/lib/api-core/registry";
import { couponListRoute } from "./list";

/**
 * The shopper's coupon sheet.
 *
 * One module per endpoint in this folder, each exporting its `defineRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const couponsRoutes: readonly RouteEntry[] = [couponListRoute];
