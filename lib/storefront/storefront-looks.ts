import { unstable_cache } from "next/cache";
import { type ModernProduct } from "@/lib/products/modern-product";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { getCollectionProducts } from "@/lib/catalog/collections";
import { serializeProductCards } from "@/lib/products/storefront-product-cards";
import { connectDB } from "@/lib/db";
import { Collection } from "@/models";
import type { ICollection } from "@/types";
import { withFallback } from "@/lib/storefront/cached-read";

/**
 * Looks — outfits merchandised as collections.
 *
 * A Look IS a collection (`kind: "look"`): a title, a campaign image, and
 * the pieces in it, edited on the ordinary Collections screen. These
 * readers are what the Get the Look and Looks sections draw from. Same
 * guards as every storefront collection reader: active, published to the
 * online store.
 */

export interface StorefrontLook {
  id: string;
  title: string;
  slug: string;
  /** The Look's own image, else its lead product's — never empty here. */
  image: string;
  /** Where the Look opens; its collection page when unset. */
  href?: string;
}

const LOOK_SELECT = "_id title slug image kind status publishing";
const MAX_LOOKS = 12;
const MAX_LOOK_PIECES = 12;

type LeanCollection = Pick<
  ICollection,
  "_id" | "title" | "slug" | "image" | "kind" | "status" | "publishing"
> & { products?: unknown; conditions?: unknown; conditionMatch?: unknown };

/**
 * A Look with no picture of its own is dressed by its first piece. A failed
 * read is not a Look without a picture: it fails the whole cached read, so a
 * database blip is never stored as a row with Looks missing.
 */
async function leadProductImage(collection: LeanCollection): Promise<string> {
  const { products } = await getCollectionProducts(
    collection as unknown as ICollection,
    { page: 1, limit: 1, publishingChannel: "onlineStore", fields: "card" },
  );
  const [lead] = serializeProductCards(products) as ModernProduct[];
  return lead?.images?.[0] ?? "";
}

async function toLooks(collections: LeanCollection[]): Promise<StorefrontLook[]> {
  const images = await Promise.all(
    collections.map((collection) =>
      collection.image?.url
        ? Promise.resolve(collection.image.url)
        : leadProductImage(collection),
    ),
  );
  return collections.flatMap((collection, index) => {
    const image = images[index];
    // A Look without any picture has nothing to show in a row of pictures.
    if (!image) return [];
    return [
      {
        id: String(collection._id),
        title: collection.title,
        slug: collection.slug,
        image,
      },
    ];
  });
}

/**
 * The store's Looks, in the merchant's collection order. `ids` (a hand-pick)
 * wins over the automatic source and keeps the given order; any collection
 * may be picked by hand, not only one marked as a Look.
 */
export const readStorefrontLooks = unstable_cache(
  async (query: { limit: number; ids?: string[] }): Promise<StorefrontLook[]> => {
    await connectDB();
    const limit = Math.min(Math.max(1, Math.floor(query.limit)), MAX_LOOKS);
    const ids = (query.ids ?? []).filter(Boolean);
    const base = { status: "active", "publishing.onlineStore": true };

    if (ids.length > 0) {
      const collections = (await Collection.find({ ...base, _id: { $in: ids } })
        .select(LOOK_SELECT)
        .lean()) as unknown as LeanCollection[];
      const order = new Map(ids.map((id, index) => [id, index]));
      return toLooks(
        collections
          .sort(
            (a, b) =>
              (order.get(String(a._id)) ?? Number.MAX_SAFE_INTEGER) -
              (order.get(String(b._id)) ?? Number.MAX_SAFE_INTEGER),
          )
          .slice(0, limit),
      );
    }

    const collections = (await Collection.find({ ...base, kind: "look" })
      .select(LOOK_SELECT)
      .sort({ position: 1, createdAt: -1 })
      .limit(limit)
      .lean()) as unknown as LeanCollection[];
    return toLooks(collections);
  },
  ["storefront-looks"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.collections, CACHE_TAGS.products],
  },
);

/** The storefront's reader: a failed read shows no Looks rather than an error. */
export const getStorefrontLooks = withFallback(readStorefrontLooks, () => []);

interface StorefrontLookDetail extends StorefrontLook {
  products: ModernProduct[];
}

/**
 * One Look with its pieces, by collection id (the admin picker stores the
 * stable id). Any collection qualifies — the section is the styling, the
 * `look` kind only decides what the automatic Looks row lists.
 */
