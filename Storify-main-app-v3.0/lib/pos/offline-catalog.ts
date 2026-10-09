import { normalizeLookupCode } from "@/lib/catalog/barcodes";
import {
  matchesPOSStockStatus,
  type POSStockStatusFilter,
} from "@/lib/pos/product-stock";
import { POS_PRODUCT_PAGE_SIZE } from "@/lib/pos/page-size";
import type { POSProduct } from "@/components/pos/pos-types";

/**
 * The register's product filter, evaluated locally.
 *
 * When the counter loses its connection the grid must keep answering the same
 * questions `GET /api/pos/products` answers online — search, category, stock
 * status — against the catalogue snapshot in IndexedDB. This mirrors the query
 * in `listPOSProducts`, field for field, so a cashier does not see one set of
 * results before the network drops and a different set after.
 *
 * Scoping is deliberately *not* repeated here. Which products this register may
 * sell at all (vendor ownership, `publishing.pointOfSale`, per-location stock)
 * is decided on the server and baked into the snapshot; re-deciding it client
 * side would be a second implementation of an authorization rule, and the one
 * that ran on untrusted ground. The snapshot contains only sellable products,
 * so this only narrows.
 */

interface OfflineCatalogFilter {
  search?: string;
  categoryId?: string;
  stockStatus?: POSStockStatusFilter;
  limit?: number;
}

/**
 * Mirrors the server's `$or`: name and SKU match loosely, barcodes exactly.
 *
 * A barcode is scanned, not typed, so a substring match on it would let a short
 * numeric search pull in unrelated products — which is why the server keeps
 * those two fields exact while the rest are regex.
 *
 * The needle is the RAW search, deliberately not `sanitizeSearchString`'d. That
 * helper escapes regex metacharacters because the server interpolates the term
 * into a `$regex`; an escaped `\(Large\)` still matches the literal text there,
 * but passed to `includes()` it matches nothing — so applying it here would
 * make the offline grid *narrower* than the online one for any product with a
 * bracket or a dash in its name.
 */
function matchesSearch(product: POSProduct, rawSearch: string): boolean {
  const search = rawSearch.trim();
  if (!search) return true;

  const needle = search.toLowerCase();
  const exact = normalizeLookupCode(search);

  if (product.name?.toLowerCase().includes(needle)) return true;
  if (product.sku?.toLowerCase().includes(needle)) return true;
  if (product.barcode && normalizeLookupCode(product.barcode) === exact) {
    return true;
  }

  for (const variant of product.variants || []) {
    if (variant.sku?.toLowerCase().includes(needle)) return true;
    if (variant.barcode && normalizeLookupCode(variant.barcode) === exact) {
      return true;
    }
  }

  return false;
}

export function filterOfflineProducts(
  products: POSProduct[],
  {
    search = "",
    categoryId = "",
    stockStatus = "all",
    limit = POS_PRODUCT_PAGE_SIZE,
  }: OfflineCatalogFilter = {},
): POSProduct[] {
  const matched: POSProduct[] = [];

  for (const product of products) {
    if (categoryId && product.category !== categoryId) continue;
    if (!matchesSearch(product, search)) continue;
    // Read through the stock policy rather than comparing `stock`: a digital
    // product or one with "track quantity" off sits at 0 by design and must
    // still be sellable at the counter.
    if (!matchesPOSStockStatus(product, stockStatus)) continue;

    matched.push(product);
    if (matched.length >= limit) break;
  }

  return matched;
}
