import { productFacetsRoute } from "@/lib/api-core/shop/catalog/product-facets";
import { publicGet } from "@/lib/api-next/routes";

export const GET = publicGet(productFacetsRoute);
