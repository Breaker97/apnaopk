/**
 * Whether one branch actually holds what a basket is asking for.
 *
 * "In stock" on the storefront is a marketplace-wide sum — every branch's units
 * added together. That is the right answer for a posted order, which can be
 * dispatched from wherever the goods are, and the wrong one for a collection:
 * a shopper walking into the Gulshan counter cannot be handed a unit sitting in
 * the Uttara warehouse. Until this existed, checkout happily promised exactly
 * that, and the mismatch only surfaced when the customer arrived.
 *
 * Deliberately pure and free of `server-only`: the availability endpoint, the
 * checkout resolver that re-validates before payment, and the tests all have to
 * answer this the same way, and a second implementation is how the offer and
 * the guard drift apart.
 */

import {
  productAllowsOversell,
  productTracksStock,
  type StockPolicySource,
} from "@/lib/products/stock-policy";

export type BranchInventoryRow = {
  locationId?: unknown;
  quantity?: number;
};

export type BranchStockLine = {
  productId: string;
  /** Units being bought. */
  quantity: number;
  /** The two admin switches that decide whether stock is a limit at all. */
  policy: StockPolicySource;
  /**
   * Per-location rows for exactly what is being bought — the chosen variant's
   * when there is one, the product's otherwise. A variant carries its own
   * counts, so reading the product's would answer for the wrong thing.
   */
  locationInventory?: BranchInventoryRow[] | null;
};

/**
 * Can this branch cover this line?
 *
 * The order of the answers matters, and only the third is new:
 *
 *  1. **Stock is not a limit** — digital, or "Track quantity" off. Nothing to
 *     run out of, at any branch.
 *  2. **"Continue selling when out of stock"** — the merchant has said a sale
 *     is never blocked by the count. Collection is no exception; they are the
 *     ones who will hand it over.
 *  3. **The product tracks no per-location stock at all** — an empty or absent
 *     `locationInventory`. This is the escape hatch that keeps the whole
 *     feature usable: for a merchant who never opened the locations screen,
 *     location is simply not a dimension of their stock, and demanding a branch
 *     count they have never entered would take collection away from the
 *     majority of stores to fix a problem only multi-branch stores have.
 *  4. Otherwise the branch's own count has to cover it.
 */
export function branchStocksLine(
  line: BranchStockLine,
  locationId: string,
): boolean {
  if (!productTracksStock(line.policy)) return true;
  if (productAllowsOversell(line.policy)) return true;

  const rows = line.locationInventory;
  if (!Array.isArray(rows) || rows.length === 0) return true;

  const row = rows.find((entry) => String(entry.locationId) === locationId);
  return Number(row?.quantity || 0) >= line.quantity;
}

/**
 * The products this branch cannot cover, as ids.
 *
 * A list rather than a boolean because the shopper is choosing between
 * branches: "Gulshan does not have the kettle" is actionable, "unavailable" is
 * a dead end they can only escape by guessing.
 */
export function branchShortLines(
  lines: BranchStockLine[],
  locationId: string,
): string[] {
  return lines
    .filter((line) => !branchStocksLine(line, locationId))
    .map((line) => line.productId);
}

/** Whether the whole basket can be collected from this one branch. */
export function branchCanFulfill(
  lines: BranchStockLine[],
  locationId: string,
): boolean {
  return lines.every((line) => branchStocksLine(line, locationId));
}

/**
 * Drop per-branch stock counts from anything about to be serialised to a
 * browser.
 *
 * The storefront's product queries load whole documents, so `locationInventory`
 * — how many units sit in which of a merchant's shops — was being written into
 * the HTML of every product page and returned by the public products API.
 * Nothing on the storefront reads it: the one question a shopper has, "can I
 * collect this near me", is answered server-side by
 * `lib/locations/product-collection.ts` precisely so these numbers never have
 * to travel. Left in, they are a competitor's inventory report, free, on
 * request — including which shop is nearly empty.
 *
 * Mutates in place, and is therefore only ever called on an object the caller
 * just built (a `JSON.parse(JSON.stringify(...))` copy, or a fresh `.lean()`
 * result). Never on something read back out of a cache, which would strip the
 * cached entry for every later reader too.
 */
export function stripLocationInventory<T>(product: T): T {
  if (!product || typeof product !== "object") return product;

  const record = product as Record<string, unknown>;
  delete record.locationInventory;

  const variants = record.variants;
  if (Array.isArray(variants)) {
    for (const variant of variants) {
      if (variant && typeof variant === "object") {
        delete (variant as Record<string, unknown>).locationInventory;
      }
    }
  }

  return product;
}

/**
 * MongoDB equivalent of {@link branchStocksLine}, for the "Pickup near me"
 * filter.
 *
 * Lives beside the function it mirrors for the same reason
 * `AVAILABLE_STOCK_QUERY` lives beside `isProductAvailable`: a product the
 * filter hides but the checkout would happily hand over — or worse, one the
 * filter offers and the checkout then refuses — is a bug, and the two only stay
 * in step if they are read together.
 *
 * `locationId` is a plain String on `locationInventory` (no `ref`), so the ids
 * go in as the hex strings the resolver returns rather than as ObjectIds.
 *
 * The arms, in the order they answer:
 *
 *  - the product, or one of its variants, holds units at a branch in range;
 *  - stock is not a limit for it — "Track quantity" off, or "Continue selling
 *    when out of stock". Digital needs no arm: the facet excludes it outright,
 *    because nothing downloadable is ever collected;
 *  - it tracks no per-location stock **anywhere**. Tested as "neither level has
 *    a first element" rather than "the product's array is empty", because a
 *    variant product legitimately keeps its counts one level down and would
 *    otherwise sail through this escape hatch with every branch empty.
 */
export function collectableAtBranchesQuery(
  branchIds: string[],
): Record<string, unknown> {
  const atNearbyBranch = {
    $elemMatch: {
      locationId: { $in: branchIds },
      quantity: { $gt: 0 },
    },
  };

  return {
    $or: [
      { locationInventory: atNearbyBranch },
      { "variants.locationInventory": atNearbyBranch },
      { "inventory.tracked": false },
      { "inventory.continueSellingWhenOutOfStock": true },
      {
        $nor: [
          { "locationInventory.0": { $exists: true } },
          { "variants.locationInventory.0": { $exists: true } },
        ],
      },
    ],
  };
}
