import "server-only";

import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { getCollectionProducts } from "@/lib/catalog/collections";
import { connectDB, mongoose } from "@/lib/db";
import type { ModernProduct } from "@/lib/products/modern-product";
import type { SlideProductInfo } from "@/lib/sliders/render";
import { serializeProductCards } from "@/lib/products/storefront-product-cards";
import { collectionShelfWindow } from "@/lib/storefront/sections/collection-shelf";
import type { SliderCellContent } from "@/lib/storefront/sections/slider-grids";
import { withFallback } from "@/lib/storefront/cached-read";
import type { ResolvedSlider } from "@/lib/storefront/sliders";
import { Collection } from "@/models";
import { readOr, type SectionReadMode } from "./read-mode";
import { resolveCellData, type CellDataScope } from "./slider-cells";

/** The widest read a row makes: six cards, the lead, and six picks before them. */
const MAX_PRODUCTS = 13;

/**
 * The widest shelf a product section draws from one collection: the
 * catalogue browser's four rows of six.
 */
const MAX_SOURCE_PRODUCTS = 24;

/**
 * The collection the storefront shows under this id: active, and published
 * to the online store. Null for anything else — a draft, an unpublished
 * collection, a deleted one, or an id that is not one.
 */
async function findShownCollection(collectionId: string) {
  if (!mongoose.isValidObjectId(collectionId)) return null;
  const collection = await Collection.findOne({
    _id: collectionId,
    status: "active",
  }).lean();
  if (!collection || !collection.publishing?.onlineStore) return null;
  return collection;
}

/** A collection's first products, as a shelf shows them. */
interface CollectionShelf {
  title: string;
  slug: string;
  products: ModernProduct[];
  /** The hand-placed products the collection still offers, in slot order. */
  picked: ModernProduct[];
}

/**
 * One collection's shelf, by id rather than slug (the admin picker stores the
 * stable id; `getStorefrontCollectionDetail` keys by slug for URLs). Same
 * guards and tags as the detail reader: active, and published to the online
 * store. Null for a collection that is not shown or has no products.
 *
 * `products` is the collection in its own order, `limit` long. `picks` asks
 * for specific products as well — the ones a merchant placed by hand — and
 * `picked` answers with those of them the collection still offers, in the
 * order asked.
 *
 * A failed read throws; `fetchCollectionShelf` is the storefront's reader,
 * which answers null instead.
 */
const readCollectionShelf = unstable_cache(
  async (
    collectionId: string,
    limit: number,
    picks: string[],
    // A vendor's landing page: the collection read for that store's products.
    vendorId?: string,
  ): Promise<CollectionShelf | null> => {
    const vendorScope = vendorId ? { vendorId } : {};
    await connectDB();
    const collection = await findShownCollection(collectionId);
    if (!collection) return null;

    // The picks are read THROUGH the collection, so one that left it —
    // removed by hand, no longer matching its rules, unpublished — simply
    // is not in the answer, and its slot goes back to the collection.
    const [{ products }, chosen] = await Promise.all([
      getCollectionProducts(collection, {
        page: 1,
        limit: Math.min(limit, MAX_PRODUCTS),
        publishingChannel: "onlineStore",
        fields: "card",
        ...vendorScope,
      }),
      picks.length > 0
        ? getCollectionProducts(collection, {
            ids: picks,
            page: 1,
            limit: picks.length,
            publishingChannel: "onlineStore",
            fields: "card",
            ...vendorScope,
          })
        : { products: [] },
    ]);
    if (products.length === 0) return null;

    // Slot order is the order they were picked in, not the query's.
    const slot = new Map(picks.map((id, index) => [id, index]));
    const picked = (serializeProductCards(chosen.products) as ModernProduct[]).sort(
      (a, b) => (slot.get(a._id) ?? picks.length) - (slot.get(b._id) ?? picks.length),
    );

    return {
      title: collection.title,
      slug: collection.slug,
      products: serializeProductCards(products) as ModernProduct[],
      picked,
    };
  },
  ["section-featured-collection"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.collections, CACHE_TAGS.products],
  },
);

const readShelfOrNull = withFallback(readCollectionShelf, () => null);

