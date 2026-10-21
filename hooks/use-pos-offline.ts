"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { POSCategory, POSProduct } from "@/components/pos/pos-types";
import {
  enqueueSale,
  listAllQueuedSales,
  offlineScope,
  readCatalogSnapshot,
  removeQueuedSale,
  saveCatalogSnapshot,
  type OfflineSale,
} from "@/lib/pos/offline-db";
import {
  requeueSale,
  syncOutbox,
  type SyncSummary,
} from "@/lib/pos/offline-sync";
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
 *
 * Reachability is decided by EVIDENCE, never by `navigator.onLine`: a request
 * that succeeded, or one that failed to arrive. This hook's own catalogue
 * probe is one source of that evidence; the terminal's own requests are the
 * other (`reportReachable` / `reportUnreachable`), because in the outage this
 * is written for — the shop's router up, the line to the ISP down — the only
 * request that ever fails is the one the cashier just made.
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
  /**
   * Sales taken offline and not yet accepted by the server — from EVERY
   * counter this browser has sold at, not only the one the register stands at.
   * The drain sends them all (`syncOutbox`), so nothing a cashier can see
   * here is ever parked somewhere they cannot.
   */
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
  /**
   * The server answered, and said this session may not use the register —
   * signed out, or the seat's POS access withdrawn. Queued sales stay saved;
   * signing in again sends them.
   */
  sessionExpired: boolean;
  /** Queue a sale; throws if this browser cannot store it. */
  queueSale: (sale: OfflineSale) => Promise<void>;
  /** Drain the outbox now. */
  sync: () => Promise<SyncSummary | null>;
  isSyncing: boolean;
  /**
   * The terminal's own request never reached the server. Flips the register
   * to offline and starts probing for the connection to come back.
   */
  reportUnreachable: () => void;
  /**
   * One of the terminal's own authenticated requests succeeded. Renews the
   * offline session window and, if the register thought it was offline,
   * brings it back and drains the queue.
   */
  reportReachable: () => void;
  /** Send a reviewed sale again, after whatever refused it has been fixed. */
  retrySale: (clientRequestId: string) => Promise<void>;
  /** Forget a reviewed sale that has been recorded by hand. */
  discardSale: (clientRequestId: string) => Promise<void>;
}

interface UsePOSOfflineOptions {
  locationId?: string;
  /** The server-rendered first page, used until the full snapshot arrives. */
  initialProducts: POSProduct[];
  /** How long to wait before trying the server again after a failed probe. */
  probeRetryMs?: number;
  /** How old the snapshot may get, while online, before it is pulled again. */
  snapshotRefreshMs?: number;
  /**
   * How long the register may sell offline after the server last
   * authenticated it — the store's Settings → POS window, already resolved
   * to milliseconds (`offlineSessionWindowMs`). Defaults to twelve hours.
   */
  sessionWindowMs?: number;
  /** How long to wait before sending again after the server asked for time. */
  throttleRetryMs?: number;
}

/**
 * How long to wait before trying the server again after a failed probe.
 *
 * Short enough that a counter notices the connection coming back within a
 * customer's patience, long enough not to hammer a server that is genuinely
 * down for the rest of the shift.
 */
const PROBE_RETRY_MS = 30_000;

/**
 * How old the snapshot may get while the register is online.
 *
 * The snapshot used to be pulled at mount and on reconnect only, and the
 * offline session stamp with it. A register left open all day — the normal
 * life of a till — therefore went into its first outage with the morning's
 * stock and a stamp older than the session window, and locked the moment it
 * was needed. Fifteen minutes keeps both fresh and, at one request per 500
 * products, stays well inside the catalogue route's budget for even a large
 * store. The check runs every minute and on the tab coming back into view,
 * because a tablet that slept overnight has no interval to catch up with.
 */
const SNAPSHOT_REFRESH_MS = 15 * 60_000;
const REFRESH_CHECK_MS = 60_000;

/**
 * How long to wait after a 429 before trying again.
 *
 * A 429 is the server answering — reachable, and signed in, since the limit
 * is counted after the session check — so it must never read as "Offline".
 * It only means "not this minute". A minute is long enough not to keep
 * knocking and short enough that the queue is not left for a whole window.
 */
const THROTTLE_RETRY_MS = 60_000;

/**
 * What the server has most recently said about this register.
 *
 * `pending` until the first probe settles, which is what keeps a genuinely
 * online register from flashing the lock screen while its very first request
 * is still in flight. `unauthenticated` is reachable-but-refused: the session
 * expired, or the seat lost the register. It is probed again like `failed`,
 * so a sign-in in another tab brings the register back on its own.
 */
type AuthProbe = "pending" | "ok" | "failed" | "unauthenticated";

