import type { BizRouteEntry } from "@/lib/api-core/registry";
import { returnQueueRoute, returnDetailRoute, returnOptionsRoute, returnPreviewRoute, returnCreateRoute, returnActionRoute, refundPreviewRoute, refundExecuteRoute, refundDetailRoute, returnEvidenceRoute, returnLabelRoute } from "./routes";
export const returnsRoutes: readonly BizRouteEntry[] = [returnQueueRoute, returnDetailRoute, returnOptionsRoute, returnPreviewRoute, returnCreateRoute, returnActionRoute, refundPreviewRoute, refundExecuteRoute, refundDetailRoute, returnEvidenceRoute, returnLabelRoute];
