import { Product } from "@/models";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import {
  productAllowsOversell,
  productTracksStock,
} from "@/lib/products/stock-policy";
import { isPlainObject } from "@/lib/utils";

export type InventoryAdjustmentLine = {
  productId: string;
  quantity: number;
  variantId?: string;
};

export type InventoryAdjustmentOptions = {
  channel?: "online" | "pos";
  /**
   * Which branch this movement belongs to.
   *
   * Means two different things by channel, deliberately. For a POS sale it is a
   * **hard scope**: the register is standing in a specific shop, the units are
   * physically there, and a sale that the shop cannot cover must fail rather
   * than quietly draw down a warehouse across town. For an online order it is a
   * **preference**: the collection counter the shopper chose, or the branch the
   * merchant's dispatch order named, used when it can cover the line and fallen
   * back on when it cannot — because by then the money has usually been taken,
   * and refusing the decrement would leave a paid order with no stock movement.
   */
  locationId?: string;
  /**
   * Let every line go negative rather than refuse the movement.
   *
   * For sales that already happened in the real world and are only now
   * reaching the server — a POS terminal replaying its offline outbox. The
   * goods left the shop and the money is in the drawer, so refusing the
   * decrement would not un-sell anything; it would only leave the books
   * claiming stock the shelf does not have.
   *
   * Distinct from the per-product `continueSellingWhenOutOfStock` flag, which
   * is a merchant's standing decision about a product. This is a property of
   * one movement, and the caller is expected to record what went negative
   * (`posOversoldLines`) so a human can reconcile it.
   */
  allowOversell?: boolean;
};

export class InsufficientStockError extends Error {
  public readonly line: InventoryAdjustmentLine;
  public readonly channel: InventoryAdjustmentOptions["channel"];
  public readonly locationId?: string;

  constructor(params: {
    line: InventoryAdjustmentLine;
    channel?: InventoryAdjustmentOptions["channel"];
    locationId?: string;
  }) {
    super("Insufficient stock");
    this.name = "InsufficientStockError";
    this.line = params.line;
    this.channel = params.channel;
    this.locationId = params.locationId;
  }
}

type ProductModelLike = {
  updateOne?: (
    filter: unknown,
    update: unknown,
    options?: unknown,
  ) => Promise<unknown>;
  findByIdAndUpdate?: (id: unknown, update: unknown) => Promise<unknown>;
};

function readMatchedCount(result: unknown): number | null {
  if (!isPlainObject(result)) return null;
  const matchedCount = result.matchedCount;
  return typeof matchedCount === "number" ? matchedCount : null;
}

type LocationInventoryEntry = { locationId?: unknown; quantity?: number };

/** Map key for a line's per-location inventory: `productId` or `productId:variantId`. */
function lineLocationKey(line: InventoryAdjustmentLine): string {
  return line.variantId
    ? `${String(line.productId)}:${String(line.variantId)}`
    : String(line.productId);
}

/**
 * Batch-read the per-location inventory for every line in a single query and
 * return a map keyed by {@link lineLocationKey}.
 *
 * This replaces a per-line `findOne` (an N+1: a 3-item order previously issued 3
 * extra point reads before any write, on the hottest checkout path). One
 * `$in` load covers all lines; products/variants that don't track per-location
 * stock are simply absent from the map, and callers fall back to the plain
 * stock-only decrement — identical behavior to the old empty-array result.
 *
 * Guarded so the unit-test mocks (which may expose only `updateOne`) degrade to
 * an empty map rather than throwing.
 */
type LineLocationData = {
  /** Per-line location inventory, keyed by {@link lineLocationKey}. */
  locations: Map<string, LocationInventoryEntry[]>;
  /** Slugs of the affected products, for cache revalidation. */
  slugs: string[];
  /**
   * Products whose `stock` carries no meaning (digital, or "Track quantity"
   * off). Their lines are skipped entirely — there is nothing to draw down.
   */
  untracked: Set<string>;
  /**
   * Products that must never have a sale blocked by the stock on hand
   * (untracked, or "Continue selling when out of stock"). Their decrement runs
   * without the `stock >= quantity` guard and may go negative; that is the
   * documented meaning of the switch, and an inventory reconcile corrects it.
   */
  oversell: Set<string>;
  /**
   * The merchant's dispatch order, as location ids, keyed by product id.
   *
   * Which branch a posted order leaves from is a decision the merchant
   * configures, not something to infer from whichever shelf happens to be
   * fullest — that older rule meant a two-branch store could not tell which of
   * its shops had just sold something. The rule itself lives in
   * `lib/locations/fulfillment-location.ts`; this is only its answer, carried
   * per product because a marketplace order spans several vendors.
   */
  preferred: Map<string, string[]>;
};

