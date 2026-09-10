/**
 * Reference data the product editor needs before it can render a usable form:
 * the category tree, assignable brands, active collections, inventory
 * locations, and the shipping context that decides which shipping fields show.
 *
 * The editor used to pull each of these from its own endpoint (five parallel
 * requests, each re-authenticating and each returning whole documents). They
 * are collected here instead so admin/staff and vendor both answer the form
 * with a single projected payload.
 */

import { unstable_cache } from "next/cache";
import { Brand, Category, Collection, InventoryLocation } from "@/models";
import { getSettings } from "@/models/settings.model";
import { STOREFRONT_BRAND_FILTER } from "@/lib/catalog/brands";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import {
  locationOwnerFilter,
  type InventoryLocationScope,
} from "@/lib/inventory/inventory-location-scope";
import { hasWeightRates } from "@/lib/catalog/product-shipping";
import type {
  ProductFormCategory,
  ProductFormLocation,
  ProductFormOptions,
  ProductFormShippingContext,
} from "@/lib/products/form-options-types";

export type * from "@/lib/products/form-options-types";

/** Matches the admin collections list the form used to page through. */
const COLLECTION_LIMIT = 100;

type LeanCategory = {
  _id: unknown;
  name?: string;
  slug?: string;
  parentId?: unknown;
  options?: unknown;
};

/**
 * Decorate a flat category list with `path` (ancestor names ending in self) and
 * `isLeaf`. The picker uses `path` for breadcrumbs and `isLeaf` to keep parent
 * rows visible as context but unselectable. Mirrors GET /api/categories.
 */
function decorateCategories(categories: LeanCategory[]): ProductFormCategory[] {
  const byId = new Map(categories.map((c) => [String(c._id), c]));
  const childCount = new Map<string, number>();
  for (const c of categories) {
    if (!c.parentId) continue;
    const key = String(c.parentId);
    childCount.set(key, (childCount.get(key) || 0) + 1);
  }

  const pathCache = new Map<string, string[]>();
  function pathFor(id: string): string[] {
    const cached = pathCache.get(id);
    if (cached) return cached;
    const cat = byId.get(id);
    if (!cat) return [];
    // Seed the cache before recursing so a cyclic parentId can't loop forever.
    pathCache.set(id, []);
    const parent = cat.parentId ? pathFor(String(cat.parentId)) : [];
    const result = [...parent, String(cat.name ?? "")];
    pathCache.set(id, result);
    return result;
  }

  return categories.map((c) => {
    const id = String(c._id);
    const rawOptions = Array.isArray(c.options) ? c.options : [];
    return {
      _id: id,
      name: String(c.name ?? ""),
      slug: String(c.slug ?? ""),
      parentId: c.parentId ? String(c.parentId) : null,
      path: pathFor(id),
      isLeaf: !childCount.get(id),
      options: rawOptions.map((option) => {
        const o = option as {
          name?: unknown;
          position?: unknown;
          values?: unknown;
        };
        return {
          name: String(o.name ?? ""),
          position: typeof o.position === "number" ? o.position : undefined,
          values: (Array.isArray(o.values) ? o.values : []).map((value) => {
            const v = value as {
              value?: unknown;
              colorCode?: unknown;
              position?: unknown;
            };
            return {
              value: String(v.value ?? ""),
              colorCode:
                typeof v.colorCode === "string" ? v.colorCode : undefined,
              position: typeof v.position === "number" ? v.position : undefined,
            };
          }),
        };
      }),
    };
  });
}

/**
 * Categories, brands and collections change rarely and every write path already
 * busts their cache tag, so the DB round trips are cached. `revalidate` is a
 * backstop in case a write path ever forgets its tag; locations and settings
 * are read live because they have no tag of their own.
 */
