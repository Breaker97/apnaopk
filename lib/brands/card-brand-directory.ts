import "server-only";

import { getStorefrontBrands } from "@/lib/brands/storefront-brands";
import type { CardBrand } from "@/lib/products/product-card-config";

/**
 * Every storefront brand, by id, for the product card's Brand element.
 *
 * Cards carry only the brand's id: product cards come from a dozen loaders
 * (section rails, the infinite grid, collection shelves, the sponsored lane,
 * search), and populating the brand on each would be a dozen places to keep
 * in step. One cached directory mounted with the card configuration answers
 * all of them, and a store whose card shows no Brand element never reads it.
 */
export async function getCardBrandDirectory(): Promise<Record<string, CardBrand>> {
  try {
    const { brands } = await getStorefrontBrands({ all: true });
    return Object.fromEntries(
      brands.map((brand) => [
        brand._id,
        { name: brand.name, slug: brand.slug, logo: brand.logo ?? "" },
      ]),
    );
  } catch {
    return {};
  }
}