async function readAllLineLocations(
  lines: InventoryAdjustmentLine[],
  opts: InventoryAdjustmentOptions = {},
): Promise<LineLocationData> {
  const locations = new Map<string, LocationInventoryEntry[]>();
  const slugs: string[] = [];
  const untracked = new Set<string>();
  const oversell = new Set<string>();
  const preferred = new Map<string, string[]>();
  const result = { locations, slugs, untracked, oversell, preferred };
  const productModel = Product as unknown as {
    find?: (q: unknown, p?: unknown) => { lean: () => Promise<unknown> };
  };
  if (typeof productModel.find !== "function") return result;

  const productIds = Array.from(
    new Set(
      lines
        .map((line) => (line.productId ? String(line.productId) : ""))
        .filter(Boolean),
    ),
  );
  if (productIds.length === 0) return result;

  const docs = (await productModel.find(
    { _id: { $in: productIds } },
    {
      slug: 1,
      vendorId: 1,
      locationInventory: 1,
      "shipping.isPhysicalProduct": 1,
      inventory: 1,
      "variants._id": 1,
      "variants.locationInventory": 1,
    },
  ).lean()) as Array<{
    _id: unknown;
    slug?: string;
    vendorId?: unknown;
    locationInventory?: LocationInventoryEntry[];
    shipping?: { isPhysicalProduct?: boolean };
    inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean };
    variants?: Array<{
      _id?: unknown;
      locationInventory?: LocationInventoryEntry[];
    }>;
  }> | null;
  if (!Array.isArray(docs)) return result;

  const vendorByProduct = new Map<string, string>();

  for (const doc of docs) {
    const productId = String(doc._id);
    if (typeof doc.slug === "string" && doc.slug.length > 0) {
      slugs.push(doc.slug);
    }
    if (!productTracksStock(doc)) untracked.add(productId);
    if (productAllowsOversell(doc)) oversell.add(productId);
    if (doc.vendorId) vendorByProduct.set(productId, String(doc.vendorId));
    if (Array.isArray(doc.locationInventory)) {
      locations.set(productId, doc.locationInventory);
    }
    if (Array.isArray(doc.variants)) {
      for (const variant of doc.variants) {
        if (variant?._id && Array.isArray(variant.locationInventory)) {
          locations.set(
            `${productId}:${String(variant._id)}`,
            variant.locationInventory,
          );
        }
      }
    }
  }

  // Never for POS: that channel reads `opts.locationId` as a hard scope and
  // ignores the dispatch order entirely, so resolving one would be a query per
  // sale bought for an answer nothing reads — on the register, which is the
  // path most likely to have per-location stock in the first place.
  if (opts.channel !== "pos") {
    await loadDispatchOrder(vendorByProduct, locations, preferred);
  }

  return result;
}

/**
 * Fill in each product's dispatch order.
 *
 * Skipped entirely unless some line actually tracks per-location stock: a store
 * that never configured a location has no branch to choose between, so asking
 * which one to prefer would be a query on the hottest write path in the app
 * bought for nothing — and that is the majority of installs.
 *
 * Imported lazily and allowed to fail. This module is the checkout's stock
 * movement; a dispatch preference is an improvement on where the units come
 * from, never a reason for the sale not to happen. Failing here simply leaves
 * the map empty and falls back to the fullest-branch rule.
 */
async function loadDispatchOrder(
  vendorByProduct: Map<string, string>,
  locations: Map<string, LocationInventoryEntry[]>,
  preferred: Map<string, string[]>,
): Promise<void> {
  if (locations.size === 0 || vendorByProduct.size === 0) return;

  try {
    const { fulfillmentCandidatesForVendor } = await import(
      "@/lib/locations/fulfillment-location"
    );

    // One lookup per distinct vendor, not per product: a ten-line order from
    // one store must not become ten identical queries.
    const byVendor = new Map<string, string[]>();
    for (const vendorId of new Set(vendorByProduct.values())) {
      const candidates = await fulfillmentCandidatesForVendor(vendorId);
      byVendor.set(
        vendorId,
        candidates.map((candidate) => candidate.id),
      );
    }

    for (const [productId, vendorId] of vendorByProduct) {
      const ranked = byVendor.get(vendorId);
      if (ranked?.length) preferred.set(productId, ranked);
    }
  } catch (error) {
    console.error("Failed to load fulfillment dispatch order:", error);
  }
}

