import type { BizRouteEntry } from "@/lib/api-core/registry";
import { bizUploadCreateRoute, bizUploadDetailRoute, bizUploadAccessRoute } from "./routes";

export const uploadsRoutes: readonly BizRouteEntry[] = [bizUploadCreateRoute, bizUploadDetailRoute, bizUploadAccessRoute];
