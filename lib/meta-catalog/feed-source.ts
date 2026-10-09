import "server-only";

import type { Types } from "mongoose";
import { PRODUCT_STATUS } from "@/config/app.config";
import { DEFAULT_CURRENCY, DEFAULT_STORE_NAME } from "@/config/branding.config";
import { appBaseUrl } from "@/lib/app-url";
import { STOREFRONT_BRAND_FILTER } from "@/lib/catalog/brands";
import {
  findStorefrontVendors,
  storefrontProductConstraintFor,
} from "@/lib/catalog/product-visibility";
import { connectDB } from "@/lib/db";
import { buildLocalePath, resolveLocaleRouting } from "@/lib/i18n/locale-prefix";
import { resolveCurrency } from "@/lib/intl/currencies";
import type { MetaCatalogSkipCounts } from "@/lib/meta-catalog/feed-state";
import { FEED_TAIL, renderFeedHead, renderFeedItem } from "@/lib/meta-catalog/feed-xml";
import { createMetaImageLinker } from "@/lib/meta-catalog/images";
import {
  mapProductToMetaItems,
  productImageCandidates,
  type MetaCatalogMapResult,
  type MetaCatalogProductSource,
} from "@/lib/meta-catalog/map-product";
import { Brand, Product } from "@/models";
import { getSettingsLean } from "@/models/settings.model";

/**
 * Where the feed's products come from, read without the page cache: the feed
 * is fetched by Meta, not rendered for a shopper, and the live sync that
 * shares this runs where there is no request cache at all.
 */

export const META_FEED_BATCH_SIZE = 500;

/** Only what the mapper reads; variants and media are the large part. */
export const META_PRODUCT_SELECT = [
  "name",
  "slug",
  "description",
  "shortDescription",
  "status",
  "vendorId",
  "brand",
  "price",
  "comparePrice",
  "priceOnRequest",
  "stock",
  "shipping.isPhysicalProduct",
  "inventory",
  "publishing",
  "preorder",
  "barcode",
  "barcodeFormat",
  "barcodeSource",
  "images",
  "media._id",
  "media.type",
  "media.url",
  "media.mimeType",
  "media.position",
  "options._id",
  "options.name",
  "options.visual",
  "variants._id",
  "variants.name",
  "variants.price",
  "variants.comparePrice",
  "variants.stock",
  "variants.image",
  "variants.mediaId",
  "variants.optionValues",
  "variants.preorder",
  "variants.barcode",
  "variants.barcodeFormat",
  "variants.barcodeSource",
].join(" ");

export type MetaFeedSetup = {
  storeName: string;
  storeDescription: string;
  currency: string;
  /** The language served without a URL prefix. */
  storeDefault: string;
  /** Storefront vendors by id → store name. */
  vendors: Map<string, string>;
};

export async function loadMetaFeedSetup(): Promise<MetaFeedSetup> {
  await connectDB();
  const [settings, vendors] = await Promise.all([
    getSettingsLean(),
    findStorefrontVendors("_id storeName"),
  ]);
  const general = settings?.general;
  return {
    storeName: general?.storeName?.trim() || DEFAULT_STORE_NAME,
    storeDescription: general?.storeDescription?.trim() || "",
    currency: resolveCurrency(general?.defaultCurrency || DEFAULT_CURRENCY).code,
    storeDefault: resolveLocaleRouting(general).storeDefault,
    vendors: new Map(
      vendors.map((vendor) => [
        String(vendor._id),
        typeof vendor.storeName === "string" ? vendor.storeName.trim() : "",
      ]),
    ),
  };
}

/**
 * The products the feed can hold at all. The mapper decides the rest (pre-order,
 * pictures, prices); this only keeps what it would drop from being read.
 */
export function metaFeedProductFilter(
  setup: Pick<MetaFeedSetup, "vendors">,
): Record<string, unknown> {
  return {
    status: PRODUCT_STATUS.ACTIVE,
    // Quote-only products have no price to advertise; the mapper drops them
    // too, this just keeps them from being read.
    priceOnRequest: { $ne: true },
    ...storefrontProductConstraintFor([...setup.vendors.keys()]),
  };
}

/**
 * Every storefront product, oldest id first, a batch at a time. Paged on
 * `_id` rather than skip/limit, so a deep page costs what the first does and
 * a product added mid-run is never read twice. `after` resumes a walk that
 * stopped part-way (the live sync's reconcile).
 */
