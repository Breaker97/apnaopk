import { CategoryTree } from "@/contracts/mobile/shop/v1/catalog";
import { defineRoute } from "@/lib/api-core/registry";
import { getStorefrontCategories } from "@/lib/storefront/storefront-categories";
import { toCategory } from "./summaries";

/**
 * GET /categories: the active category tree (three levels at most), in the
 * store's order. Static: expired by the categories and products tags.
 */
export const categoryTreeRoute = defineRoute({
  id: "catalog.categories.tree",
  method: "GET",
  path: "/categories",
  auth: "none",
  cache: { kind: "static", revalidate: 60 },
  output: CategoryTree,
  handler: async () => {
    const { categories } = await getStorefrontCategories();
    return { items: categories.map(toCategory) };
  },
});
