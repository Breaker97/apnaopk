import "server-only";

import { createHash } from "node:crypto";
import { appBaseUrl } from "@/lib/app-url";
import { STOREFRONT_BRAND_FILTER } from "@/lib/catalog/brands";
import { connectDB } from "@/lib/db";
import type { MetaFeedSetup } from "@/lib/meta-catalog/feed-source";
import {
  markBrandProductsForCatalogSync,
  markVendorProductsForCatalogSync,
} from "@/lib/meta-catalog/sync-marks";
import { getStorageConfig } from "@/lib/storage";
import { Brand } from "@/models";
import { MetaCatalogFeed } from "@/models/meta-catalog-feed.model";

/**
 * The changes that reach Meta without any product being written.
 *
 * A product's items also carry its seller's name (brand fallback,
 * `custom_label_0`), its brand's name, whether its seller is on the
 * storefront at all, the store currency, and picture and page links built
 * from the storage settings, the feed token and the site address. Those
 * change in some twenty places — an admin's approval, a Stripe webhook, a
 * plan lapsing while a page renders, a brand import, the install wizard —
 * none of which writes a product.
 *
 * So instead of a call in each, every worker run compares what it sees now
 * with what it saw last: the storefront sellers by name, the storefront
 * brands by name, and the store-wide inputs as one hash. A seller or brand
 * that appeared, went or was renamed has its products marked; a store-wide
 * change asks for the full check. Nothing is compared on the first run — the
 * full sync that starts live sync covers it.
 */

const KEY = { key: "default" } as const;

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 12);
}

/** The store-wide inputs every item is built from. */
async function storeDigest(setup: MetaFeedSetup, imageToken: string | null): Promise<string> {
  const storage = await getStorageConfig().catch(() => null);
  return shortHash(
    JSON.stringify([
      setup.currency,
      appBaseUrl(),
      imageToken ?? "",
      storage?.provider ?? "",
      storage?.publicUrl ?? "",
      storage?.endpoint ?? "",
      storage?.bucketName ?? "",
      storage?.region ?? "",
    ]),
  );
}

function asRecord(value: unknown): Record<string, string> {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value) as Record<string, string>;
  return value as Record<string, string>;
}

function changedKeys(before: Record<string, string>, after: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => before[key] !== after[key]);
}

export type WatchOutcome = {
  first: boolean;
  vendors: number;
  brands: number;
  store: boolean;
};

export async function watchMetaCatalogInputs(
  setup: MetaFeedSetup,
  imageToken: string | null,
): Promise<WatchOutcome> {
  await connectDB();
  const [row, brands, store] = await Promise.all([
    MetaCatalogFeed.findOne(KEY)
      .select("live.watch")
      .lean<{ live?: { watch?: { store?: string; vendors?: unknown; brands?: unknown } } }>(),
    Brand.find(STOREFRONT_BRAND_FILTER)
      .select("_id name")
      .lean<Array<{ _id: unknown; name?: string }>>(),
    storeDigest(setup, imageToken),
  ]);

  const vendorsNow: Record<string, string> = {};
  for (const [id, name] of setup.vendors) vendorsNow[id] = shortHash(name);
  const brandsNow: Record<string, string> = {};
  for (const brand of brands) {
    brandsNow[String(brand._id)] = shortHash(typeof brand.name === "string" ? brand.name.trim() : "");
  }

  const previous = row?.live?.watch;
  const outcome: WatchOutcome = { first: !previous?.store, vendors: 0, brands: 0, store: false };

  if (previous?.store) {
    const vendorChanges = changedKeys(asRecord(previous.vendors), vendorsNow);
    const brandChanges = changedKeys(asRecord(previous.brands), brandsNow);
    outcome.vendors = vendorChanges.length;
    outcome.brands = brandChanges.length;
    outcome.store = previous.store !== store;

    // Sent on the next round, not after the usual two minutes: these are
    // single admin decisions, not bursts.
    for (const id of vendorChanges) await markVendorProductsForCatalogSync(id, { delayMs: 0 });
    for (const id of brandChanges) await markBrandProductsForCatalogSync(id, { delayMs: 0 });
    if (outcome.store) {
      await MetaCatalogFeed.updateOne(KEY, {
        $set: { "live.reconcile.requestedAt": new Date() },
      });
    }
  }

  if (outcome.first || outcome.vendors || outcome.brands || outcome.store) {
    await MetaCatalogFeed.updateOne(KEY, {
      $set: {
        "live.watch": {
          store,
          vendors: vendorsNow,
          brands: brandsNow,
          checkedAt: new Date(),
        },
      },
    });
  }
  return outcome;
}
