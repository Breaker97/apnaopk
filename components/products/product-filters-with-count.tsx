import { type ProductFiltersProps } from "@/components/products/product-filters";
import { ProductFiltersLazy } from "@/components/products/product-filters-lazy";
import {
  countGridResults,
  type GridResultQuery,
} from "@/components/products/grid-result-count";

/**
 * The classic filter panel, with the current result total resolved for it.
 * See `countGridResults` for why the query must be the grid's own and why
 * this is a server component of its own.
 */
interface ProductFiltersWithCountProps extends ProductFiltersProps {
  gridQuery: GridResultQuery;
}

export async function ProductFiltersWithCount({
  gridQuery,
  ...filterProps
}: ProductFiltersWithCountProps) {
  return (
    <ProductFiltersLazy
      {...filterProps}
      resultCount={await countGridResults(gridQuery)}
    />
  );
}
