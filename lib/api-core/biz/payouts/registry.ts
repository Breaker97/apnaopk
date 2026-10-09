import type { BizRouteEntry } from "@/lib/api-core/registry";
import { payoutDetailRoute } from "./detail";
import { payoutListRoute } from "./list";
import { payoutSummaryRoute } from "./summary";

/**
 * A seller's balance and payouts (session B5): read only, in the vendor
 * workspace, with `VIEW_PAYOUTS`.
 *
 * One module per endpoint in this folder, each exporting its `defineBizRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const payoutsRoutes: readonly BizRouteEntry[] = [payoutSummaryRoute, payoutListRoute, payoutDetailRoute];
