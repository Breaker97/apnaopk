/**
 * Comparing products side by side: the website's /compare page.
 *
 * The website keeps the comparison in its address (`/compare?products=a,b,c`,
 * slugs in column order), so the same comparison is shareable and reload-proof.
 * The app does the same: `GET /compare` takes that query, and a link to the
 * website's page opens the app's screen with the same products. What a shopper
 * has picked while browsing is kept on the phone and only ever sent here.
 *
 * The server decides, the app displays. Which products make the comparison and
 * how their specifications line up into rows arrive as they are.
 */
import * as z from "zod";

import { ProductCard } from "./catalog";

/**
 * The most products a comparison holds, the website's four columns. A longer
 * list is cut to its first four, on the server and on the website alike.
 */
export const COMPARE_MAX_PRODUCTS = 4;

/**
 * GET /compare. `products` are slugs, in the order of the columns; sent as one
 * comma-separated value, as the website's address has them. Repeated slugs
 * count once, and one that no longer names a product is left out of the answer.
 */
export const CompareQuery = z.object({
  products: z.array(z.string()).optional(),
});
export type CompareQuery = z.infer<typeof CompareQuery>;

/**
 * One line of the specification table: a specification's name and what each
 * product says about it.
 */
export const CompareRow = z.object({
  label: z.string(),
  /**
   * One value per entry of `items`, in the same order. Empty where that
   * product does not say: the app draws a dash, which is itself a result.
   */
  values: z.array(z.string()),
});
export type CompareRow = z.infer<typeof CompareRow>;

/** GET /compare */
export const ProductComparison = z.object({
  /**
   * The products, in the order asked for. A card carries the picture, the
   * name, the price, the rating and the availability, and says whether the
   * product can be added to the cart or has to be opened first.
   */
  items: z.array(ProductCard),
  /**
   * The specification table. Its rows follow the first product's own
   * specification sheet, then those the other products add; names that differ
   * only in case are one row. Empty when no product has a specification.
   */
  rows: z.array(CompareRow),
});
export type ProductComparison = z.infer<typeof ProductComparison>;