type SnapshotPull =
  | { ok: true; products: POSProduct[]; categories: POSCategory[] }
  | { ok: false; status?: number };

/** The answers that come from the server refusing the SESSION. */
function isSessionRefusal(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

/** Pages the full catalogue into IndexedDB. Returns what it stored. */
async function pullSnapshot(
  locationId: string | undefined,
  signal: AbortSignal,
): Promise<SnapshotPull> {
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
    if (!response.ok) return { ok: false, status: response.status };

    const json = await response.json();
    if (!json?.success) return { ok: false, status: response.status };

    products.push(...(json.data.products || []));
    if (page === 0) categories = json.data.categories || [];

    cursor = json.data.nextCursor;
    if (!cursor) break;
  }

  return { ok: true, products, categories };
}

export function usePOSOffline({
  locationId,
  initialProducts,
  probeRetryMs = PROBE_RETRY_MS,
  snapshotRefreshMs = SNAPSHOT_REFRESH_MS,
  sessionWindowMs,
  throttleRetryMs = THROTTLE_RETRY_MS,
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
  const [authProbe, setAuthProbe] = useState<AuthProbe>("pending");
  /** Bumped to re-run the pull effect: after a failed probe, or to refresh. */
  const [probeAttempt, setProbeAttempt] = useState(0);
  /** When the last snapshot pull STARTED, so a slow pull is not restarted. */
  const lastPullAtRef = useRef(0);
  const syncingRef = useRef(false);
  /**
   * The last drain stopped because the server asked for time. Cleared, and
   * the drain retried, after `throttleRetryMs`.
   */
  const [drainThrottled, setDrainThrottled] = useState(false);

  const refreshQueue = useCallback(
    () =>
      listAllQueuedSales().then(
        (sales) => setQueued(sales),
        () => {
          // A browser with no IndexedDB simply has no queue to show; the sale
          // path reports the problem where it matters, at the point of sale.
        },
      ),
    [],
  );

  const runSync = useCallback((): Promise<SyncSummary | null> => {
    if (syncingRef.current) return Promise.resolve(null);
    syncingRef.current = true;
    return syncOutbox()
      .then(async (summary) => {
        // The server answered and said the session is gone. Surfaced, rather
        // than left as a number nobody read: the cashier has to sign in again
        // before the takings move, and nothing else would tell them.
        if (summary.stoppedUnauthenticated) setAuthProbe("unauthenticated");
        // The line dropped mid-drain: the register is offline again, and the
        // retry probe is what brings the rest of the queue home.
        if (summary.halted === "offline") setAuthProbe("failed");
        if (summary.halted === "throttled") setDrainThrottled(true);
        await refreshQueue();
        return summary;
      })
      .catch(() => null)
      .finally(() => {
        syncingRef.current = false;
        setIsSyncing(false);
      });
  }, [refreshQueue]);

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
  useApplyOnChange([scope, hydrated, sessionWindowMs], () => {
    if (hydrated) setSession(readPOSOfflineSession(scope, sessionWindowMs));
  });

  // The window can close while the terminal sits open through a long outage,
  // so it is re-read rather than decided once at mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setInterval(
      () => setSession(readPOSOfflineSession(scope, sessionWindowMs)),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, [scope, sessionWindowMs]);

  // Pull the snapshot: on mount, on every reconnect (the shift's stock has
  // moved in the meantime), after a failed probe, and on the refresh timer.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const controller = new AbortController();
    lastPullAtRef.current = Date.now();

    void (async () => {
      try {
        const pulled = await pullSnapshot(locationId, controller.signal);
        if (controller.signal.aborted) return;
        if (!pulled.ok && pulled.status === 429) {
          // Reached and signed in — the limit is counted after the session
          // check — but asked to wait. It used to read as "failed", which put
          // a working till under an "Offline" banner and printed provisional
          // receipts for sales the server would have taken. The previous
          // snapshot stays, the session is renewed, and the pull is tried
          // again a minute from now instead of a full refresh interval.
          markPOSAuthenticated(scope);
          setSession(readPOSOfflineSession(scope, sessionWindowMs));
          lastPullAtRef.current =
            Date.now() - snapshotRefreshMs + throttleRetryMs;
          setAuthProbe("ok");
          return;
        }
        if (!pulled.ok) {
          // Reached, and refused: the session, not the network. Shown as such,
          // and probed again so a fresh sign-in is noticed without a reload.
          setAuthProbe(
            isSessionRefusal(pulled.status) ? "unauthenticated" : "failed",
          );
          return;
        }
        setAuthProbe("ok");

        // The pull is an authenticated server call, so its success is the only
        // honest evidence the session is still good — the page rendering is
        // not, since the service worker renders it from cache too.
        markPOSAuthenticated(scope);
        setSession(readPOSOfflineSession(scope, sessionWindowMs));

        const savedAt = new Date().toISOString();
        setOfflineProducts(pulled.products);
        setSnapshotAt(savedAt);
        await saveCatalogSnapshot({
          scope,
          products: pulled.products,
          categories: pulled.categories,
          savedAt,
        });

        // A refresh that finds the register still online changes no state the
        // drain effect watches, so anything left pending (a sale the server
        // asked to retry) is sent from here.
        void runSync();
      } catch {
        // An abort or a failed pull leaves the previous snapshot in place,
        // which is exactly what it is for. An abort is our own teardown, so it
        // must not be mistaken for the server being unreachable.
        if (!controller.signal.aborted) setAuthProbe("failed");
      }
    })();

    return () => controller.abort();
  }, [
    browserOffline,
    locationId,
    scope,
    probeAttempt,
    runSync,
    sessionWindowMs,
    snapshotRefreshMs,
    throttleRetryMs,
  ]);

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
    if (typeof window === "undefined") return;
    if (authProbe !== "failed" && authProbe !== "unauthenticated") return;
    const timer = window.setTimeout(
      () => setProbeAttempt((n) => n + 1),
      probeRetryMs,
    );
    return () => window.clearTimeout(timer);
  }, [authProbe, probeAttempt, probeRetryMs]);

  /**
   * Keep the snapshot and the session stamp fresh while online.
   *
   * Only while `ok`: a failed probe already has the retry loop above, and a
   * pull in flight must not be restarted from under itself. Measured from
   * when the last pull started, so a slow pull on a large catalogue is not
   * cut off by its own refresh check.
   */
  useEffect(() => {
    if (typeof window === "undefined" || authProbe !== "ok") return;
    const refreshIfStale = () => {
      if (document.hidden) return;
      if (Date.now() - lastPullAtRef.current < snapshotRefreshMs) return;
      setProbeAttempt((n) => n + 1);
    };
    const timer = window.setInterval(
      refreshIfStale,
      Math.min(REFRESH_CHECK_MS, snapshotRefreshMs),
    );
    document.addEventListener("visibilitychange", refreshIfStale);
    window.addEventListener("focus", refreshIfStale);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfStale);
      window.removeEventListener("focus", refreshIfStale);
    };
  }, [authProbe, snapshotRefreshMs]);

  // A drain the server throttled is tried again once, after a pause. Only
  // while reachable: an outage in between has its own retry loop.
  useEffect(() => {
    if (typeof window === "undefined" || !drainThrottled) return;
    if (authProbe !== "ok") return;
    const timer = window.setTimeout(() => {
      setDrainThrottled(false);
      void runSync();
    }, throttleRetryMs);
    return () => window.clearTimeout(timer);
  }, [authProbe, drainThrottled, runSync, throttleRetryMs]);

  // The banner's button shows the syncing state at once; the auth-probe path
  // below sets it during render.
  const sync = useCallback(() => {
    if (syncingRef.current) return Promise.resolve(null);
    setIsSyncing(true);
    return runSync();
  }, [runSync]);

  /**
   * Drain whenever the server becomes reachable — on mount, and again the
   * moment a failed probe starts succeeding.
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

  /**
   * Evidence from the terminal's own requests.
   *
   * A sale, a scan or a grid refetch that failed to arrive is the first — and
   * in the router-up outage the only — sign the server is gone. Before this
   * the hook never heard about it: the register kept saying "online", the
   * card dialog kept offering the online-only method, and the queue never
   * drained when the line came back, because nothing had marked it failed and
   * so nothing re-probed. The failed probe starts the retry loop; the next
   * success ends it and drains.
   */
  const reportUnreachable = useCallback(() => setAuthProbe("failed"), []);
  const reportReachable = useCallback(() => {
    markPOSAuthenticated(scope);
    setSession(readPOSOfflineSession(scope, sessionWindowMs));
    setAuthProbe("ok");
  }, [scope, sessionWindowMs]);

  const queueSale = useCallback(
    async (sale: OfflineSale) => {
      await enqueueSale(sale);
      await refreshQueue();
      // Queued because a sale could not be sent: that IS the register being
      // unreachable, whatever the browser's flag or the last probe said.
      setAuthProbe("failed");
    },
    [refreshQueue],
  );

  const retrySale = useCallback(
    async (clientRequestId: string) => {
      await requeueSale(clientRequestId);
      await refreshQueue();
      await sync();
    },
    [refreshQueue, sync],
  );

  const discardSale = useCallback(
    async (clientRequestId: string) => {
      await removeQueuedSale(clientRequestId);
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
    sessionExpired: authProbe === "unauthenticated",
    queueSale,
    sync,
    isSyncing,
    reportUnreachable,
    reportReachable,
    retrySale,
    discardSale,
  };
}