/**
 * The branches to try, in order, for one line of an online order.
 *
 * `explicit` is whatever the order itself decided — the counter the shopper is
 * collecting from, or the branch already recorded on a sub-order being restored
 * — and always leads. `ranked` is the merchant's configured dispatch order for
 * that vendor. Both are preferences: an online decrement that refused to run
 * because the named branch was short would leave a paid order with no stock
 * movement at all.
 */
function preferredLocationIds(
  explicit: string | undefined,
  ranked: string[] | undefined,
): string[] {
  const ids = explicit ? [explicit] : [];
  for (const id of ranked || []) {
    if (id !== explicit) ids.push(id);
  }
  return ids;
}

/**
 * Pick which location an ONLINE sale should draw down. Online orders aren't
 * tied to a physical location the way a POS sale is, but per-location stock is
 * the source of truth for `stock` (the product pre-validate hook recomputes
 * stock = Σ location quantities). If we lowered only `stock`, the next
 * product.save() would resurrect the sold units — so online sales must also
 * decrement a location.
 *
 * The order of preference:
 *
 *  1. the branch the order named, if it can cover the line — the collection
 *     counter, or the merchant's first dispatch choice;
 *  2. any other configured branch, in the merchant's dispatch order;
 *  3. any branch at all that can cover it;
 *  4. the fullest.
 *
 * Steps 1–2 are what stops the ledger contradicting the paperwork: without
 * them the draw went to whichever shelf happened to hold the most, so a shopper
 * collecting from the Gulshan counter could have their units taken off the
 * Uttara warehouse, and neither branch's count described anything real.
 *
 * A named branch that cannot cover the line is passed over rather than driven
 * negative. That is not a silent correction — the order still records where it
 * was *meant* to ship from, so the mismatch reads as "this branch is short,
 * move something", which is exactly the instruction a merchant needs.
 */
function pickDecrementLocationId(
  locations: LocationInventoryEntry[],
  quantity: number,
  preferred: string[] = [],
): string | undefined {
  if (locations.length === 0) return undefined;

  for (const candidate of preferred) {
    const match = locations.find(
      (loc) => String(loc.locationId) === candidate,
    );
    if (match && Number(match.quantity || 0) >= quantity) return candidate;
  }

  const covering = locations.find(
    (loc) => Number(loc.quantity || 0) >= quantity,
  );
  const target =
    covering ||
    locations
      .slice()
      .sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0))[0];
  return target?.locationId ? String(target.locationId) : undefined;
}

/**
 * Where returned units go back to.
 *
 * The branch the sale came from, if the order still names one — otherwise the
 * first the product tracks, which is the old behaviour and the best guess
 * available for an order placed before any of this existed. Crediting a
 * different branch than the one debited is how stock silently migrates: cancel
 * enough orders on a two-branch store and the whole balance ends up in one shop
 * while the shelves say otherwise.
 *
 * Unlike the decrement there is no coverage test — a restore only ever adds, so
 * the named branch can always take it.
 */
function pickRestoreLocationId(
  locations: LocationInventoryEntry[],
  preferred: string[] = [],
): string | undefined {
  for (const candidate of preferred) {
    if (locations.some((loc) => String(loc.locationId) === candidate)) {
      return candidate;
    }
  }

  const first = locations[0];
  return first?.locationId ? String(first.locationId) : undefined;
}

