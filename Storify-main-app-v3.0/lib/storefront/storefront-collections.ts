import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import { getCollectionProducts } from "@/lib/catalog/collections";
import { productCardReplacer } from "@/lib/products/storefront-product-cards";
import { Collection } from "@/models";
import type { CollectionSortOrder } from "@/types";

type StorefrontCollectionListQuery = {
  page?: number;
  limit?: number;
  channel?: "onlineStore" | "pointOfSale";
  /** Only collections of this kind; absent lists every kind. */
  kind?: "collection" | "look";
};

/**
 * No location fields, deliberately. A shopper's location is a lens on the
 * storefront rather than a filter (see `getStorefrontProducts`), so it changes
 * nothing about which products a collection contains — and carrying it here
 * would only mint a separate cache entry per place for an identical answer.
 */
type StorefrontCollectionDetailQuery = StorefrontCollectionListQuery & {
  slug: string;
  sort?: CollectionSortOrder;
};

type CollectionChannel = NonNullable<StorefrontCollectionListQuery["channel"]>;

/** The storefront shows an active collection published to its channel. */
const SHOWN_COLLECTION_FILTER = { status: "active" } as const;

function isPublishedTo(
  collection: { publishing?: Partial<Record<CollectionChannel, boolean>> } | null,
  channel: CollectionChannel,
) {
  return Boolean(collection?.publishing?.[channel]);
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && (value || 0) > 0 ? Math.floor(value!) : fallback;
}

function serialize<T>(
  value: T,
  replacer?: (key: string, value: unknown) => unknown,
): T {
  return JSON.parse(JSON.stringify(value, replacer)) as T;
}

export const getStorefrontCollections = unstable_cache(
  async (query: StorefrontCollectionListQuery = {}) => {
    await connectDB();

    const page = normalizePositiveInteger(query.page, 1);
    const limit = Math.min(normalizePositiveInteger(query.limit, 24), 50);
    const publishingChannel = query.channel || "onlineStore";
    const mongoQuery: Record<string, unknown> = {
      status: "active",
      [`publishing.${publishingChannel}`]: true,
    };
    if (query.kind) mongoQuery.kind = query.kind;
    const skip = (page - 1) * limit;

    const [collections, total] = await Promise.all([
      Collection.find(mongoQuery)
        .select("title slug handle description image kind productCount position publishing")
        .sort({ position: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Collection.countDocuments(mongoQuery),
    ]);

    const totalPages = Math.ceil(total / limit);

    return serialize({
      data: collections,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  },
  ["storefront-collections"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.collections],
  },
);

export const getStorefrontCollectionDetail = unstable_cache(
  async (query: StorefrontCollectionDetailQuery) => {
    await connectDB();

    const page = normalizePositiveInteger(query.page, 1);
    const limit = Math.min(normalizePositiveInteger(query.limit, 24), 50);
    const publishingChannel = query.channel || "onlineStore";

    const collection = await Collection.findOne({
      slug: query.slug,
      ...SHOWN_COLLECTION_FILTER,
    }).lean();

    if (!collection || !isPublishedTo(collection, publishingChannel)) {
      return null;
    }

    const { products, total } = await getCollectionProducts(collection, {
      page,
      limit,
      publishingChannel,
      sortOrder: query.sort,
      fields: "card",
    });
    const totalPages = Math.ceil(total / limit);

    return serialize({
      collection: {
        _id: collection._id,
        title: collection.title,
        slug: collection.slug,
        handle: collection.handle,
        description: collection.description,
        descriptionHtml: collection.descriptionHtml,
        image: collection.image,
        seo: collection.seo,
        productCount: total,
      },
      products,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    }, productCardReplacer);
  },
  ["storefront-collection-detail"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.collections, CACHE_TAGS.products],
  },
);

/**
 * Whether the storefront shows the collection at `slug`: the question
 * `getStorefrontCollectionDetail` asks first, asked alone and with the same
 * rule, for the route's 404 (lib/storefront/resource-gate.ts). The detail
 * loader cannot answer it there — it is keyed on the page and sort, which a
 * layout does not receive.
 */
export const isStorefrontCollectionShown = unstable_cache(
  async (slug: string): Promise<boolean> => {
    await connectDB();
    const collection = await Collection.findOne({
      slug,
      ...SHOWN_COLLECTION_FILTER,
    })
      .select("publishing")
      .lean();
    return isPublishedTo(collection, "onlineStore");
  },
  ["storefront-collection-shown"],
  { revalidate: 60, tags: [CACHE_TAGS.collections] },
);