export const readStorefrontLook = unstable_cache(
  async (collectionId: string, limit: number): Promise<StorefrontLookDetail | null> => {
    await connectDB();
    const collection = (await Collection.findOne({
      _id: collectionId,
      status: "active",
    }).lean()) as unknown as (LeanCollection & ICollection) | null;
    if (!collection || !collection.publishing?.onlineStore) return null;

    const { products } = await getCollectionProducts(collection, {
      page: 1,
      limit: Math.min(Math.max(1, Math.floor(limit)), MAX_LOOK_PIECES),
      publishingChannel: "onlineStore",
      fields: "card",
    });
    if (products.length === 0) return null;
    const cards = serializeProductCards(products) as ModernProduct[];
    const image = collection.image?.url || cards[0]?.images?.[0] || "";
    if (!image) return null;

    return {
      id: String(collection._id),
      title: collection.title,
      slug: collection.slug,
      image,
      products: cards,
    };
  },
  ["storefront-look"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.collections, CACHE_TAGS.products],
  },
);

/** The storefront's reader: a failed read shows no Look rather than an error. */
export const getStorefrontLook = withFallback(readStorefrontLook, () => null);

/**
 * Vendor landing pages. Looks are the marketplace's collections, so a store
 * shows only the Looks holding its own products, and only those products:
 * the pieces, the "lead product" picture and Add All to Cart never reach
 * another store's goods. Each Look opens the store's own Products tab
 * filtered to it.
 */

/** How many Looks the automatic row weighs for a store's products. */
const MAX_VENDOR_LOOK_CANDIDATES = 50;

async function vendorLookImage(
  collection: LeanCollection,
  vendorId: string,
): Promise<string | null> {
  const { products } = await getCollectionProducts(
    collection as unknown as ICollection,
    {
      page: 1,
      limit: 1,
      publishingChannel: "onlineStore",
      fields: "card",
      vendorId,
    },
  );
  const [lead] = serializeProductCards(products) as ModernProduct[];
  // None of the store's products in it: not one of the store's Looks.
  if (!lead) return null;
  return collection.image?.url || lead.images?.[0] || "";
}

export const getVendorStorefrontLooks = withFallback(
  unstable_cache(
    async (query: {
      vendorId: string;
      limit: number;
      ids?: string[];
    }): Promise<Omit<StorefrontLook, "href">[]> => {
      await connectDB();
      const limit = Math.min(Math.max(1, Math.floor(query.limit)), MAX_LOOKS);
      const ids = (query.ids ?? []).filter(Boolean);
      const base = { status: "active", "publishing.onlineStore": true };

      let candidates: LeanCollection[];
      if (ids.length > 0) {
        const collections = (await Collection.find({ ...base, _id: { $in: ids } })
          .select(LOOK_SELECT)
          .lean()) as unknown as LeanCollection[];
        const order = new Map(ids.map((id, index) => [id, index]));
        candidates = collections.sort(
          (a, b) =>
            (order.get(String(a._id)) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(String(b._id)) ?? Number.MAX_SAFE_INTEGER),
        );
      } else {
        candidates = (await Collection.find({ ...base, kind: "look" })
          .select(LOOK_SELECT)
          .sort({ position: 1, createdAt: -1 })
          .limit(MAX_VENDOR_LOOK_CANDIDATES)
          .lean()) as unknown as LeanCollection[];
      }

      const images = await Promise.all(
        candidates.map((collection) => vendorLookImage(collection, query.vendorId)),
      );
      return candidates
        .flatMap((collection, index) => {
          const image = images[index];
          if (!image) return [];
          return [
            {
              id: String(collection._id),
              title: collection.title,
              slug: collection.slug,
              image,
            },
          ];
        })
        .slice(0, limit);
    },
    ["storefront-looks-vendor"],
    {
      revalidate: 60,
      tags: [CACHE_TAGS.collections, CACHE_TAGS.products],
    },
  ),
  () => [],
);

/** One Look on a vendor's landing page: the store's own pieces in it only. */
export const getVendorStorefrontLook = withFallback(
  unstable_cache(
    async (
      collectionId: string,
      limit: number,
      vendorId: string,
    ): Promise<StorefrontLookDetail | null> => {
      await connectDB();
      const collection = (await Collection.findOne({
        _id: collectionId,
        status: "active",
      }).lean()) as unknown as (LeanCollection & ICollection) | null;
      if (!collection || !collection.publishing?.onlineStore) return null;

      const { products } = await getCollectionProducts(collection, {
        page: 1,
        limit: Math.min(Math.max(1, Math.floor(limit)), MAX_LOOK_PIECES),
        publishingChannel: "onlineStore",
        fields: "card",
        vendorId,
      });
      if (products.length === 0) return null;
      const cards = serializeProductCards(products) as ModernProduct[];
      const image = collection.image?.url || cards[0]?.images?.[0] || "";
      if (!image) return null;

      return {
        id: String(collection._id),
        title: collection.title,
        slug: collection.slug,
        image,
        products: cards,
      };
    },
    ["storefront-look-vendor"],
    {
      revalidate: 60,
      tags: [CACHE_TAGS.collections, CACHE_TAGS.products],
    },
  ),
  () => null,
);
