"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

/**
 * Keeps a JSON endpoint fresh without holding a connection open.
 *
 * This replaces the `text/event-stream` routes the notification surfaces used
 * to hold open. Those were never push: the server polled Mongo on a 3s timer
 * per connection and forwarded a snapshot when its signature changed. Moving
 * that same poll to the client loses no freshness and costs no held-open
 * request — which matters on a serverless host, where an idle dashboard tab
 * was billing a running function and consuming one of the connections the
 * checkout path shares (`MONGODB_MAX_POOL_SIZE`).
 *
 * Freshness comes from four signals rather than a fast interval:
 *
 * - **interval** — a slow background tick (30s), only while the tab is visible.
 * - **visibility / focus** — an immediate refetch when the user comes back.
 *   This is what makes a slow interval feel live: nobody perceives staleness
 *   in a tab they are not looking at, and the data is current the instant they
 *   look again.
 * - **online** — an immediate refetch when the network returns.
 * - **push** — a `push` handled by the service worker messages every open tab
 *   (see `public/sw.js`), which refetches at once. Once push is known to be
 *   working the interval drops to 60s, because the timer is then only a
 *   backstop for events push did not cover.
 *
 * Requests carry `If-None-Match`; a `304` leaves `data` untouched, so a poll
 * that finds nothing new costs one indexed lookup instead of a full payload
 * (see `lib/api/etag.ts`). The tag is held here rather than left to the HTTP
 * cache on purpose: these payloads are per-user and go out `no-store`, so the
 * browser would never revalidate them on its own.
 */

/** How the current request was triggered. Used only to gate the refetch guard. */
type Trigger = "mount" | "interval" | "visible" | "focus" | "online" | "push" | "manual";

/**
 * A failed poll.
 *
 * `status` is the HTTP status when the request reached the server, so a
 * consumer can tell "your session expired" from "the endpoint is broken" and
 * word its own message accordingly. It is absent when the request never landed
 * — an offline tab, DNS, a connection reset.
 */
export interface LiveResourceError extends Error {
  status?: number;
}

function liveResourceError(
  message: string,
  status?: number,
): LiveResourceError {
  const error: LiveResourceError = new Error(message);
  if (typeof status === "number") error.status = status;
  return error;
}

/**
 * Statuses that will answer the same way in 30 seconds.
 *
 * A polled resource whose session has expired is not going to recover on a
 * timer, and each retry is a request, a failed render, and — for a consumer
 * that surfaces errors — another toast. The interval stops; the event triggers
 * do not, because returning to the tab or coming back online are exactly the
 * moments the answer could plausibly have changed.
 */
const TERMINAL_STATUSES = new Set([401, 403]);

interface UseLiveResourceOptions<T> {
  /** Background tick while the tab is visible. */
  intervalMs?: number;
  /** Background tick once push is confirmed working — a backstop, not the signal. */
  pushIntervalMs?: number;
  /** Set false to hold the resource idle (no fetch, no listeners). */
  enabled?: boolean;
  /**
   * Called for every genuinely new payload — never for a `304`. Held in a ref,
   * so passing an inline function does not restart polling.
   */
  onData?: (data: T) => void;
  /** Called when a fetch fails. Held in a ref, like `onData`. */
  onError?: (error: LiveResourceError) => void;
}

interface UseLiveResourceResult<T> {
  data: T | null;
  error: LiveResourceError | null;
  /** True until the first payload (or failure) for the current url. */
  isLoading: boolean;
  /** True while any request is in flight, including background ticks. */
  isValidating: boolean;
  /** Refetch now, bypassing the guard that collapses near-simultaneous triggers. */
  refresh: () => Promise<void>;
}

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_PUSH_INTERVAL_MS = 60_000;

/**
 * Shortest gap between two *event-driven* refetches.
 *
 * Returning to a tab fires `visibilitychange` and `focus` together, and a push
 * that arrives while the user is already looking adds a third. Without this
 * they would be three requests for one user action.
 */
const MIN_EVENT_REFETCH_GAP_MS = 1_500;

/** Message shape `public/sw.js` posts to open tabs when a push arrives. */
const PUSH_MESSAGE_SOURCE = "storify";
const PUSH_MESSAGE_TYPE = "push-received";

function isPushMessage(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const message = data as { source?: unknown; type?: unknown };
  return (
    message.source === PUSH_MESSAGE_SOURCE && message.type === PUSH_MESSAGE_TYPE
  );
}

