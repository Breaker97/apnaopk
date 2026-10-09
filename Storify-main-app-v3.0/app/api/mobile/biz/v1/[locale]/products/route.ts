import { productListRoute } from "@/lib/api-core/biz/products/list";
import { productCreateRoute } from "@/lib/api-core/biz/products/editor-routes";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const GET = bizPrivateRoute(productListRoute);
export const POST = bizPrivateRoute(productCreateRoute);