async function decrementSingleLine(
  productModel: ProductModelLike,
  line: InventoryAdjustmentLine,
  opts: InventoryAdjustmentOptions,
  lineLocations: LocationInventoryEntry[],
  allowOversell = false,
  /** The merchant's dispatch order for this line's vendor, best first. */
  dispatchOrder: string[] = [],
) {
  // POS reads `opts.locationId` as a hard scope below, so it must not also
  // arrive here as a soft preference.
  const preferred =
    opts.channel === "pos"
      ? []
      : preferredLocationIds(opts.locationId, dispatchOrder);

  if (line.variantId) {
    if (typeof productModel.updateOne !== "function") {
      if (typeof productModel.findByIdAndUpdate !== "function") {
        throw new Error("Product model does not support inventory updates");
      }
      await productModel.findByIdAndUpdate(line.productId, {
        $inc: { stock: -line.quantity },
      });
      return;
    }

    const baseUpdate: Record<string, unknown> = {
      $inc: {
        stock: -line.quantity,
        "variants.$.stock": -line.quantity,
      },
    };

    // `lineLocations` is whether this variant tracks per-location stock at all —
    // the same guard the simple-product branch below already applies. A variant
    // with no rows holds its units in `variants.$.stock` alone, so the
    // location-scoped filter would match nothing and fail an otherwise valid
    // sale. That mirrors the register's read side (lib/pos/product-stock.ts),
    // which falls back to the aggregate for exactly these variants: what the
    // card offers, the counter must be able to take.
    const isPos =
      opts.channel === "pos" &&
      typeof opts.locationId === "string" &&
      opts.locationId.length > 0 &&
      lineLocations.length > 0;

    // Oversell drops the "this location holds enough" guard the same way it
    // drops the stock guards below: the sale must go through, and the location
    // is allowed to go negative until an inventory reconcile corrects it.
    const locationHasStock = allowOversell
      ? {}
      : { quantity: { $gte: line.quantity } };
    const locationFilterHasStock = allowOversell
      ? {}
      : { "li.quantity": { $gte: line.quantity } };

    // For POS + location inventory, validate against the location quantity.
    // Parent/variant aggregate stock can be stale and should not block sale.
    const filter: Record<string, unknown> = isPos
      ? {
          _id: line.productId,
          variants: {
            $elemMatch: {
              _id: line.variantId,
              locationInventory: {
                $elemMatch: {
                  locationId: opts.locationId,
                  ...locationHasStock,
                },
              },
            },
          },
        }
      : allowOversell
        ? // "Continue selling when out of stock": the variant must exist, but
          // its stock is not allowed to block the sale.
          {
            _id: line.productId,
            variants: { $elemMatch: { _id: line.variantId } },
          }
        : {
            _id: line.productId,
            stock: { $gte: line.quantity },
            variants: {
              $elemMatch: {
                _id: line.variantId,
                stock: { $gte: line.quantity },
              },
            },
          };

    let options: Record<string, unknown> | undefined;
    if (isPos) {
      (baseUpdate.$inc as Record<string, unknown>)[
        "variants.$.locationInventory.$[li].quantity"
      ] = -line.quantity;
      options = {
        arrayFilters: [
          {
            "li.locationId": opts.locationId,
            ...locationFilterHasStock,
          },
        ],
      };
    } else {
      // Online sale: if the variant tracks per-location stock, also draw down a
      // location so Σ(locationInventory) stays equal to variant.stock and the
      // pre-validate hook can't resurrect the sold units.
      const locationId = pickDecrementLocationId(
        lineLocations,
        line.quantity,
        preferred,
      );
      if (locationId) {
        (baseUpdate.$inc as Record<string, unknown>)[
          "variants.$.locationInventory.$[li].quantity"
        ] = -line.quantity;
        options = { arrayFilters: [{ "li.locationId": locationId }] };
      }
    }

    const result = await productModel.updateOne(filter, baseUpdate, options);
    if (readMatchedCount(result) === 0) {
      throw new InsufficientStockError({
        line,
        channel: opts.channel,
        locationId: opts.locationId,
      });
    }
    return;
  }

  if (typeof productModel.updateOne === "function") {
    const isPos =
      opts.channel === "pos" &&
      typeof opts.locationId === "string" &&
      opts.locationId.length > 0;

    const baseUpdate: Record<string, unknown> = {
      $inc: { stock: -line.quantity },
    };
    let filter: Record<string, unknown> = allowOversell
      ? { _id: line.productId }
      : { _id: line.productId, stock: { $gte: line.quantity } };
    let options: Record<string, unknown> | undefined;

    // `lineLocations` (passed in) is whether this product tracks per-location
    // stock at all. Stores that don't use multi-location inventory have no entry
    // — for them the plain stock-guarded decrement below remains the correct
    // (and only possible) behavior, including for POS sales.
    if (isPos && lineLocations.length > 0) {
      // POS simple product with location tracking: validate and draw down the
      // selling location so the sale is location-accurate (previously it
      // ignored the location entirely).
      filter = {
        _id: line.productId,
        locationInventory: {
          $elemMatch: {
            locationId: opts.locationId,
            ...(allowOversell ? {} : { quantity: { $gte: line.quantity } }),
          },
        },
      };
      (baseUpdate.$inc as Record<string, unknown>)[
        "locationInventory.$[li].quantity"
      ] = -line.quantity;
      options = {
        arrayFilters: [
          {
            "li.locationId": opts.locationId,
            ...(allowOversell ? {} : { "li.quantity": { $gte: line.quantity } }),
          },
        ],
      };
    } else {
      const locationId = pickDecrementLocationId(
        lineLocations,
        line.quantity,
        preferred,
      );
      if (locationId) {
        (baseUpdate.$inc as Record<string, unknown>)[
          "locationInventory.$[li].quantity"
        ] = -line.quantity;
        options = { arrayFilters: [{ "li.locationId": locationId }] };
      }
    }

    const result = await productModel.updateOne(filter, baseUpdate, options);
    if (readMatchedCount(result) === 0) {
      throw new InsufficientStockError({
        line,
        channel: opts.channel,
        locationId: opts.locationId,
      });
    }
    return;
  }

  if (typeof productModel.findByIdAndUpdate === "function") {
    await productModel.findByIdAndUpdate(line.productId, {
      $inc: { stock: -line.quantity },
    });
    return;
  }

  throw new Error("Product model does not support inventory updates");
}