export async function* metaFeedProductBatches(
  setup: Pick<MetaFeedSetup, "vendors">,
  batchSize = META_FEED_BATCH_SIZE,
  start: Types.ObjectId | null = null,
): AsyncGenerator<MetaCatalogProductSource[]> {
  const filter = metaFeedProductFilter(setup);
  let after: Types.ObjectId | null = start;
  for (;;) {
    const batch: Array<MetaCatalogProductSource & { _id: Types.ObjectId }> =
      await Product.find(after ? { ...filter, _id: { $gt: after } } : filter)
        .sort({ _id: 1 })
        .limit(batchSize)
        .select(META_PRODUCT_SELECT)
        .lean<Array<MetaCatalogProductSource & { _id: Types.ObjectId }>>();
    if (batch.length === 0) return;
    yield batch;
    if (batch.length < batchSize) return;
    after = batch[batch.length - 1]._id;
  }
}

/** Brand names the storefront shows, for the brands one batch uses. */
async function brandNames(
  products: MetaCatalogProductSource[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(products.map((product) => product.brand).filter(Boolean).map(String)),
  ];
  if (ids.length === 0) return new Map();
  const brands = await Brand.find({ _id: { $in: ids }, ...STOREFRONT_BRAND_FILTER })
    .select("name")
    .lean<Array<{ _id: unknown; name?: string }>>();
  return new Map(
    brands
      .filter((brand) => typeof brand.name === "string" && brand.name.trim())
      .map((brand) => [String(brand._id), String(brand.name).trim()]),
  );
}

export type MetaFeedRunStats = {
  itemCount: number;
  skipped: MetaCatalogSkipCounts;
};

export type MetaMappedProduct = {
  product: MetaCatalogProductSource;
  result: MetaCatalogMapResult;
};

/**
 * Maps products as the feed does, a batch at a time: the same links, the same
 * brand names, the same pictures (`token` is the one the picture links carry).
 * The feed and the live sync both map through this, so an item cannot read
 * one way in the feed and another through the Catalog API.
 */
export function createMetaBatchMapper(options: { token: string; setup: MetaFeedSetup }) {
  const { token, setup } = options;
  const linker = createMetaImageLinker(token);
  const base = appBaseUrl();
  const productLink = (slug: string, variantId?: string) => {
    const path = buildLocalePath(
      setup.storeDefault,
      `/products/${encodeURIComponent(slug)}`,
      setup.storeDefault as Parameters<typeof buildLocalePath>[2],
    );
    return `${base}${path}${variantId ? `?variant=${encodeURIComponent(variantId)}` : ""}`;
  };

  return async function mapBatch(
    batch: MetaCatalogProductSource[],
  ): Promise<MetaMappedProduct[]> {
    const [brands] = await Promise.all([
      brandNames(batch),
      linker.prepare(batch.flatMap((product) => productImageCandidates(product))),
    ]);
    return batch.map((product) => ({
      product,
      result: mapProductToMetaItems(product, {
        currency: setup.currency,
        vendors: setup.vendors,
        brands,
        productLink,
        imageLink: linker.imageLink,
      }),
    }));
  };
}

/** Count what a batch left out, by reason, onto `skipped`. */
export function countMetaSkips(
  skipped: MetaCatalogSkipCounts,
  results: Iterable<MetaCatalogMapResult>,
): void {
  for (const result of results) {
    for (const { reason } of result.skipped) {
      if (reason === "preorder") skipped.preorder += 1;
      else if (reason === "no_image") skipped.noImage += 1;
      else skipped.noPrice += 1;
    }
  }
}

/**
 * The whole feed as XML text, a batch of items per chunk. Nothing is held
 * past the batch being written, so memory stays flat however large the
 * catalogue is. The stats arrive through `onComplete` only when the last
 * chunk has been produced; a failure part-way throws instead, so the caller
 * can break the response rather than end a document that is missing items.
 */
export async function* renderMetaFeed(options: {
  token: string;
  setup: MetaFeedSetup;
  batches?: AsyncIterable<MetaCatalogProductSource[]>;
  onComplete?: (stats: MetaFeedRunStats) => Promise<void> | void;
}): AsyncGenerator<string> {
  const { token, setup } = options;
  const base = appBaseUrl();
  const mapBatch = createMetaBatchMapper({ token, setup });
  const stats: MetaFeedRunStats = {
    itemCount: 0,
    skipped: { preorder: 0, noImage: 0, noPrice: 0 },
  };

  yield renderFeedHead({
    title: setup.storeName,
    link: base,
    description: setup.storeDescription || setup.storeName,
  });

  for await (const batch of options.batches ?? metaFeedProductBatches(setup)) {
    const mapped = await mapBatch(batch);
    let chunk = "";
    for (const { result } of mapped) {
      for (const item of result.items) chunk += renderFeedItem(item);
      stats.itemCount += result.items.length;
    }
    countMetaSkips(
      stats.skipped,
      mapped.map(({ result }) => result),
    );
    if (chunk) yield chunk;
  }

  try {
    await options.onComplete?.(stats);
  } catch (error) {
    // What the page reports about the last fetch is not worth failing the
    // fetch over: Meta still gets a complete feed.
    console.error("Meta catalog feed: could not record the fetch", error);
  }
  yield FEED_TAIL;
}
