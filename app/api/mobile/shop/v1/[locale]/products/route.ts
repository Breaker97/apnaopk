import { productListRoute } from "@/lib/api-core/shop/catalog/product-list";
import { publicGet } from "@/lib/api-next/routes";

export const GET = publicGet(productListRoute);
