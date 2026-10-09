import { bizMeRoute } from "@/lib/api-core/biz/me/me";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const GET = bizPrivateRoute(bizMeRoute);
