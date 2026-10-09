import "server-only";

import { decryptSecret, encryptSecret } from "@/lib/auth/secret-box";
import { connectDB, mongoose } from "@/lib/db";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { CatalogConfigError } from "@/lib/meta-catalog/catalog-errors";
import { maskSecretHint } from "@/lib/settings/credentials";
import {
  MetaCatalogFeed,
  type IMetaCatalogLive,
  type MetaCatalogPauseCode,
  type MetaCatalogSkipStats,
  type MetaCatalogSource,
} from "@/models/meta-catalog-feed.model";
import { MetaCatalogBatch } from "@/models/meta-catalog-batch.model";
import { MetaCatalogSync } from "@/models/meta-catalog-sync.model";

/**
 * The live sync's connection: the catalog it writes to, the System User
 * token it writes with (encrypted with META_CATALOG_ENCRYPTION_KEY, which
 * falls back to MESSAGING_ENCRYPTION_KEY), and whether it is paused or being
 * told to slow down. Kept on the Meta catalog row beside the feed's state
 * (models/meta-catalog-feed.model.ts), never on the settings document.
 */

const KEY = { key: "default" } as const;
const SECRET_KEY = "META_CATALOG_ENCRYPTION_KEY" as const;

export type MetaLiveState = {
  enabled: boolean;
  source: MetaCatalogSource;
  /** Switched on, set to live sync, with a catalog and a token saved. */
  active: boolean;
  catalogId: string | null;
  tokenSet: boolean;
  tokenHint: string | null;
  credentialsChangedAt: Date | null;
  catalogName: string | null;
  verifiedAt: Date | null;
  paused: { at: Date; reason: string; code: MetaCatalogPauseCode } | null;
  throttledUntil: Date | null;
  throttleCount: number;
  lastSyncAt: Date | null;
  lastRunError: string | null;
  reconcile: NonNullable<IMetaCatalogLive["reconcile"]> | null;
  lastReconciledAt: Date | null;
  lastReconcileStats: (MetaCatalogSkipStats & { itemCount: number }) | null;
  /** The feed's token: the live sync's picture links carry it too. */
  imageToken: string | null;
};

type Row = {
  enabled?: boolean;
  source?: MetaCatalogSource;
  token?: string;
  live?: IMetaCatalogLive;
};

function toLiveState(row: Row | null | undefined): MetaLiveState {
  const live = row?.live ?? {};
  const source: MetaCatalogSource = row?.source === "live" ? "live" : "feed";
  const enabled = row?.enabled === true;
  const catalogId = live.catalogId?.trim() || null;
  const tokenSet = Boolean(live.accessToken);
  return {
    enabled,
    source,
    active: enabled && source === "live" && Boolean(catalogId) && tokenSet,
    catalogId,
    tokenSet,
    tokenHint: tokenSet ? live.tokenHint || null : null,
    credentialsChangedAt: live.credentialsChangedAt ?? null,
    catalogName: live.catalogName || null,
    verifiedAt: live.verifiedAt ?? null,
    paused: live.pausedAt
      ? {
          at: live.pausedAt,
          reason: live.pauseReason || "",
          code: live.pauseCode || "token",
        }
      : null,
    throttledUntil: live.throttledUntil ?? null,
    throttleCount: live.throttleCount ?? 0,
    lastSyncAt: live.lastSyncAt ?? null,
    lastRunError: live.lastRunError || null,
    reconcile: live.reconcile ?? null,
    lastReconciledAt: live.lastReconciledAt ?? null,
    lastReconcileStats: live.lastReconcileStats ?? null,
    imageToken: row?.token || null,
  };
}

export async function readMetaLiveState(): Promise<MetaLiveState> {
  await connectDB();
  return toLiveState(
    await MetaCatalogFeed.findOne(KEY)
      // Everything but the watcher's lists, which can hold every seller.
      .select("-live.watch")
      .lean<Row>(),
  );
}

