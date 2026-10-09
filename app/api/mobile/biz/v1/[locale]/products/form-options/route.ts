import { productFormOptionsRoute } from "@/lib/api-core/biz/products/editor-routes";
import { bizPrivateRoute } from "@/lib/api-next/routes";
export const GET = bizPrivateRoute(productFormOptionsRoute);
