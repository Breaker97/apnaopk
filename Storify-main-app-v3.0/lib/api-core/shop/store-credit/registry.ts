import type { RouteEntry } from "@/lib/api-core/registry";
import { myStoreCreditHistoryRoute, myStoreCreditRoute } from "./routes";

/** The shopper's store credit: the balance and its history. */
export const storeCreditRoutes: readonly RouteEntry[] = [
  myStoreCreditRoute,
  myStoreCreditHistoryRoute,
];
