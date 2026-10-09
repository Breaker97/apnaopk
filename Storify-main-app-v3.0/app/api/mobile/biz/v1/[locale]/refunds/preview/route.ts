import { bizPrivateRoute } from "@/lib/api-next/routes";
import { refundPreviewRoute } from "@/lib/api-core/biz/returns/routes";
export const POST = bizPrivateRoute(refundPreviewRoute);
