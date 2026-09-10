import { Product, Category } from "@/models";
import { PRODUCT_STATUS } from "@/config/app.config";
import { resolveLocationScope } from "@/lib/inventory/inventory-location-scope";
import { isValidObjectId, sanitizeSearchString } from "@/lib/api/validate";
import {
  applyPOSLocationStock,
  matchesPOSStockStatus,
  type POSProductWithInventory,
  type POSStockStatusFilter,
} from "@/lib/pos/product-stock";
import type { POSCategory, POSProduct } from "@/components/pos/pos-types";
import {
  MAX_POS_PRODUCT_PAGE_SIZE,
  POS_PRODUCT_PAGE_SIZE,
} from "@/lib/pos/page-size";

interface POSProductListParams {
  search?: string;
  categoryId?: string;
  locationId?: string;
  stockStatus?: POSStockStatusFilter;
  limit?: number;
  /**
   * Fetch specific products instead of searching. Used to re-price and re-check
   * the stock of a held sale on resume; the visibility rules below still apply,
   * so a product that has since been unpublished simply comes back missing.
   */
  ids?: string[];
  /**
   * The category list is store-wide, so the terminal only needs it on its first
   * (unfiltered) load. Per-keystroke searches skip the query entirely.
   */
  includeFilterLists?: boolean;
  /**
   * Page through the whole sellable catalogue by `_id`, for the offline
   * snapshot (`GET /api/pos/offline-catalog`).
   *
   * A register that loses its connection has to keep resolving scans, and a
   * scan can hit any product — not just the fifty the grid happens to be
   * showing. Paging here rather than in a route of its own is what keeps the
   * snapshot answering to the same ownership and publishing rules as the grid:
   * a second query would be a second place for "what may this register sell"
   * to drift.
   *
   * `paged` turns the mode on; `cursor` is absent for the first page, so it
   * cannot double as the switch.
   */
  paged?: boolean;
  cursor?: string;
}

export interface POSProductListUser {
  id: string;
  role: string;
}

export interface POSProductListResult {
  products: POSProduct[];
  categories: POSCategory[];
  /**
   * Where a paged snapshot pull resumes, or undefined when the catalogue is
   * exhausted. Taken from the last row read from the database, BEFORE stock
   * filtering — a page whose rows were all filtered out still has to advance,
   * or the pull would ask for the same page forever.
   */
  nextCursor?: string;
}

// Re-exported from a dependency-free module so client code can read them
// without dragging the Mongoose models in. See lib/pos/page-size.ts.
export {
  POS_PRODUCT_PAGE_SIZE,
  MAX_POS_PRODUCT_PAGE_SIZE,
} from "@/lib/pos/page-size";

// `shipping` and `inventory` carry the stock policy (digital, track-quantity
// off, continue-selling), without which a resumed sale would drop every digital
// line as "out of stock" — their `stock` is 0 by design.
const PRODUCT_FIELDS =
  "name price comparePrice images media sku skuNormalized barcode barcodeNormalized stock locationInventory variants category vendorId productSource options shipping.isPhysicalProduct inventory.tracked inventory.continueSellingWhenOutOfStock";

/**
 * Mongoose lean documents carry ObjectId/Date instances, which neither
 * `NextResponse.json` semantics nor the RSC → client boundary accept as-is.
 */
function toPlainJSON<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * The single source of truth for "which products can this user sell right now".
 * Shared by `GET /api/pos/products` (filter changes, search) and the POS page's
 * server component (initial render), so both always agree.
 *
 * A register sells its own merchant's catalogue and nothing else: a vendor's
 * register sells that vendor's products, and the admin/staff register sells the
 * house store's. Ownership is read from `vendorId`, not from `productSource` —
 * scoped staff can create a product under an external vendor while it is still
 * stamped `productSource: "admin"`, so that field answers "who typed it in",
 * not "whose stock is this".
 */
