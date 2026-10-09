import type { BizRouteEntry } from "@/lib/api-core/registry";
import { bizConfigRoute } from "./config";

/** The store as the business app reads it before sign-in. */
export const configRoutes: readonly BizRouteEntry[] = [bizConfigRoute];
