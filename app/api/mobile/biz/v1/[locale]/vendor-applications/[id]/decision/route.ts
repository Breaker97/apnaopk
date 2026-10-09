import { vendorApplicationDecideRoute } from "@/lib/api-core/biz/vendor-applications/decide";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const POST = bizPrivateRoute(vendorApplicationDecideRoute);
