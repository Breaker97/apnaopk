import { inventoryRepairRoute } from "@/lib/api-core/biz/products/inventory-finance";
import { bizPrivateRoute } from "@/lib/api-next/routes";
export const POST = bizPrivateRoute(inventoryRepairRoute);
