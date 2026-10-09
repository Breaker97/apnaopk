import { productDetailRoute } from "@/lib/api-core/biz/products/detail";
import { productUpdateRoute } from "@/lib/api-core/biz/products/update";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const GET = bizPrivateRoute(productDetailRoute);
export const PATCH = bizPrivateRoute(productUpdateRoute);
