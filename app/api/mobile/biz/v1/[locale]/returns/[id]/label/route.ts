import { bizPrivateRoute } from "@/lib/api-next/routes";
import { returnLabelRoute } from "@/lib/api-core/biz/returns/routes";
export const GET = bizPrivateRoute(returnLabelRoute);
