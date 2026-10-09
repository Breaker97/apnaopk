import { productFiltersRoute } from "@/lib/api-core/biz/products/filters";
import { bizPrivateRoute } from "@/lib/api-next/routes";
export const GET = bizPrivateRoute(productFiltersRoute);
