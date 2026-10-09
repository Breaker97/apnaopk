import { stockAdjustmentRoute } from "@/lib/api-core/biz/products/stock-adjustment";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const POST = bizPrivateRoute(stockAdjustmentRoute);