export async function listPOSProducts(
  user: POSProductListUser,
  {
    search = "",
    categoryId = "",
    locationId = "",
    stockStatus = "all",
    limit = POS_PRODUCT_PAGE_SIZE,
    ids,
    includeFilterLists,
    paged,
    cursor,
  }: POSProductListParams = {},
): Promise<POSProductListResult> {
  const lookupIds = ids?.filter((id) => isValidObjectId(id)) ?? null;
  // An id lookup that survives no valid ids must not fall through to an
  // unfiltered listing — that would hand back the whole catalogue.
  if (lookupIds && lookupIds.length === 0) {
    return { products: [], categories: [] };
  }

  const pageSize = Math.min(Math.max(1, limit), MAX_POS_PRODUCT_PAGE_SIZE);
  // An id lookup is a re-read of a known basket, not a browse: the filter
  // lists and the category/search/stock narrowing would only hide rows the
  // caller explicitly asked for.
  const withFilterLists = lookupIds
    ? false
    : (includeFilterLists ?? !search);

  // "Price on request" products carry no price (their `price` is a placeholder
  // 0), so a register line for one would ring up as free. They are kept out of
  // the POS catalogue entirely rather than shown at 0.00 — a quoted product is
  // sold by agreeing a price first, which is a conversation, not a tap.
  const query: Record<string, unknown> = {
    status: PRODUCT_STATUS.ACTIVE,
    priceOnRequest: { $ne: true },
  };

  if (lookupIds) {
    query._id = { $in: lookupIds };
  } else if (cursor && isValidObjectId(cursor)) {
    query._id = { $gt: cursor };
  }

  // `"write"` because running a register is not a browse: a vendor still in
  // payment-required setup may look at their catalogue, but must not take money
  // over it.
  const scope = await resolveLocationScope(user, "write");
  query.vendorId = scope.vendorId;

  // The publishing channel is an admin/staff concern — a vendor's own register
  // shows their whole catalogue, as it did before ownership was enforced here.
  if (!scope.isVendor) {
    query["publishing.pointOfSale"] = true;
  }

  if (categoryId && !lookupIds) {
    query.category = categoryId;
  }

  if (search && !lookupIds) {
    // Escape for the regex fields only; barcode fields stay exact-match.
    const escapedSearch = sanitizeSearchString(search);
    query.$or = [
      { name: { $regex: escapedSearch, $options: "i" } },
      { sku: { $regex: escapedSearch, $options: "i" } },
      { barcode: search },
      { "variants.barcode": search },
      { "variants.sku": { $regex: escapedSearch, $options: "i" } },
    ];
  }

  // The product query and the (unfiltered) category list are independent, so
  // they run together instead of one after the other.
  const [rawProducts, rawCategories] = await Promise.all([
    Product.find(query)
      .select(PRODUCT_FIELDS)
      // Cursor paging has to walk a stable order, and `_id` is the field the
      // cursor advances along. Unpaged calls keep their natural order.
      .sort(paged && !lookupIds ? { _id: 1 } : {})
      // Stock filtering happens after per-location inventory is resolved, so a
      // filtered request has to over-fetch before trimming back to the page.
      .limit(
        lookupIds
          ? lookupIds.length
          : stockStatus === "all"
            ? pageSize
            : Math.max(pageSize, 100),
      )
      .lean(),
    withFilterLists
      ? Category.find({ isActive: true })
          .select("name slug image")
          .sort({ order: 1 })
          .lean()
      : Promise.resolve([]),
  ]);

  const products = rawProducts
    .map((product) =>
      applyPOSLocationStock(
        product as typeof product & POSProductWithInventory,
        locationId,
      ),
    )
    // An id lookup must return every requested row, including the sold-out
    // ones: the caller needs to be told a held line went out of stock, not
    // handed a silently shorter list.
    .filter(
      (product) => !!lookupIds || matchesPOSStockStatus(product, stockStatus),
    )
    .slice(0, lookupIds ? lookupIds.length : pageSize);

  const lastRead = rawProducts[rawProducts.length - 1] as
    | { _id?: unknown }
    | undefined;

  return {
    products: toPlainJSON<POSProduct[]>(products),
    categories: toPlainJSON<POSCategory[]>(rawCategories),
    nextCursor:
      paged && !lookupIds && rawProducts.length >= pageSize && lastRead?._id
        ? String(lastRead._id)
        : undefined,
  };
}
