import type { RouteEntry } from "@/lib/api-core/registry";
import { myQuotesRoute } from "./routes";

/** The shopper's quote requests. */
export const quotesRoutes: readonly RouteEntry[] = [myQuotesRoute];
