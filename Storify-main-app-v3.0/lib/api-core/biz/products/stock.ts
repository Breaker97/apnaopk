import { ProductStock } from "@/contracts/mobile/biz/v1/products";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import type { BizScope } from "@/lib/api-core/biz/scope";
import { defineBizRoute } from "@/lib/api-core/registry";
import { LOW_STOCK_THRESHOLD } from "@/lib/inventory/low-stock";
import { attachStockBreakdown } from "@/lib/inventory/stock-breakdown";
import { productTracksStock } from "@/lib/products/stock-policy";
import { locationsOf, variantCaption, type ProductDocument } from "./dto";
import { findScopedProduct, locationViewOf } from "./load";

/**
 * A product's stock as the inventory screens count it
 * (lib/inventory/stock-breakdown.ts): available, committed, unavailable and
 * on hand, per variant (or for the product itself), with the available units
 * at each location this operator may see. Also the answer to an adjustment.
 */
export async function readProductStock(id: string, scope: BizScope): Promise<ProductStock> {
  const product = await findScopedProduct(id, scope);
  const view = await locationViewOf(product, scope);
  const productId = String(product._id);
  const tracksStock = productTracksStock(product);
  const variants = product.variants ?? [];

  type Row = {
    productId: string;
    variantId: string | null;
    stock: number;
    tracksStock: boolean;
    name: string;
    sku?: string | null;
    at: NonNullable<ProductDocument["locationInventory"]>;
  };
  const rows: Row[] = variants.length
    ? variants.map((variant) => ({
        productId,
        variantId: String(variant._id),
        stock: Number(variant.stock ?? 0),
        tracksStock,
        name: variantCaption(variant, product),
        sku: variant.sku,
        at: variant.locationInventory ?? [],
      }))
    : [
        {
          productId,
          variantId: null,
          stock: Number(product.stock ?? 0),
          tracksStock,
          name: product.name ?? "",
          sku: product.sku,
          at: product.locationInventory ?? [],
        },
      ];

  const counted = await attachStockBreakdown(rows);
  return {
    productId,
    untracked: !tracksStock,
    lowStockThreshold: LOW_STOCK_THRESHOLD,
    rows: counted.map((row) => ({
      ...(row.variantId ? { variantId: row.variantId } : {}),
      name: row.name,
      ...(row.sku ? { sku: row.sku } : {}),
      available: row.available,
      committed: row.committed,
      unavailable: row.unavailable,
      onHand: row.onHand,
      locations: locationsOf(row.at, view),
    })),
  };
}

/** GET /products/{id}/stock. */
export const productStockRoute = defineBizRoute({
  id: "products.stock",
  method: "GET",
  path: "/products/{id}/stock",
  auth: "user",
  ...BIZ_ACCESS.VIEW_STOCK,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:inventory:read", preset: "lenient" },
  output: ProductStock,
  handler: async ({ params, scope }) => readProductStock(params.id, scope),
});