const getCachedCatalogOptions = unstable_cache(
  async (includeInactiveCategories: boolean) => {
    const categoryFilter = includeInactiveCategories ? {} : { isActive: true };

    const [categories, brands, collections] = await Promise.all([
      Category.find(categoryFilter)
        .select("name slug parentId options")
        .sort({ order: 1, name: 1 })
        .lean(),
      Brand.find(STOREFRONT_BRAND_FILTER)
        .select("name slug")
        .sort({ order: 1, name: 1 })
        .lean(),
      Collection.find({ status: "active" })
        .select("title slug")
        .sort({ position: 1, createdAt: -1 })
        .limit(COLLECTION_LIMIT)
        .lean(),
    ]);

    return {
      categories: decorateCategories(categories as LeanCategory[]),
      brands: brands.map((b) => ({
        _id: String(b._id),
        name: String(b.name ?? ""),
        slug: String(b.slug ?? ""),
      })),
      collections: collections.map((c) => ({
        _id: String(c._id),
        title: String(c.title ?? ""),
        slug: String(c.slug ?? ""),
      })),
    };
  },
  ["product-form-options"],
  {
    revalidate: 300,
    tags: [CACHE_TAGS.categories, CACHE_TAGS.brands, CACHE_TAGS.collections],
  },
);

/**
 * The caller's own active locations.
 *
 * Scoped, not global: this list is what the product editor offers as places to
 * stock a product, and an unscoped version handed every vendor the names of
 * every other merchant's warehouses — and let them park stock in one.
 */
async function getLocations(
  scope: InventoryLocationScope,
): Promise<ProductFormLocation[]> {
  const locations = await InventoryLocation.find(
    locationOwnerFilter(scope, { isActive: true }),
  )
    .select("name isDefault")
    .sort({ isDefault: -1, name: 1 })
    .lean();

  return locations.map((l) => ({
    _id: String(l._id),
    name: String(l.name ?? ""),
    isDefault: Boolean(l.isDefault),
  }));
}

/**
 * Resolve which shipping configuration drives the form's shipping card.
 * A vendor's own shipping profile wins only when the platform enabled vendor
 * shipping and the vendor turned theirs on; customs is always platform-level.
 */
async function getShippingContext(
  vendorShipping?: unknown,
): Promise<ProductFormShippingContext> {
  const settings = await getSettings();
  const platformShipping = settings.shipping;

  let activeShipping: unknown = platformShipping;
  if (platformShipping?.vendorShipping?.enabled) {
    const vendor = vendorShipping as { enabled?: unknown } | undefined;
    if (vendor?.enabled) activeShipping = vendor;
  }

  const active = activeShipping as
    | { enabled?: unknown; weightUnit?: unknown }
    | undefined;

  return {
    enabled: Boolean(active?.enabled),
    weightUnit: active?.weightUnit === "lb" ? "lb" : "kg",
    usesWeightRates: hasWeightRates(activeShipping),
    customsEnabled: Boolean(platformShipping?.customs?.enabled),
  };
}

interface BuildProductFormOptionsInput {
  /**
   * Admins manage inactive categories too, so they can still assign one; every
   * other caller only sees the active set (matching GET /api/categories).
   */
  includeInactiveCategories: boolean;
  /** The vendor's shipping profile, when the caller is a vendor. */
  vendorShipping?: unknown;
  /**
   * Whose locations to offer. Required rather than optional so a new caller
   * cannot silently fall back to the whole platform's list.
   */
  scope: InventoryLocationScope;
}

export async function buildProductFormOptions({
  includeInactiveCategories,
  vendorShipping,
  scope,
}: BuildProductFormOptionsInput): Promise<ProductFormOptions> {
  const [catalog, locations, shipping] = await Promise.all([
    getCachedCatalogOptions(includeInactiveCategories),
    getLocations(scope),
    getShippingContext(vendorShipping),
  ]);

  return {
    ...catalog,
    locations,
    shipping,
    // Staff pinned to specific locations may stock products in them but not
    // create new ones, so the editor hides its inline "add location" control
    // rather than offering a button that answers 403.
    canManageLocations: scope.locationIds.length === 0,
  };
}