/**
 * Decrement inventory for a list of lines. Atomic from the caller's
 * perspective: if any line fails (insufficient stock or otherwise), all
 * previously-decremented lines in the same call are rolled back before the
 * error is re-thrown. Callers can therefore treat the operation as
 * all-or-nothing.
 */
export async function decrementInventory(
  lines: InventoryAdjustmentLine[],
  opts: InventoryAdjustmentOptions = {},
) {
  const productModel = Product as unknown as ProductModelLike;
  const applied: InventoryAdjustmentLine[] = [];
  // Single batched read of every line's per-location inventory (+ slugs for cache
  // invalidation), replacing the former per-line findOne inside
  // decrementSingleLine (an N+1 on the checkout path) and the separate slug
  // lookup in invalidateProductCache.
  const lineData = await readAllLineLocations(lines, opts);

  try {
    for (const line of lines) {
      if (
        !line.productId ||
        !Number.isFinite(line.quantity) ||
        line.quantity <= 0
      ) {
        continue;
      }
      // Digital / untracked products have no counter to move. Skipping them
      // also keeps them out of `applied`, so a later failure doesn't try to
      // "restore" stock that was never taken.
      if (lineData.untracked.has(String(line.productId))) continue;
      await decrementSingleLine(
        productModel,
        line,
        opts,
        lineData.locations.get(lineLocationKey(line)) || [],
        // Either the product's own standing policy, or this movement being one
        // that cannot be refused.
        opts.allowOversell === true ||
          lineData.oversell.has(String(line.productId)),
        lineData.preferred.get(String(line.productId)) || [],
      );
      applied.push(line);
    }
  } catch (err) {
    if (applied.length > 0) {
      await restoreInventory(applied, opts).catch((rollbackErr) => {
        // If rollback itself fails, we surface the original error to the
        // caller (so they don't double-handle InsufficientStockError) but
        // log the rollback failure for operator follow-up.
        console.error(
          "Failed to roll back partial inventory decrement:",
          rollbackErr,
        );
      });
    }
    throw err;
  }

  // Refresh cached storefront product pages so the new stock count is
  // reflected immediately rather than waiting for the 60s revalidate window.
  await invalidateProductCache(applied, lineData.slugs);

  // Low-stock alerts. Fired only when this decrement CROSSED the threshold
  // (previous stock above, new stock at/below) so a product sitting at low
  // stock doesn't re-notify on every subsequent sale.
  await maybeNotifyLowStock(applied);
}

// Matches the admin inventory screen's low-stock boundary.
const LOW_STOCK_THRESHOLD = 10;

async function maybeNotifyLowStock(
  lines: InventoryAdjustmentLine[],
): Promise<void> {
  try {
    const decrementedByProduct = new Map<string, number>();
    for (const line of lines) {
      const key = String(line.productId);
      decrementedByProduct.set(
        key,
        (decrementedByProduct.get(key) || 0) + line.quantity,
      );
    }
    const productIds = Array.from(decrementedByProduct.keys());
    if (productIds.length === 0) return;

    const products = (await Product.find({ _id: { $in: productIds } })
      .select("name stock vendorId")
      .lean()) as Array<{
      _id: unknown;
      name?: string;
      stock?: number;
      vendorId?: unknown;
    }>;

    for (const product of products) {
      const decremented = decrementedByProduct.get(String(product._id)) || 0;
      const stock = Number(product.stock || 0);
      const previousStock = stock + decremented;
      if (stock > LOW_STOCK_THRESHOLD || previousStock <= LOW_STOCK_THRESHOLD) {
        continue;
      }

      const name = product.name || "Product";
      const { notifyStaffLowStock, notifyLowStock } = await import(
        "@/lib/notifications/notifications"
      );
      await notifyStaffLowStock(name, stock, {
        productId: String(product._id),
      }).catch((err) => console.error("Failed to notify staff low stock:", err));

      if (product.vendorId) {
        const { Vendor } = await import("@/models");
        const vendor = (await Vendor.findById(product.vendorId)
          .select("userId")
          .lean()) as { userId?: unknown } | null;
        if (vendor?.userId) {
          await notifyLowStock(String(vendor.userId), name, stock).catch(
            (err) => console.error("Failed to notify vendor low stock:", err),
          );
        }
      }
    }
  } catch (err) {
    // Alerts must never break order placement.
    console.error("Low-stock notification check failed:", err);
  }
}

