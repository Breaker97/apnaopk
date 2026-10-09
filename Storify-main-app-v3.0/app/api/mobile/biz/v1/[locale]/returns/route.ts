import { bizPrivateRoute } from "@/lib/api-next/routes";
import { returnQueueRoute, returnCreateRoute } from "@/lib/api-core/biz/returns/routes";
export const GET = bizPrivateRoute(returnQueueRoute);
export const POST = bizPrivateRoute(returnCreateRoute);
