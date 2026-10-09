import { bizPrivateRoute } from "@/lib/api-next/routes";
import { refundDetailRoute } from "@/lib/api-core/biz/returns/routes";
export const GET = bizPrivateRoute(refundDetailRoute);