/**
 * Restore inventory for cancelled/refunded orders.
 * Increments stock back for each line item.
 */
export async function restoreInventory(
  lines: InventoryAdjustmentLine[],
  opts: InventoryAdjustmentOptions = {},
) {
  const productModel = Product as unknown as ProductModelLike;
  // One batched read of all lines' locations (+ slugs), replacing the former
  // per-line findOne in each branch below and the slug lookup in
  // invalidateProductCache.
  const lineData = await readAllLineLocations(lines, opts);

  for (const line of lines) {
    if (!line.productId || !Number.isFinite(line.quantity) || line.quantity <= 0) {
      continue;
    }
    // Mirrors decrementInventory: nothing was taken from an untracked product,
    // so crediting it back would invent stock.
    if (lineData.untracked.has(String(line.productId))) continue;
    const lineLocations = lineData.locations.get(lineLocationKey(line)) || [];
    // Where this line's units came from, so they go back to the same shelf. POS
    // handles its own hard-scoped location further down.
    const preferred =
      opts.channel === "pos"
        ? []
        : preferredLocationIds(
            opts.locationId,
            lineData.preferred.get(String(line.productId)),
          );

    if (line.variantId) {
      if (typeof productModel.updateOne !== "function") {
        if (typeof productModel.findByIdAndUpdate !== "function") {
          throw new Error("Product model does not support inventory updates");
        }
        await productModel.findByIdAndUpdate(line.productId, {
          $inc: { stock: line.quantity },
        });
        continue;
      }

      const baseUpdate: Record<string, unknown> = {
        $inc: {
          stock: line.quantity,
          "variants.$.stock": line.quantity,
        },
      };

      const isPos = opts.channel === "pos" && typeof opts.locationId === "string" && opts.locationId.length > 0;

      const filter: Record<string, unknown> = {
        _id: line.productId,
        "variants._id": line.variantId,
      };

      let options: Record<string, unknown> | undefined;
      if (isPos) {
        (baseUpdate.$inc as Record<string, unknown>)[
          "variants.$.locationInventory.$[li].quantity"
        ] = line.quantity;
        options = {
          arrayFilters: [{ "li.locationId": opts.locationId }],
        };
      } else {
        // Online restore: credit a location so Σ(locationInventory) stays equal
        // to variant.stock (mirrors the online decrement).
        const locationId = pickRestoreLocationId(lineLocations, preferred);
        if (locationId) {
          (baseUpdate.$inc as Record<string, unknown>)[
            "variants.$.locationInventory.$[li].quantity"
          ] = line.quantity;
          options = { arrayFilters: [{ "li.locationId": locationId }] };
        }
      }

      await productModel.updateOne(filter, baseUpdate, options);
      continue;
    }

    if (typeof productModel.updateOne === "function") {
      const isPos =
        opts.channel === "pos" &&
        typeof opts.locationId === "string" &&
        opts.locationId.length > 0;
      const baseUpdate: Record<string, unknown> = {
        $inc: { stock: line.quantity },
      };
      let options: Record<string, unknown> | undefined;
      // Only credit a location the product actually tracks — `$[li]` on a
      // missing locationInventory array would make the whole update fail, and
      // a restore must never fail because a product doesn't use locations.
      // `lineLocations` was batch-loaded above.
      const trackedPosLocation =
        isPos &&
        lineLocations.some((loc) => String(loc.locationId) === opts.locationId)
          ? opts.locationId
          : undefined;
      const locationId = isPos
        ? trackedPosLocation
        : pickRestoreLocationId(lineLocations, preferred);
      if (locationId) {
        (baseUpdate.$inc as Record<string, unknown>)[
          "locationInventory.$[li].quantity"
        ] = line.quantity;
        options = { arrayFilters: [{ "li.locationId": locationId }] };
      }
      await productModel.updateOne(
        { _id: line.productId },
        baseUpdate,
        options,
      );
    } else if (typeof productModel.findByIdAndUpdate === "function") {
      await productModel.findByIdAndUpdate(line.productId, {
        $inc: { stock: line.quantity },
      });
    } else {
      throw new Error("Product model does not support inventory updates");
    }
  }

  await invalidateProductCache(lines, lineData.slugs);
}

