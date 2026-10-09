import { vendorApplicationDetailRoute } from "@/lib/api-core/biz/vendor-applications/detail";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const GET = bizPrivateRoute(vendorApplicationDetailRoute);
