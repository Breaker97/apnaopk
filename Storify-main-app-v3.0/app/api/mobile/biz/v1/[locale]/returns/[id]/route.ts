import { bizPrivateRoute } from "@/lib/api-next/routes";
import { returnDetailRoute } from "@/lib/api-core/biz/returns/routes";
export const GET = bizPrivateRoute(returnDetailRoute);
