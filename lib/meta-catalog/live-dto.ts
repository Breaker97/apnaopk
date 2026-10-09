import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { readMetaLiveState, type MetaLiveState } from "@/lib/meta-catalog/live-state";
import { Product } from "@/models";
import type { MetaCatalogPauseCode } from "@/models/meta-catalog-feed.model";
import { MetaCatalogSync } from "@/models/meta-catalog-sync.model";

/**
 * What Settings → Meta catalog is told about the live sync. Never the token:
 * whether one is saved, and its masked hint.
 */
export type MetaCatalogLiveDto = {
  catalogId: string | null;
  tokenSet: boolean;
  tokenHint: string | null;
  catalogName: string | null;
  verifiedAt: string | null;
  paused: { at: string; reason: string; code: MetaCatalogPauseCode } | null;
  throttledUntil: string | null;
  lastSyncAt: string | null;
  lastRunError: string | null;
  /** Products with a change not yet at Meta. */
  waiting: number;
  /** Items Meta refused. */
  rejected: number;
  /** Products whose sends keep failing as a whole (three tries or more). */
  failing: number;
  /** The full check is running or about to. */
  checking: boolean;
  lastCheckedAt: string | null;
  /** Items the last full check left out, by reason. */
  skipped: { preorder: number; noImage: number; noPrice: number } | null;
  /** The server can hold a token at all (an encryption key is set). */
  canStoreToken: boolean;
  /** META_GRAPH_API_VERSION is set. */
  graphVersionSet: boolean;
};

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

function keySet(name: string): boolean {
  return (process.env[name]?.length ?? 0) >= 32;
}

export async function toMetaCatalogLiveDto(state?: MetaLiveState): Promise<MetaCatalogLiveDto> {
  await connectDB();
  const live = state ?? (await readMetaLiveState());
  const [waiting, rejected, failing] = await Promise.all([
    MetaCatalogSync.countDocuments({ $or: [{ dirty: true }, { leaseUntil: { $exists: true } }] }),
    MetaCatalogSync.aggregate<{ total: number }>([
      { $match: { errorCount: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: "$errorCount" } } },
    ]).then((rows) => rows[0]?.total ?? 0),
    MetaCatalogSync.countDocuments({ attempts: { $gte: 3 } }),
  ]);
  const stats = live.lastReconcileStats;
  return {
    catalogId: live.catalogId,
    tokenSet: live.tokenSet,
    tokenHint: live.tokenHint,
    catalogName: live.catalogName,
    verifiedAt: iso(live.verifiedAt),
    paused: live.paused
      ? { at: iso(live.paused.at)!, reason: live.paused.reason, code: live.paused.code }
      : null,
    throttledUntil:
      live.throttledUntil && live.throttledUntil.getTime() > Date.now()
        ? iso(live.throttledUntil)
        : null,
    lastSyncAt: iso(live.lastSyncAt),
    lastRunError: live.lastRunError,
    waiting,
    rejected,
    failing,
    checking: Boolean(live.reconcile?.phase || live.reconcile?.requestedAt),
    lastCheckedAt: iso(live.lastReconciledAt),
    skipped: stats
      ? { preorder: stats.preorder ?? 0, noImage: stats.noImage ?? 0, noPrice: stats.noPrice ?? 0 }
      : null,
    canStoreToken: keySet("META_CATALOG_ENCRYPTION_KEY") || keySet("MESSAGING_ENCRYPTION_KEY"),
    graphVersionSet: /^v\d+\.\d+$/.test(process.env.META_GRAPH_API_VERSION?.trim() ?? ""),
  };
}

export type MetaCatalogRejectedProduct = {
  productId: string;
  name: string;
  /** Where the admin fixes it. */
  editPath: string;
  problems: Array<{
    itemId: string;
    /** The variant's name; null for the product's own item. */
    variant: string | null;
    /** Meta's reason; empty when Meta gave none. */
    message: string;
  }>;
  /** The product's send keeps failing as a whole, and why. */
  failing: string | null;
};

/**
 * The products Meta refused something of, newest first — and those whose
 * sends keep failing as a whole. Only these: a product Meta took is not
 * listed.
 */
export async function listMetaCatalogRejected(params: {
  page: number;
  pageSize: number;
}): Promise<{ rows: MetaCatalogRejectedProduct[]; total: number }> {
  await connectDB();
  const filter = { $or: [{ errorCount: { $gt: 0 } }, { attempts: { $gte: 3 } }] };
  const [rows, total] = await Promise.all([
    MetaCatalogSync.find(filter)
      .sort({ lastErrorAt: -1, updatedAt: -1, _id: 1 })
      .skip((params.page - 1) * params.pageSize)
      .limit(params.pageSize)
      .select("productId itemErrors attempts lastError")
      .lean<
        Array<{
          productId: Types.ObjectId;
          itemErrors?: Array<{ itemId: string; message: string }>;
          attempts?: number;
          lastError?: string;
        }>
      >(),
    MetaCatalogSync.countDocuments(filter),
  ]);
  const products = await Product.find({ _id: { $in: rows.map((row) => row.productId) } })
    .select("name variants._id variants.name variants.optionValues")
    .lean<
      Array<{
        _id: Types.ObjectId;
        name?: string;
        variants?: Array<{ _id?: unknown; name?: string; optionValues?: Array<{ value?: string }> }>;
      }>
    >();
  const byId = new Map(products.map((product) => [String(product._id), product]));

  return {
    total,
    rows: rows.map((row) => {
      const product = byId.get(String(row.productId));
      const variantName = (itemId: string) => {
        const variant = product?.variants?.find((entry) => String(entry._id) === itemId);
        if (!variant) return null;
        const label =
          variant.name?.trim() ||
          (variant.optionValues ?? [])
            .map((option) => option.value?.trim())
            .filter(Boolean)
            .join(" / ");
        return label || null;
      };
      return {
        productId: String(row.productId),
        name: product?.name?.trim() || String(row.productId),
        editPath: `/admin/products/${String(row.productId)}/edit`,
        problems: (row.itemErrors ?? []).map((entry) => ({
          itemId: entry.itemId,
          variant: variantName(entry.itemId),
          message: entry.message ?? "",
        })),
        failing: (row.attempts ?? 0) >= 3 ? row.lastError || null : null,
      };
    }),
  };
}
