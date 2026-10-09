import type { RouteEntry } from "@/lib/api-core/registry";
import { brandDetailRoute } from "./brand-detail";
import { brandListRoute } from "./brands";
import { categoryTreeRoute } from "./categories";
import { collectionDetailRoute } from "./collection-detail";
import { collectionListRoute } from "./collections";
import { compareRoute } from "./compare";
import { productDetailRoute } from "./product-detail";
import { productFacetsRoute } from "./product-facets";
import { productListRoute } from "./product-list";
import { productReviewsRoute } from "./product-reviews";
import { vendorDetailRoute } from "./vendor-detail";
import { vendorListRoute } from "./vendors";

/**
 * Categories, collections, brands, vendors, product lists, facets, the product page and its reviews, and the comparison.
 *
 * One module per endpoint in this folder, each exporting its `defineRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const catalogRoutes: readonly RouteEntry[] = [
  categoryTreeRoute,
  collectionListRoute,
  collectionDetailRoute,
  brandListRoute,
  brandDetailRoute,
  vendorListRoute,
  vendorDetailRoute,
  productListRoute,
  productFacetsRoute,
  productDetailRoute,
  productReviewsRoute,
  compareRoute,
];
