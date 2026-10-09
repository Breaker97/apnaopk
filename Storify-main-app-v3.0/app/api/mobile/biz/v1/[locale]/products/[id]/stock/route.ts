import { productStockRoute } from "@/lib/api-core/biz/products/stock";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const GET = bizPrivateRoute(productStockRoute);