/* ---------------------------------------------------------------------------
 * "Is live sync on?" — asked by every product write, so answered from memory
 * for a little while. A store that switches it on misses nothing by the
 * delay: switching on starts a full sync.
 * ------------------------------------------------------------------------- */

const ACTIVE_TTL_MS = 30_000;
let activeCache: { value: boolean; at: number } | null = null;

export function forgetMetaLiveSyncActive(): void {
  activeCache = null;
}

export async function isMetaLiveSyncActive(): Promise<boolean> {
  if (isDemoModeEnabled()) return false;
  if (activeCache && Date.now() - activeCache.at < ACTIVE_TTL_MS) return activeCache.value;
  try {
    await connectDB();
  } catch {
    return false;
  }
  // No database to ask (a unit test with the connection stubbed out): a
  // query now would only wait on Mongoose's buffer and then fail.
  if (mongoose.connection.readyState !== 1) return false;
  const row = await MetaCatalogFeed.findOne(KEY)
    .select("enabled source live.catalogId live.accessToken")
    .lean<Row>();
  const value = toLiveState(row).active;
  activeCache = { value, at: Date.now() };
  return value;
}

/**
 * The catalog and the token in clear, for a call to Meta. A token sealed with
 * a key this server no longer has cannot be read, which only the admin can
 * fix (paste it again), so it pauses the sync like a dead token.
 */
export async function readMetaLiveCredentials(): Promise<{
  catalogId: string;
  token: string;
}> {
  await connectDB();
  const row = await MetaCatalogFeed.findOne(KEY)
    .select("live.catalogId live.accessToken")
    .lean<Row>();
  const catalogId = row?.live?.catalogId?.trim();
  if (!catalogId || !row?.live?.accessToken) {
    throw new CatalogConfigError("No Meta catalog and access token are saved");
  }
  try {
    return { catalogId, token: decryptSecret(row.live.accessToken, SECRET_KEY) };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === "string" && code.endsWith("_NOT_CONFIGURED")) {
      throw new CatalogConfigError(
        "META_CATALOG_ENCRYPTION_KEY (or MESSAGING_ENCRYPTION_KEY) is not set on the server",
        "key",
      );
    }
    throw new CatalogConfigError(
      "The saved access token cannot be read with this server's encryption key. Paste it again.",
      "key",
    );
  }
}

/**
 * Save the catalog id and/or the token. `accessToken` undefined keeps the
 * saved one, null removes it. A different catalog starts over: what the old
 * catalog was sent says nothing about the new one, so every product's record
 * is cleared and pending status checks are dropped.
 */
export async function saveMetaLiveCredentials(input: {
  catalogId: string;
  accessToken?: string | null;
  userId: string;
}): Promise<{
  before: MetaLiveState;
  after: MetaLiveState;
  catalogChanged: boolean;
  tokenChanged: boolean;
}> {
  await connectDB();
  const before = await readMetaLiveState();
  const catalogId = input.catalogId.trim();
  const catalogChanged = catalogId !== (before.catalogId ?? "");
  const tokenChanged = input.accessToken !== undefined;

  const set: Record<string, unknown> = {
    "live.catalogId": catalogId,
    updatedBy: input.userId,
  };
  const unset: Record<string, ""> = {};
  if (typeof input.accessToken === "string") {
    set["live.accessToken"] = encryptSecret(input.accessToken, SECRET_KEY);
    set["live.tokenHint"] = maskSecretHint(input.accessToken) ?? "";
  } else if (input.accessToken === null) {
    unset["live.accessToken"] = "";
    unset["live.tokenHint"] = "";
  }
  if (catalogChanged || tokenChanged) {
    set["live.credentialsChangedAt"] = new Date();
    // What was read with the old pair is no longer known to be true.
    for (const field of ["catalogName", "verifiedAt", "pausedAt", "pauseReason", "pauseCode"]) {
      unset[`live.${field}`] = "";
    }
    unset["live.throttledUntil"] = "";
    unset["live.throttleCount"] = "";
  }
  await MetaCatalogFeed.updateOne(
    KEY,
    {
      $set: set,
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
      $setOnInsert: { ...KEY, enabled: false },
    },
    { upsert: true },
  );

  if (catalogChanged && before.catalogId) {
    await Promise.all([
      MetaCatalogSync.updateMany(
        {},
        { $set: { items: [], itemErrors: [], errorCount: 0, attempts: 0 }, $unset: { lastError: "" } },
      ),
      MetaCatalogBatch.deleteMany({}),
    ]);
  }
  forgetMetaLiveSyncActive();
  return { before, after: await readMetaLiveState(), catalogChanged, tokenChanged };
}

