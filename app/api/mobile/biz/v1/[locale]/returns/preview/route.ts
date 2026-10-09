import { bizPrivateRoute } from "@/lib/api-next/routes";
import { returnPreviewRoute } from "@/lib/api-core/biz/returns/routes";
export const POST = bizPrivateRoute(returnPreviewRoute);
