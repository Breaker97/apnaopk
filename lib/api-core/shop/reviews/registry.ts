import type { RouteEntry } from "@/lib/api-core/registry";
import { createReviewRoute } from "./create";
import { myReviewsRoute, waitingReviewsRoute } from "./mine";
import { updateReviewRoute } from "./update";

/**
 * The shopper's own reviews: writing, listing, changing, and what waits for one.
 *
 * One module per endpoint in this folder, each exporting its `defineRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const reviewsRoutes: readonly RouteEntry[] = [
  createReviewRoute,
  myReviewsRoute,
  waitingReviewsRoute,
  updateReviewRoute,
];
