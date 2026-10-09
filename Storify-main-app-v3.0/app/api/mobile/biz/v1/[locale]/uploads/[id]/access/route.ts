import { bizUploadAccessRoute } from "@/lib/api-core/biz/uploads/routes";
import { bizPrivateRoute } from "@/lib/api-next/routes";
export const GET = bizPrivateRoute(bizUploadAccessRoute);
