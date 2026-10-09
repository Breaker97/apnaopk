import { ProductDetail } from "@/contracts/mobile/biz/v1/products";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import type { BizScope } from "@/lib/api-core/biz/scope";
import { defineBizRoute } from "@/lib/api-core/registry";
import { toProductDetail } from "./dto";
import { findScopedProduct, locationViewOf, productDtoContext } from "./load";

/** The product as the app shows it, read fresh: also the answer to a change. */
export async function readProductDetail(id: string, scope: BizScope): Promise<ProductDetail> {
  const [ctx, product] = await Promise.all([
    productDtoContext(scope),
    findScopedProduct(id, scope, { vendorName: true }),
  ]);
  return toProductDetail(product, ctx, await locationViewOf(product, scope));
}

/**
 * GET /products/{id}: prices, status, pictures, variants and where the units
 * are, with the `version` a change names in `If-Match` (also the `ETag`).
 */
export const productDetailRoute = defineBizRoute({
  id: "products.detail",
  method: "GET",
  path: "/products/{id}",
  auth: "user",
  ...BIZ_ACCESS.VIEW_PRODUCTS,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:products:read", preset: "lenient" },
  output: ProductDetail,
  entityTag: (product) => product.version,
  handler: async ({ params, scope }) => readProductDetail(params.id, scope),
});