type StockChangeRequest = {
  productId: string;
  variantId?: string;
  locationId?: string;
  /** Target value when `adjustment` is false; signed delta when true. */
  quantity: number;
  adjustment: boolean;
  /** Extra filter (staff scope, vendorId) merged into every match. */
  scopeFilter?: Record<string, unknown>;
};

type StockChangeResult = { success: boolean; error?: string };

type StockSnapshot = {
  variantStock: number;
  productStock: number;
  locations: Array<{ locationId?: unknown; quantity?: number }>;
  variantFound: boolean;
};

async function readStockSnapshot(
  request: StockChangeRequest,
): Promise<StockSnapshot | null> {
  const doc = (await Product.findOne(
    { _id: request.productId, ...(request.scopeFilter || {}) },
    request.variantId
      ? { stock: 1, variants: { $elemMatch: { _id: request.variantId } } }
      : { stock: 1, locationInventory: 1 },
  ).lean()) as {
    stock?: number;
    locationInventory?: Array<{ locationId?: unknown; quantity?: number }>;
    variants?: Array<{
      stock?: number;
      locationInventory?: Array<{ locationId?: unknown; quantity?: number }>;
    }>;
  } | null;
  if (!doc) return null;
  const variant = request.variantId ? doc.variants?.[0] : undefined;
  return {
    variantFound: !request.variantId || Boolean(variant),
    variantStock: Number(variant?.stock || 0),
    productStock: Number(doc.stock || 0),
    locations: request.variantId
      ? variant?.locationInventory || []
      : doc.locationInventory || [],
  };
}

/**
 * Apply an admin/vendor stock set-or-adjust as a single guarded update.
 *
 * The previous implementation was findOne → mutate arrays in JS → save(),
 * which silently overwrote any sale that landed between the read and the
 * write (document save() $sets whole arrays from the stale in-memory copy).
 * This version pins the value it read in the update filter (compare-and-swap)
 * and retries on interference, so a concurrent atomic decrement is never
 * clobbered. All aggregate fields (variant.stock, inventory.quantity, product
 * stock) are maintained in the same update, preserving the
 * Σ(locationInventory) == stock invariant the pre-validate hook enforces.
 */