/** "Test connection" worked: what Meta calls the catalog, and the sync may run. */
export async function recordMetaCatalogVerified(catalogName: string): Promise<void> {
  await connectDB();
  await MetaCatalogFeed.updateOne(KEY, {
    $set: { "live.catalogName": catalogName.slice(0, 300), "live.verifiedAt": new Date() },
    $unset: {
      "live.pausedAt": "",
      "live.pauseReason": "",
      "live.pauseCode": "",
      "live.lastRunError": "",
      "live.lastRunErrorAt": "",
    },
  });
}

/**
 * Stop sending until an admin acts. True only for the call that paused it, so
 * a run that meets the same dead token again does not tell anyone twice.
 */
export async function pauseMetaLiveSync(params: {
  code: MetaCatalogPauseCode;
  reason: string;
}): Promise<boolean> {
  await connectDB();
  const result = await MetaCatalogFeed.updateOne(
    { ...KEY, $or: [{ "live.pausedAt": { $exists: false } }, { "live.pausedAt": null }] },
    {
      $set: {
        "live.pausedAt": new Date(),
        "live.pauseReason": params.reason.slice(0, 1000),
        "live.pauseCode": params.code,
      },
    },
  );
  return result.modifiedCount === 1;
}

/** Meta asked us to slow down: nothing goes out before `until`. */
export async function recordMetaThrottle(until: Date, count: number): Promise<void> {
  await connectDB();
  await MetaCatalogFeed.updateOne(KEY, {
    $set: { "live.throttledUntil": until, "live.throttleCount": count },
  });
}

/** A batch Meta took: the sync is moving again. */
export async function recordMetaSyncSuccess(): Promise<void> {
  await connectDB();
  await MetaCatalogFeed.updateOne(KEY, {
    $set: { "live.lastSyncAt": new Date() },
    $unset: {
      "live.throttledUntil": "",
      "live.throttleCount": "",
      "live.lastRunError": "",
      "live.lastRunErrorAt": "",
    },
  });
}

/** The worker could not run at all; the page says why. */
export async function recordMetaRunError(message: string | null): Promise<void> {
  await connectDB();
  await MetaCatalogFeed.updateOne(
    KEY,
    message
      ? { $set: { "live.lastRunError": message.slice(0, 1000), "live.lastRunErrorAt": new Date() } }
      : { $unset: { "live.lastRunError": "", "live.lastRunErrorAt": "" } },
  );
}

/**
 * Ask for the walk that compares every product with what Meta was sent
 * (lib/meta-catalog/reconcile.ts) to start on the next run instead of at the
 * hour. `force` re-sends every item, whatever its hash says. A no-op unless
 * live sync is on.
 */
export async function requestMetaCatalogReconcile(options: { force?: boolean } = {}): Promise<void> {
  try {
    if (!(await isMetaLiveSyncActive())) return;
    await MetaCatalogFeed.updateOne(KEY, {
      $set: {
        "live.reconcile.requestedAt": new Date(),
        ...(options.force ? { "live.reconcile.forceRequested": true } : {}),
      },
    });
  } catch (error) {
    console.error("Meta catalog: could not ask for a full check", error);
  }
}
