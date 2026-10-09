"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { POSCategory, POSProduct } from "@/components/pos/pos-types";
import {
  enqueueSale,
  listQueuedSales,
  offlineScope,
  readCatalogSnapshot,
  saveCatalogSnapshot,
  type OfflineSale,
} from "@/lib/pos/offline-db";
import { syncOutbox, type SyncSummary } from "@/lib/pos/offline-sync";
import {
  markPOSAuthenticated,
  readPOSOfflineSession,
  type POSOfflineSessionState,
} from "@/lib/pos/offline-session";
import { useBrowserOnline } from "@/hooks/use-client-value";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { useHydrated } from "@/hooks/use-client-value";

/**
 * Keeps the register sellable through a network outage.
 *
 * Scope note, because it decides what this does and does not attempt: a POS
 * page that is already open survives an outage almost intact — the catalogue
 * was server-rendered into React state and the cart lives in memory, so the
 * grid, the cart and the totals all keep working with no help. What actually
 * breaks is the three places the terminal reaches the network: resolving a
 * scan, refetching the grid on a filter change, and submitting the sale.
 *
 * The service worker also keeps the POS document, so the terminal survives a
 * reload with no connection. That is bounded by the offline session window
 * (`lib/pos/offline-session.ts`): the register locks once too long has passed
 * since the server last authenticated it.
 */

export interface POSOfflineState {
  /**
   * Whether the register can reach the server.
   *
   * Not simply `navigator.onLine`: that reports link state, so the single most
   * common outage at a counter — the shop's router up, the line to the ISP
   * down — reads as "online" and would leave the cashier with no indication
   * anything was wrong until a sale failed. A request that actually failed
   * counts too.
   */
  isOffline: boolean;
  /** Catalogue to resolve scans and filters against while offline. */
  offlineProducts: POSProduct[];
  /** When the snapshot was taken, so stale stock can be shown as stale. */
  snapshotAt: string | null;
  /** Sales taken offline and not yet accepted by the server. */
  queued: OfflineSale[];
  /** Whether the register is still inside its offline session window. */
  session: POSOfflineSessionState;
  /**
   * Whether the terminal must refuse to operate.
   *
   * Deliberately NOT derived from `navigator.onLine`. That flag reports link
   * state, not reachability, and it is the flag this very file warns about — a
   * lock that a lying flag can switch off is not a lock. It engages only after
   * a real authenticated request has been *tried and failed* while the stored
   * session stamp is stale, so a device that cannot reach the server and has
   * not been authenticated for a shift stops being a working till.
   */
  isLocked: boolean;
  /** Queue a sale; throws if this browser cannot store it. */
  queueSale: (sale: OfflineSale) => Promise<void>;
  /** Drain the outbox now. */
  sync: () => Promise<SyncSummary | null>;
  isSyncing: boolean;
}

interface UsePOSOfflineOptions {
  locationId?: string;
  /** The server-rendered first page, used until the full snapshot arrives. */
  initialProducts: POSProduct[];
}

/**
 * How long to wait before trying the server again after a failed probe.
 *
 * Short enough that a counter notices the connection coming back within a
 * customer's patience, long enough not to hammer a server that is genuinely
 * down for the rest of the shift.
 */
const PROBE_RETRY_MS = 30_000;

/** Pages the full catalogue into IndexedDB. Returns what it stored. */
async function pullSnapshot(
  locationId: string | undefined,
  signal: AbortSignal,
): Promise<{ products: POSProduct[]; categories: POSCategory[] } | null> {
  const products: POSProduct[] = [];
  let categories: POSCategory[] = [];
  let cursor: string | undefined;

  // Bounded so a paging bug cannot spin: 40 × 500 covers 20k products, well
  // past what a counter realistically sells from.
  for (let page = 0; page < 40; page += 1) {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (locationId) params.set("locationId", locationId);

    const response = await fetch(
      `/api/pos/offline-catalog?${params.toString()}`,
      { signal, cache: "no-store" },
    );
    if (!response.ok) return null;

    const json = await response.json();
    if (!json?.success) return null;

    products.push(...(json.data.products || []));
    if (page === 0) categories = json.data.categories || [];

    cursor = json.data.nextCursor;
    if (!cursor) break;
  }

  return { products, categories };
}

