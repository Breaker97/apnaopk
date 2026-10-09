import { bizPrivateRoute } from "@/lib/api-next/routes";
import { returnActionRoute } from "@/lib/api-core/biz/returns/routes";
export const POST = bizPrivateRoute(returnActionRoute);