/** A collection picked as a product section's source. */
interface CollectionSource {
  title: string;
  slug: string;
  /** Its first products, in the collection's own order; may be empty. */
  products: ModernProduct[];
}

/**
 * A collection picked as the source of a product shelf (product-grid,
 * product-browser, a product-group tab): its first `limit` products, read
 * exactly as the Featured Collection rows and the collection page read them
 * — the same guards (active, published to the online store), manual or
 * automated, in the collection's own order. Null for a collection the
 * storefront does not show; a shown collection with no products answers an
 * empty list, so the builder can tell the two apart.
 *
 * A failed read throws, like the other shelf loaders.
 */
export const readCollectionSource = unstable_cache(
  async (
    collectionId: string,
    limit: number,
    // A vendor's landing page: that store's products in the collection only.
    vendorId?: string,
  ): Promise<CollectionSource | null> => {
    await connectDB();
    const collection = await findShownCollection(collectionId);
    if (!collection) return null;
    const { products } = await getCollectionProducts(collection, {
      page: 1,
      limit: Math.max(1, Math.min(Math.floor(limit) || 1, MAX_SOURCE_PRODUCTS)),
      publishingChannel: "onlineStore",
      fields: "card",
      ...(vendorId ? { vendorId } : {}),
    });
    return {
      title: collection.title,
      slug: collection.slug,
      products: serializeProductCards(products) as ModernProduct[],
    };
  },
  ["section-product-source-collection"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.collections, CACHE_TAGS.products],
  },
);

/**
 * The shelf for the storefront's sections and the search drawer: a
 * collection that cannot be read is left out, like one that is not shown.
 */
export function fetchCollectionShelf(
  collectionId: string,
  limit: number,
  picks: readonly string[] = [],
) {
  return readShelfOrNull(collectionId, limit, [...picks]);
}

/** One row of the Featured Collection section, as its block stores it. */
export interface CollectionRowEntry {
  collection: string;
  /** Cards beside the panel — the row's shelf size. */
  limit: number;
  /**
   * Products the merchant placed by hand, in slot order — the first sits
   * beside the panel. Slots left over fill from the collection's own order.
   */
  products: string[];
  /** The feature slot: a static image or a saved slider, like a hero cell. */
  kind: "image" | "slider";
  image: string;
  slider: string;
}

/**
 * The Featured Collection section's rows that have something to show: each
 * picked collection's shelf (one product more than the row shows: the first
 * backstops the panel artwork — and that many more again for a row with
 * hand-placed products, see `collectionShelfWindow`), and the sliders and
 * slide prices of the rows whose panel is a saved slider. The cards are
 * `composeCollectionShelf(shelf.products, shelf.picked, row.limit)`.
 */
export async function loadCollectionRows(
  rows: CollectionRowEntry[],
  mode: SectionReadMode = "page",
  // A vendor's landing page: each row reads that store's products, and a
  // slider panel is one of the store's own sliders.
  scope: CellDataScope = {},
) {
  const read = (row: CollectionRowEntry) => {
    if (!row.collection) return Promise.resolve(null);
    const picks = row.products.slice(0, row.limit);
    const window = collectionShelfWindow(row.limit, picks.length);
    return readOr(
      mode,
      () =>
        scope.vendorId
          ? readCollectionShelf(row.collection, window, picks, scope.vendorId)
          : readCollectionShelf(row.collection, window, picks),
      () => null,
    );
  };
  const shelves = await Promise.all(rows.map(read));
  const resolved = rows.flatMap((row, index) => {
    const shelf = shelves[index];
    return shelf ? [{ row, shelf }] : [];
  });
  if (resolved.length === 0) {
    return {
      rows: resolved,
      sliders: new Map<string, ResolvedSlider>(),
      products: new Map<string, SlideProductInfo>(),
    };
  }
  // The feature slots are slider cells — resolve their sliders (and the
  // products their price elements need) exactly like the hero grid does.
  const cells: SliderCellContent[] = resolved.map(({ row }) => ({
    kind: row.kind,
    slider: row.slider,
    image: row.image,
    link: "",
    alt: "",
  }));
  const { sliders, products } = await resolveCellData(cells, mode, scope);
  return { rows: resolved, sliders, products };
}
