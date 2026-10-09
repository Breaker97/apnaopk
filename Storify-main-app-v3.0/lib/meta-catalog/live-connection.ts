import "server-only";

import { afterResponse } from "@/lib/after-response";
import { readMetaCatalog } from "@/lib/meta-catalog/catalog-api";
import { classifyCatalogError, type CatalogFailureKind } from "@/lib/meta-catalog/catalog-errors";
import {
  forgetMetaLiveSyncActive,
  pauseMetaLiveSync,
  readMetaLiveCredentials,
  readMetaLiveState,
  recordMetaCatalogVerified,
  requestMetaCatalogReconcile,
} from "@/lib/meta-catalog/live-state";
import { runMetaCatalogSync } from "@/lib/meta-catalog/sync-worker";
import type { MetaCatalogPauseCode } from "@/models/meta-catalog-feed.model";

/**
 * What the admin page does to the live sync beyond saving: test the
 * connection, and start sending.
 */

export type MetaConnectionTest =
  | { ok: true; catalogName: string }
  | { ok: false; kind: CatalogFailureKind; pauseCode?: MetaCatalogPauseCode; message: string };

/** A run straight after the admin acted, instead of at the next minute. */
export function startMetaCatalogSyncSoon(): void {
  afterResponse(() => runMetaCatalogSync({ budgetMs: 20_000 }));
}

/**
 * Read the catalog's name with the saved catalog id and token. A working test
 * lifts a pause; a token or catalog Meta refuses pauses the sync (with no
 * notification: the admin is looking at the answer).
 */
export async function testMetaCatalogConnection(): Promise<MetaConnectionTest> {
  try {
    const credentials = await readMetaLiveCredentials();
    const catalog = await readMetaCatalog(credentials.catalogId, credentials.token);
    const catalogName = catalog.name || credentials.catalogId;
    await recordMetaCatalogVerified(catalogName);
    return { ok: true, catalogName };
  } catch (error) {
    const failure = classifyCatalogError(error);
    if (failure.kind === "auth") {
      await pauseMetaLiveSync({ code: failure.pauseCode ?? "token", reason: failure.message });
    }
    return {
      ok: false,
      kind: failure.kind,
      pauseCode: failure.pauseCode,
      message: failure.message,
    };
  }
}

/**
 * After a working test, or live sync being switched on: start the full check
 * now rather than at the hour. It sends whatever differs from what this
 * catalog was sent — everything, for a catalog never sent to (a new catalog
 * clears the record, lib/meta-catalog/live-state.ts). `everything` re-sends
 * every item regardless ("Sync everything now").
 */
export async function startMetaCatalogSending(options: { everything?: boolean } = {}): Promise<boolean> {
  forgetMetaLiveSyncActive();
  const state = await readMetaLiveState();
  if (!state.active || state.paused) return false;
  await requestMetaCatalogReconcile({ force: options.everything === true });
  startMetaCatalogSyncSoon();
  return true;
}
