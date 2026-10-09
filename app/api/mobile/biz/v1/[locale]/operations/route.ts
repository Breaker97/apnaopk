import { operationStatusRoute } from "@/lib/api-core/biz/operations/status";
import { bizPrivateRoute } from "@/lib/api-next/routes";
export const GET = bizPrivateRoute(operationStatusRoute);
