import { vendorApplicationListRoute } from "@/lib/api-core/biz/vendor-applications/list";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const GET = bizPrivateRoute(vendorApplicationListRoute);
