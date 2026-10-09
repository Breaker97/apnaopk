import type { RouteEntry } from "@/lib/api-core/registry";
import {
  createReturnRoute,
  myReturnRoute,
  myReturnsRoute,
  returnOptionsRoute,
  returnPreviewRoute,
} from "./routes";

/**
 * The shopper's returns: an order's options, a priced preview, the
 * submission, and the returns they have. Unlike the other folders the five
 * share one module (routes.ts): they share the order lookup, the selection
 * checks and the wording, and each route file imports its entry from it.
 */
export const returnsRoutes: readonly RouteEntry[] = [
  returnOptionsRoute,
  returnPreviewRoute,
  createReturnRoute,
  myReturnsRoute,
  myReturnRoute,
];
