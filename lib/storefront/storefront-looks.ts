import { unstable_cache } from "next/cache";
import { type ModernProduct } from "@/lib/products/modern-product";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { getCollectionProducts } from "@/lib/catalog/collections";
import { serializeProductCards } from "@/lib/products/storefront-product-cards";
import { connectDB } from "@/lib/db";
import { Collection } from "@/models";
import type { ICollection } from "@/types";

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
}

const LOOK_SELECT = "_id title slug image kind status publishing";
const MAX_LOOKS = 12;
const MAX_LOOK_PIECES = 12;

type LeanCollection = Pick<
  ICollection,
  "_id" | "title" | "slug" | "image" | "kind" | "status" | "publishing"
> & { products?: unknown; conditions?: unknown; conditionMatch?: unknown };

/** A Look with no picture of its own is dressed by its first piece. */
async function leadProductImage(collection: LeanCollection): Promise<string> {
  try {
    const { products } = await getCollectionProducts(
      collection as unknown as ICollection,
      { page: 1, limit: 1, publishingChannel: "onlineStore", fields: "card" },
    );
    const [lead] = serializeProductCards(products) as ModernProduct[];
    return lead?.images?.[0] ?? "";
  } catch {
    return "";
  }
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
export const getStorefrontLooks = unstable_cache(
  async (query: { limit: number; ids?: string[] }): Promise<StorefrontLook[]> => {
    try {
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
    } catch {
      return [];
    }
  },
  ["storefront-looks"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.collections, CACHE_TAGS.products],
  },
);

export interface StorefrontLookDetail extends StorefrontLook {
  products: ModernProduct[];
}

/**
 * One Look with its pieces, by collection id (the admin picker stores the
 * stable id). Any collection qualifies — the section is the styling, the
 * `look` kind only decides what the automatic Looks row lists.
 */
export const getStorefrontLook = unstable_cache(
  async (collectionId: string, limit: number): Promise<StorefrontLookDetail | null> => {
    try {
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
    } catch {
      return null;
    }
  },
  ["storefront-look"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.collections, CACHE_TAGS.products],
  },
);