export function usePOSOffline({
  locationId,
  initialProducts,
}: UsePOSOfflineOptions): POSOfflineState {
  const scope = offlineScope(locationId);

  /** The browser's own claim. Kept separate so the derived answer below
   *  cannot feed back into the effect that produces it. */
  const browserOffline = !useBrowserOnline();
  const [offlineProducts, setOfflineProducts] =
    useState<POSProduct[]>(initialProducts);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [queued, setQueued] = useState<OfflineSale[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [session, setSession] = useState<POSOfflineSessionState>({
    // Assumed valid for the first render so a live terminal never flashes the
    // lock screen; the effect below replaces it with the real answer at once.
    allowed: true,
    remainingMs: 0,
    lastAuthenticatedAt: null,
  });
  /**
   * Whether the server has been reached since this page loaded.
   *
   * `pending` until the first snapshot pull settles, which is what keeps a
   * genuinely online register from flashing the lock screen while its very
   * first request is still in flight.
   */
  const [authProbe, setAuthProbe] = useState<"pending" | "ok" | "failed">(
    "pending",
  );
  /** Bumped to re-run the pull effect after a failed probe. */
  const [probeAttempt, setProbeAttempt] = useState(0);
  const syncingRef = useRef(false);

  const refreshQueue = useCallback(
    () =>
      listQueuedSales(scope).then(
        (sales) => setQueued(sales),
        () => {
          // A browser with no IndexedDB simply has no queue to show; the sale
          // path reports the problem where it matters, at the point of sale.
        },
      ),
    [scope],
  );

  // `navigator.onLine` is the browser's own answer and is famously optimistic —
  // it reports "online" for a connected wifi with no route out. It is used only
  // to switch the UI to its offline shape; whether a request actually works is
  // decided by the request failing, never by this flag.
  useEffect(() => {
    // The link is back; let the next pull decide whether the server is.
    const goOnline = () => setAuthProbe("pending");
    window.addEventListener("online", goOnline);
    return () => window.removeEventListener("online", goOnline);
  }, []);

  // Load whatever the last shift stored, so a terminal that opens straight into
  // an outage still has a catalogue rather than the fifty rows of page one.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await readCatalogSnapshot(scope);
        if (cancelled || !snapshot) return;
        setOfflineProducts(snapshot.products);
        setSnapshotAt(snapshot.savedAt);
      } catch {
        // Falls back to the server-rendered page, which is already loaded.
      }
    })();
    void refreshQueue();
    return () => {
      cancelled = true;
    };
  }, [scope, refreshQueue]);
  // The session lives in localStorage, so it is read once hydrated and again
  // whenever the scope changes.
  const hydrated = useHydrated();
  useApplyOnChange([scope, hydrated], () => {
    if (hydrated) setSession(readPOSOfflineSession(scope));
  });

  // The window can close while the terminal sits open through a long outage,
  // so it is re-read rather than decided once at mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setInterval(
      () => setSession(readPOSOfflineSession(scope)),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, [scope]);

  // Refresh the snapshot whenever the connection is up. Runs on mount and on
  // every reconnect, because the shift's stock has moved in the meantime.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const controller = new AbortController();

    void (async () => {
      try {
        const pulled = await pullSnapshot(locationId, controller.signal);
        if (controller.signal.aborted) return;
        if (!pulled) {
          setAuthProbe("failed");
          return;
        }
        setAuthProbe("ok");

        // The pull is an authenticated server call, so its success is the only
        // honest evidence the session is still good — the page rendering is
        // not, since the service worker renders it from cache too.
        markPOSAuthenticated(scope);
        setSession(readPOSOfflineSession(scope));

        const savedAt = new Date().toISOString();
        setOfflineProducts(pulled.products);
        setSnapshotAt(savedAt);
        await saveCatalogSnapshot({
          scope,
          products: pulled.products,
          categories: pulled.categories,
          savedAt,
        });
      } catch {
        // An abort or a failed pull leaves the previous snapshot in place,
        // which is exactly what it is for. An abort is our own teardown, so it
        // must not be mistaken for the server being unreachable.
        if (!controller.signal.aborted) setAuthProbe("failed");
      }
    })();

    return () => controller.abort();
  }, [browserOffline, locationId, scope, probeAttempt]);

  /**
   * Re-probe after a failure.
   *
   * Without this a single failed pull pins the register: `authProbe` would only
   * ever be reset by a browser `online` event, which never fires when the link
   * was up all along and it was the route out that died — the exact outage this
   * is meant to notice. The register would stay flagged offline for the rest of
   * the shift and, on a device with no session stamp, would lock outright.
   */
  useEffect(() => {
    if (typeof window === "undefined" || authProbe !== "failed") return;
    const timer = window.setTimeout(
      () => setProbeAttempt((n) => n + 1),
      PROBE_RETRY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [authProbe, probeAttempt]);

  const runSync = useCallback((): Promise<SyncSummary | null> => {
    if (syncingRef.current) return Promise.resolve(null);
    syncingRef.current = true;
    return syncOutbox(scope)
      .then(async (summary) => {
        await refreshQueue();
        return summary;
      })
      .catch(() => null)
      .finally(() => {
        syncingRef.current = false;
        setIsSyncing(false);
      });
  }, [scope, refreshQueue]);
  // The banner's button shows the syncing state at once; the auth-probe path
  // below sets it during render.
  const sync = useCallback(() => {
    if (syncingRef.current) return Promise.resolve(null);
    setIsSyncing(true);
    return runSync();
  }, [runSync]);

  /**
   * Drain whenever the server is reachable — on mount, and again the moment a
   * failed probe starts succeeding.
   *
   * Keyed on the probe, NOT on `browserOffline`. Gating the drain on
   * `navigator.onLine` meant that in the one outage this hook is written to
   * survive — the shop's router up, the line to the ISP down — the flag never
   * flipped, so the effect never re-ran and a shift's takings sat in the queue
   * until somebody happened to reload the page. The same flag is untrustworthy
   * here for the same reason it is untrustworthy for the lock.
   */
  useApplyOnChange([authProbe], () => {
    if (authProbe === "ok") setIsSyncing(true);
  });
  useEffect(() => {
    if (authProbe !== "ok") return;
    void runSync();
  }, [authProbe, runSync]);

  const queueSale = useCallback(
    async (sale: OfflineSale) => {
      await enqueueSale(sale);
      await refreshQueue();
    },
    [refreshQueue],
  );

  return {
    isOffline: browserOffline || authProbe === "failed",
    offlineProducts,
    snapshotAt,
    queued,
    session,
    // Locked only on evidence: a request that actually failed, plus a stamp
    // older than the window. "pending" never locks.
    isLocked: authProbe === "failed" && !session.allowed,
    queueSale,
    sync,
    isSyncing,
  };
}
