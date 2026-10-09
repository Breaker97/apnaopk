import { stockMovementsRoute } from "@/lib/api-core/biz/products/stock-movements";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const GET = bizPrivateRoute(stockMovementsRoute);
