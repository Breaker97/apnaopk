import type { BizRouteEntry } from "@/lib/api-core/registry";
import { operationStatusRoute } from "./status";

export const operationsRoutes: readonly BizRouteEntry[] = [operationStatusRoute];
