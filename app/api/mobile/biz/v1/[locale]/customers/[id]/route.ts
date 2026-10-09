import { customerDetailRoute } from "@/lib/api-core/biz/customers/routes";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const GET = bizPrivateRoute(customerDetailRoute);
