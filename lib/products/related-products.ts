import {
  getStorefrontProductCards,
  type StorefrontProductCard,
} from "@/lib/products/storefront-product-cards";

const RELATED_PRODUCTS_LIMIT = 12;

/**
 * What a product page suggests next to a product: the newest other products
 * of its category. None for a product without a category. The web's related
 * rail and the app's product page both read it here.
 */
export async function getRelatedProductCards(
  productId: string,
  categoryId: string | undefined,
): Promise<StorefrontProductCard[]> {
  if (!categoryId) return [];
  const products = await getStorefrontProductCards({
    categoryIds: [categoryId],
    excludeIds: [productId],
    limit: RELATED_PRODUCTS_LIMIT,
    sortBy: "createdAt",
    sortOrder: "desc",
  });
  return products.slice(0, RELATED_PRODUCTS_LIMIT);
}
