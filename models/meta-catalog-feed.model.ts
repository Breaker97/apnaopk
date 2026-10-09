import { mongoose } from "@/lib/db";
import type { EncryptedSecret } from "@/lib/auth/secret-box";

const { Schema, models, model } = mongoose;

/** How Meta gets the products: the scheduled feed URL, or the Catalog API. */
export type MetaCatalogSource = "feed" | "live";

/** Why live sync stopped, worded by the page. */
export type MetaCatalogPauseCode = "token" | "permission" | "catalog" | "key";

export type MetaCatalogSkipStats = { preorder: number; noImage: number; noPrice: number };

/**
 * The live sync's connection and bookkeeping (lib/meta-catalog/live-state.ts).
 * The token is stored encrypted and never leaves the server: the page is told
 * only that one is saved, and its masked hint.
 */
export interface IMetaCatalogLive {
  catalogId?: string;
  accessToken?: EncryptedSecret;
  tokenHint?: string;
  /** When the catalog id or token last changed. */
  credentialsChangedAt?: Date;
  /** What "Test connection" read the last time it worked. */
  catalogName?: string;
  verifiedAt?: Date;
  /** Set when Meta refused the token or the catalog; cleared by a working test. */
  pausedAt?: Date;
  pauseReason?: string;
  pauseCode?: MetaCatalogPauseCode;
  /** Meta asked us to slow down: no call before this. */
  throttledUntil?: Date;
  throttleCount?: number;
  /** The last items_batch call Meta accepted. */
  lastSyncAt?: Date;
  /** The worker could not run at all (a missing Graph version), and why. */
  lastRunError?: string;
  lastRunErrorAt?: Date;
  /** The walk that heals missed changes (lib/meta-catalog/reconcile.ts). */
  reconcile?: {
    phase?: "products" | "rows";
    cursor?: mongoose.Types.ObjectId;
    startedAt?: Date;
    /** Asked for by a store-wide change or "Sync everything now". */
    requestedAt?: Date;
    /** This walk re-sends every item, whatever its hash says. */
    force?: boolean;
    /** The next walk is to re-send everything ("Sync everything now"). */
    forceRequested?: boolean;
    leaseUntil?: Date;
    stats?: MetaCatalogSkipStats & { itemCount: number };
  };
  lastReconciledAt?: Date;
  lastReconcileStats?: MetaCatalogSkipStats & { itemCount: number };
  /**
   * What the watcher saw on its last run: the store-wide inputs as one hash,
   * and each storefront seller's / brand's name by id. A difference is a
   * change no product write announced.
   */
  watch?: {
    store?: string;
    vendors?: Map<string, string> | Record<string, string>;
    brands?: Map<string, string> | Record<string, string>;
    checkedAt?: Date;
  };
}

/**
 * The Meta (Facebook/Instagram) catalog connection: whether it is on, how
 * Meta gets the products, the secret in the feed URL (also in every picture
 * link the feed and the live sync send), and what Meta saw last.
 *
 * One row (`key: "default"`), in a collection of its own rather than on the
 * settings document: the token is a credential that must never ride along in
 * a settings payload, cache or export, and every fetch writes its outcome here,
 * which must not bump the settings' versions or expire their cache.
 * Read and written through lib/meta-catalog/feed-state.ts and
 * lib/meta-catalog/live-state.ts only.
 */
export interface IMetaCatalogFeed extends mongoose.Document {
  key: "default";
  /** The header switch: Meta gets the products at all. */
  enabled: boolean;
  /** Absent on a row from before live sync existed, which is "feed". */
  source?: MetaCatalogSource;
  /** 32 random bytes, base64url. Absent until the feed is first switched on. */
  token?: string;
  tokenRotatedAt?: Date;
  /** The last fetch that streamed the whole feed. Cleared with a new URL. */
  lastFetchedAt?: Date;
  lastItemCount?: number;
  /** Items left out of that fetch, by reason. */
  lastSkipped?: MetaCatalogSkipStats;
  live?: IMetaCatalogLive;
  updatedBy?: string;
}

const SkipStatsFields = {
  preorder: { type: Number, min: 0, default: 0 },
  noImage: { type: Number, min: 0, default: 0 },
  noPrice: { type: Number, min: 0, default: 0 },
};

const ReconcileStatsSchema = new Schema(
  { itemCount: { type: Number, min: 0, default: 0 }, ...SkipStatsFields },
  { _id: false },
);

const LiveSchema = new Schema<IMetaCatalogLive>(
  {
    catalogId: { type: String, trim: true },
    accessToken: { type: Schema.Types.Mixed },
    tokenHint: { type: String, trim: true },
    credentialsChangedAt: { type: Date },
    catalogName: { type: String, trim: true, maxlength: 300 },
    verifiedAt: { type: Date },
    pausedAt: { type: Date },
    pauseReason: { type: String, maxlength: 1000 },
    pauseCode: { type: String, enum: ["token", "permission", "catalog", "key"] },
    throttledUntil: { type: Date },
    throttleCount: { type: Number, min: 0 },
    lastSyncAt: { type: Date },
    lastRunError: { type: String, maxlength: 1000 },
    lastRunErrorAt: { type: Date },
    reconcile: {
      type: new Schema(
        {
          phase: { type: String, enum: ["products", "rows"] },
          cursor: { type: Schema.Types.ObjectId },
          startedAt: { type: Date },
          requestedAt: { type: Date },
          force: { type: Boolean },
          forceRequested: { type: Boolean },
          leaseUntil: { type: Date },
          stats: { type: ReconcileStatsSchema, default: undefined },
        },
        { _id: false },
      ),
      default: undefined,
    },
    lastReconciledAt: { type: Date },
    lastReconcileStats: { type: ReconcileStatsSchema, default: undefined },
    watch: {
      type: new Schema(
        {
          store: { type: String },
          vendors: { type: Map, of: String },
          brands: { type: Map, of: String },
          checkedAt: { type: Date },
        },
        { _id: false },
      ),
      default: undefined,
    },
  },
  { _id: false },
);

const MetaCatalogFeedSchema = new Schema<IMetaCatalogFeed>(
  {
    key: { type: String, enum: ["default"], default: "default", unique: true },
    enabled: { type: Boolean, default: false },
    source: { type: String, enum: ["feed", "live"] },
    token: { type: String, trim: true },
    tokenRotatedAt: { type: Date },
    lastFetchedAt: { type: Date },
    lastItemCount: { type: Number, min: 0 },
    lastSkipped: {
      type: new Schema(SkipStatsFields, { _id: false }),
      default: undefined,
    },
    live: { type: LiveSchema, default: undefined },
    updatedBy: { type: String, trim: true },
  },
  { timestamps: true, collection: "metacatalogfeeds" },
);

export const MetaCatalogFeed: mongoose.Model<IMetaCatalogFeed> =
  (models.MetaCatalogFeed as mongoose.Model<IMetaCatalogFeed>) ||
  model<IMetaCatalogFeed>("MetaCatalogFeed", MetaCatalogFeedSchema);