export function useLiveResource<T>(
  /**
   * Endpoint to keep fresh, or `null` to hold the resource idle.
   *
   * Pass a **function** for an endpoint whose query advances as the client
   * consumes it — a delta feed carrying its own cursor, say. It is re-read
   * immediately before every request, and changing what it returns does not
   * restart polling, which a changing string url would: that resets the ETag
   * and re-arms the loading flag, so a cursor that moves on each poll would
   * never settle. Return `null` from it to skip a tick.
   */
  url: string | null | (() => string | null),
  options: UseLiveResourceOptions<T> = {},
): UseLiveResourceResult<T> {
  const {
    intervalMs = DEFAULT_INTERVAL_MS,
    pushIntervalMs = DEFAULT_PUSH_INTERVAL_MS,
    enabled = true,
    onData,
    onError,
  } = options;

  // A dynamic url is resolved per request, so it must not sit in the effect's
  // dependency list — only a static one identifies "which resource is this".
  const isDynamicUrl = typeof url === "function";
  const staticUrl = isDynamicUrl ? null : url;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<LiveResourceError | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(url) && enabled);
  const [isValidating, setIsValidating] = useState(false);

  // Callbacks live in refs so a consumer passing an inline function (or a
  // `useCallback` whose deps change on every render) cannot tear down and
  // rebuild the polling effect underneath itself.
  const onDataRef = useRef(onData);
  const onErrorRef = useRef(onError);
  /** Resolves the url for the next request. Normalizes both accepted forms. */
  const resolveUrlRef = useRef<() => string | null>(() =>
    typeof url === "function" ? url() : url,
  );

  // Scalars the fetch loop reads but must not restart for.
  const intervalRef = useRef(intervalMs);
  const pushIntervalRef = useRef(pushIntervalMs);
  /**
   * Whether push has been observed reaching this tab, which is what licenses
   * the slower interval. Deliberately a ref and not state: nothing renders it,
   * and `scheduleNext` reads it when it arms the next timer, so flipping it
   * needs no re-render to take effect.
   */
  const pushActiveRef = useRef(false);

  /**
   * Mirror the latest props into the refs the fetch loop reads.
   *
   * Written here rather than during render because the React Compiler is on
   * for this project, and a ref assigned mid-render may be reordered or
   * skipped. Declared *above* the polling effect so it has already run by the
   * time that effect fires its first request — effects run in declaration
   * order, and `useRef`'s initial value covers the first render regardless.
   */
  useEffect(() => {
    onDataRef.current = onData;
    onErrorRef.current = onError;
    resolveUrlRef.current = () => (typeof url === "function" ? url() : url);
    intervalRef.current = intervalMs;
    pushIntervalRef.current = pushIntervalMs;
  });

  const etagRef = useRef<string | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);
  const lastFetchStartedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The live effect's fetch routine, exposed so `refresh()` can call it.
   *
   * Routing a manual refresh through effect state instead would re-run the
   * effect, and the effect discards the ETag and re-arms the loading flag —
   * turning "refresh" into "reload from scratch with a skeleton".
   */
  const runRef = useRef<((trigger: Trigger) => Promise<void>) | null>(null);

  const refresh = useCallback(async () => {
    await runRef.current?.("manual");
  }, []);

  // A new resource (url or re-enable) shows its skeleton from the first
  // render; an idle one never does.
  useApplyOnChange([enabled, isDynamicUrl, staticUrl], () => {
    setIsLoading(enabled && (isDynamicUrl || Boolean(staticUrl)));
  });

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    if (!isDynamicUrl && !staticUrl) return;

    // A different url is a different resource: the tag from the previous one
    // would make the server answer 304 for a payload this client never had.
    // A dynamic url keeps its tag instead — it varies per request by design,
    // and such an endpoint folds its own query into the tag, so a tag from a
    // superseded cursor simply fails to match and yields a full response.
    etagRef.current = null;

    let cancelled = false;
    /**
     * Set when the server refuses to authenticate this poll. Effect-local on
     * purpose: a different url (or a re-enable) is a fresh resource and gets a
     * fresh chance, without a ref to remember to clear.
     */
    let halted = false;

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const currentIntervalMs = () =>
      pushActiveRef.current ? pushIntervalRef.current : intervalRef.current;

    const scheduleNext = () => {
      clearTimer();
      if (cancelled) return;
      // Paused, not slowed: a tab nobody is looking at has no reason to poll,
      // and the visibility handler refetches the moment it comes back.
      if (document.visibilityState === "hidden") return;
      // Same reasoning for a refused session: the clock cannot change that
      // answer, so only an event that could stands a chance of clearing it.
      if (halted) return;
      timerRef.current = setTimeout(() => {
        void run("interval");
      }, currentIntervalMs());
    };

    const run = async (trigger: Trigger) => {
      if (cancelled) return;

      // Collapse the burst of events one user action produces. `manual` and
      // `mount` are exempt: those are explicit, not incidental.
      if (trigger !== "manual" && trigger !== "mount") {
        const sinceLast = Date.now() - lastFetchStartedAtRef.current;
        if (sinceLast < MIN_EVENT_REFETCH_GAP_MS) {
          scheduleNext();
          return;
        }
      }

      // One request at a time: a background tick landing mid-refetch would race
      // it to set state. An explicit refresh is different — it usually follows
      // a mutation, so dropping it would leave the caller looking at data it
      // just changed. It supersedes the request in flight instead.
      if (inFlightRef.current) {
        if (trigger !== "manual") return;
        inFlightRef.current.abort();
        inFlightRef.current = null;
      }

      // Read last, so a dynamic url reflects everything consumed so far.
      const target = resolveUrlRef.current();
      if (!target) {
        scheduleNext();
        return;
      }

      const controller = new AbortController();
      inFlightRef.current = controller;
      lastFetchStartedAtRef.current = Date.now();
      setIsValidating(true);

      try {
        const response = await fetch(target, {
          signal: controller.signal,
          cache: "no-store",
          headers: etagRef.current
            ? { "If-None-Match": etagRef.current }
            : undefined,
        });

        if (cancelled) return;

        // Any answer the server was willing to give is proof the session is
        // live again, so a poll that was halted resumes from here.
        if (response.ok || response.status === 304) halted = false;

        // Nothing changed — the server skipped the payload, so keep `data`
        // (and its identity, so consumers' effects do not re-run).
        if (response.status === 304) {
          setError(null);
          return;
        }

        if (!response.ok) {
          throw liveResourceError(
            `Request failed with status ${response.status}`,
            response.status,
          );
        }

        const tag = response.headers.get("ETag");
        const json = await response.json().catch(() => null);
        if (cancelled) return;

        if (!json?.success) {
          throw liveResourceError(
            json?.error || json?.message || "Request failed",
            response.status,
          );
        }

        // Stored only after a payload we successfully parsed, so a mid-flight
        // failure cannot leave us claiming to hold a version we never applied.
        etagRef.current = tag;

        const payload = json.data as T;
        setData(payload);
        setError(null);
        onDataRef.current?.(payload);
      } catch (caught) {
        if (cancelled) return;
        // An abort is our own teardown, not a failure worth surfacing.
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }
        const normalized: LiveResourceError =
          caught instanceof Error ? caught : new Error(String(caught));
        // Stop the clock before the `finally` arms it again.
        if (
          typeof normalized.status === "number" &&
          TERMINAL_STATUSES.has(normalized.status)
        ) {
          halted = true;
        }
        setError(normalized);
        onErrorRef.current?.(normalized);
      } finally {
        // A `manual` refresh supersedes whatever was in flight, so by the time
        // an aborted request lands here the slot may belong to its replacement.
        // Everything below then belongs to that replacement too: clearing the
        // slot would let both think they are alone and race to set `data` and
        // the ETag, retiring the flags would drop the caller's spinner while a
        // refetch is still running (and un-arm the skeleton before any payload
        // arrived), and scheduling would arm a timer the winner re-arms anyway.
        const superseded = inFlightRef.current !== controller;
        if (!superseded) inFlightRef.current = null;
        if (!superseded && !cancelled) {
          setIsValidating(false);
          setIsLoading(false);
          scheduleNext();
        }
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void run("visible");
      } else {
        // Stop the clock rather than let a hidden tab keep querying.
        clearTimer();
      }
    };
    const handleFocus = () => void run("focus");
    const handleOnline = () => void run("online");
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (!isPushMessage(event.data)) return;
      // Proof that push reaches this tab, which is what licenses the slower
      // interval — an unconfirmed subscription is not the same as a working one.
      pushActiveRef.current = true;
      void run("push");
    };

    runRef.current = run;

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    navigator.serviceWorker?.addEventListener(
      "message",
      handleServiceWorkerMessage,
    );

    void run("mount");

    return () => {
      cancelled = true;
      runRef.current = null;
      clearTimer();
      inFlightRef.current?.abort();
      inFlightRef.current = null;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      navigator.serviceWorker?.removeEventListener(
        "message",
        handleServiceWorkerMessage,
      );
    };
  }, [staticUrl, isDynamicUrl, enabled]);

  return {
    data,
    error,
    isLoading,
    isValidating,
    refresh,
  };
}