export async function applyStockChangeAtomic(
  request: StockChangeRequest,
): Promise<StockChangeResult> {
  if (!request.productId) {
    return { success: false, error: "productId is required" };
  }
  if (!Number.isFinite(request.quantity)) {
    return { success: false, error: "quantity must be a number" };
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await readStockSnapshot(request);
    if (!snapshot) return { success: false, error: "Product not found" };
    if (!snapshot.variantFound) {
      return { success: false, error: "Variant not found" };
    }

    const scope = request.scopeFilter || {};
    let matched: number | null = null;

    if (request.locationId) {
      const entry = snapshot.locations.find(
        (loc) => String(loc.locationId) === request.locationId,
      );
      const current = Number(entry?.quantity || 0);
      const nextValue = Math.max(
        0,
        request.adjustment ? current + request.quantity : request.quantity,
      );
      const delta = nextValue - current;

      if (entry) {
        if (request.variantId) {
          const result = await Product.updateOne(
            {
              _id: request.productId,
              ...scope,
              variants: {
                $elemMatch: {
                  _id: request.variantId,
                  locationInventory: {
                    $elemMatch: {
                      locationId: request.locationId,
                      quantity: current,
                    },
                  },
                },
              },
            },
            {
              $set: {
                "variants.$[v].locationInventory.$[li].quantity": nextValue,
              },
              $inc: {
                "variants.$[v].stock": delta,
                "variants.$[v].inventory.quantity": delta,
                stock: delta,
              },
            },
            {
              arrayFilters: [
                { "v._id": request.variantId },
                {
                  "li.locationId": request.locationId,
                  "li.quantity": current,
                },
              ],
            },
          );
          matched = result.matchedCount;
        } else {
          const result = await Product.updateOne(
            {
              _id: request.productId,
              ...scope,
              locationInventory: {
                $elemMatch: {
                  locationId: request.locationId,
                  quantity: current,
                },
              },
            },
            {
              $set: { "locationInventory.$[li].quantity": nextValue },
              $inc: { stock: delta },
            },
            {
              arrayFilters: [
                {
                  "li.locationId": request.locationId,
                  "li.quantity": current,
                },
              ],
            },
          );
          matched = result.matchedCount;
        }
      } else {
        // First entry for this location. The stock aggregate becomes
        // Σ(existing entries) + new value, matching the old recompute logic
        // (a legacy non-location stock value is replaced, not added to).
        const existingSum = snapshot.locations.reduce(
          (sum, loc) => sum + Number(loc.quantity || 0),
          0,
        );
        const nextAggregate = existingSum + nextValue;
        if (request.variantId) {
          const delta2 = nextAggregate - snapshot.variantStock;
          const result = await Product.updateOne(
            {
              _id: request.productId,
              ...scope,
              variants: {
                $elemMatch: {
                  _id: request.variantId,
                  stock: snapshot.variantStock,
                  "locationInventory.locationId": { $ne: request.locationId },
                },
              },
            },
            {
              $push: {
                "variants.$[v].locationInventory": {
                  locationId: request.locationId,
                  quantity: nextValue,
                },
              },
              $set: {
                "variants.$[v].stock": nextAggregate,
                "variants.$[v].inventory.quantity": nextAggregate,
              },
              $inc: { stock: delta2 },
            },
            { arrayFilters: [{ "v._id": request.variantId }] },
          );
          matched = result.matchedCount;
        } else {
          const result = await Product.updateOne(
            {
              _id: request.productId,
              ...scope,
              stock: snapshot.productStock,
              "locationInventory.locationId": { $ne: request.locationId },
            },
            {
              $push: {
                locationInventory: {
                  locationId: request.locationId,
                  quantity: nextValue,
                },
              },
              $set: { stock: nextAggregate },
            },
          );
          matched = result.matchedCount;
        }
      }
    } else if (request.variantId) {
      const current = snapshot.variantStock;
      const nextValue = Math.max(
        0,
        request.adjustment ? current + request.quantity : request.quantity,
      );
      const delta = nextValue - current;
      const result = await Product.updateOne(
        {
          _id: request.productId,
          ...scope,
          variants: { $elemMatch: { _id: request.variantId, stock: current } },
        },
        {
          $set: {
            "variants.$[v].stock": nextValue,
            "variants.$[v].inventory.quantity": nextValue,
          },
          $inc: { stock: delta },
        },
        { arrayFilters: [{ "v._id": request.variantId }] },
      );
      matched = result.matchedCount;
    } else {
      const current = snapshot.productStock;
      const nextValue = Math.max(
        0,
        request.adjustment ? current + request.quantity : request.quantity,
      );
      const result = await Product.updateOne(
        { _id: request.productId, ...scope, stock: current },
        { $set: { stock: nextValue } },
      );
      matched = result.matchedCount;
    }

    if (matched === 1) return { success: true };
    // matched 0 → a concurrent write moved the value we pinned; re-read and retry.
  }

  return {
    success: false,
    error: "Stock changed concurrently; please retry",
  };
}

/**
 * Look up slugs for the given inventory lines and trigger a cache
 * invalidation. Best-effort: failures are logged but never thrown, because
 * cache invalidation must not break order placement / refund flows.
 */
async function invalidateProductCache(
  lines: InventoryAdjustmentLine[],
  knownSlugs?: string[],
): Promise<void> {
  const productIds = Array.from(
    new Set(
      lines
        .map((line) => String(line.productId || "").trim())
        .filter(Boolean),
    ),
  );
  if (productIds.length === 0) return;

  try {
    // The decrement/restore paths already loaded these products (for their
    // location inventory) and pass the slugs in, so we avoid a second
    // `Product.find` per order. Other callers omit them and we look them up.
    const slugs =
      knownSlugs ??
      (
        await Product.find({ _id: { $in: productIds } })
          .select("slug")
          .lean()
      )
        .map((p) => p.slug)
        .filter(
          (slug): slug is string => typeof slug === "string" && slug.length > 0,
        );

    revalidateProductContent({ slugs });
  } catch (err) {
    console.error(
      "Failed to invalidate product cache after inventory change:",
      err,
    );
  }
}
