import type { BizRouteEntry } from "@/lib/api-core/registry";
import { productDetailRoute } from "./detail";
import { productFiltersRoute } from "./filters";
import { productListRoute } from "./list";
import { productStockRoute } from "./stock";
import { stockAdjustmentRoute } from "./stock-adjustment";
import { stockMovementsRoute } from "./stock-movements";
import { productUpdateRoute } from "./update";
import { productEditorRoutes } from "./editor-routes";

/**
 * Products and their stock (session B4).
 *
 * One module per endpoint in this folder, each exporting its `defineBizRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const productsRoutes: readonly BizRouteEntry[] = [
  productListRoute,
  productFiltersRoute,
  productDetailRoute,
  productUpdateRoute,
  productStockRoute,
  stockAdjustmentRoute,
  stockMovementsRoute,
  ...productEditorRoutes,
];
