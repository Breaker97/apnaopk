import { bizPrivateRoute } from "@/lib/api-next/routes";
import { returnOptionsRoute } from "@/lib/api-core/biz/returns/routes";
export const GET = bizPrivateRoute(returnOptionsRoute);
