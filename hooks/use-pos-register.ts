"use client";

import { useCallback, useEffect, useState } from "react";
import type { RegisterSessionView } from "@/lib/pos/register-session-dto";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { useHydrated } from "@/hooks/use-client-value";

/**
 * This device's drawer: whether it is open, and the actions on it.
 *
 * The open session is remembered in `localStorage` too, because a sale taken
 * offline still has to say which drawer its money went into — and the server
 * cannot be asked while the line is down. Opening, moving cash and closing
 * need the server, so they are refused offline.
 */

const CACHE_KEY = "pos:register-session";

type CachedSession = Pick<RegisterSessionView, "_id" | "number" | "openedAt" | "openingFloat" | "status">;

function readCache(terminalId: string): CachedSession | null {
  try {
    const raw = window.localStorage.getItem(`${CACHE_KEY}:${terminalId}`);
    return raw ? (JSON.parse(raw) as CachedSession) : null;
  } catch {
    return null;
  }
}

function writeCache(terminalId: string, session: RegisterSessionView | null) {
  try {
    const key = `${CACHE_KEY}:${terminalId}`;
    if (session && session.status === "open") {
      const cached: CachedSession = {
        _id: session._id,
        number: session.number,
        openedAt: session.openedAt,
        openingFloat: session.openingFloat,
        status: session.status,
      };
      window.localStorage.setItem(key, JSON.stringify(cached));
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage blocked: the drawer is still known online.
  }
}

function requestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `pos_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function call(url: string, init?: RequestInit): Promise<RegisterSessionView | null> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(json?.message || "The register could not be updated");
  }
  return (json.data ?? null) as RegisterSessionView | null;
}

function readSession(terminalId: string) {
  return call(`/api/pos/registers/session?terminalId=${encodeURIComponent(terminalId)}`);
}

export interface POSRegisterState {
  /** The open drawer as last known: the server's view online, the cache offline. */
  session: RegisterSessionView | CachedSession | null;
  /** The full view (with running totals) when the server has answered. */
  details: RegisterSessionView | null;
  isLoading: boolean;
  open: (openingFloat: number) => Promise<RegisterSessionView | null>;
  moveCash: (kind: "in" | "out" | "no_sale", amount: number, reason: string) => Promise<RegisterSessionView | null>;
  close: (countedCash: number, note?: string) => Promise<RegisterSessionView | null>;
  refresh: () => Promise<void>;
}

export function usePOSRegister(params: {
  terminalId: string | null;
  locationId?: string;
  isOffline: boolean;
}): POSRegisterState {
  const { terminalId, locationId, isOffline } = params;
  const [details, setDetails] = useState<RegisterSessionView | null>(null);
  const [cached, setCached] = useState<CachedSession | null>(null);
  // The device the server last answered for: until it has, the drawer is
  // still being read. Set only once an answer is in, never on the way out.
  const [answeredFor, setAnsweredFor] = useState<string | null>(null);

  // What the server said about this device's drawer — or, when it could not
  // be asked (offline, refused), what the device last knew.
  const settle = useCallback((id: string, view: RegisterSessionView | null | undefined, reached: boolean) => {
    if (reached) {
      setDetails(view ?? null);
      writeCache(id, view ?? null);
      setCached(view && view.status === "open" ? view : null);
    } else {
      setCached(readCache(id));
    }
    setAnsweredFor(id);
  }, []);

  const refresh = useCallback(async () => {
    if (!terminalId) return;
    try {
      settle(terminalId, await readSession(terminalId), true);
    } catch {
      settle(terminalId, undefined, false);
    }
  }, [settle, terminalId]);
  const isLoading = Boolean(terminalId) && !isOffline && answeredFor !== terminalId;

  // What the device remembers, read once it can be (localStorage is not there
  // during the server render), and again if the device id changes.
  const hydrated = useHydrated();
  useApplyOnChange([terminalId, hydrated], () => {
    if (hydrated && terminalId) setCached(readCache(terminalId));
  });

  useEffect(() => {
    if (!terminalId || isOffline) return;
    let live = true;
    readSession(terminalId).then(
      (view) => {
        if (live) settle(terminalId, view, true);
      },
      () => {
        if (live) settle(terminalId, undefined, false);
      },
    );
    return () => {
      live = false;
    };
  }, [terminalId, isOffline, settle]);

  const apply = useCallback(
    (view: RegisterSessionView | null) => {
      if (!terminalId) return view;
      setDetails(view);
      writeCache(terminalId, view);
      setCached(view && view.status === "open" ? view : null);
      return view;
    },
    [terminalId],
  );

  const open = useCallback(
    async (openingFloat: number) => {
      if (!terminalId) throw new Error("This register has no device id");
      return apply(
        await call("/api/pos/registers/session", {
          method: "POST",
          body: JSON.stringify({ terminalId, locationId: locationId || undefined, openingFloat, requestId: requestId() }),
        }),
      );
    },
    [apply, locationId, terminalId],
  );

  const sessionId = details?.status === "open" ? details._id : cached?._id;

  const moveCash = useCallback(
    async (kind: "in" | "out" | "no_sale", amount: number, reason: string) => {
      if (!sessionId) throw new Error("Open the register first");
      return apply(
        await call(`/api/pos/registers/session/${encodeURIComponent(sessionId)}/cash`, {
          method: "POST",
          body: JSON.stringify({ kind, amount, reason, requestId: requestId() }),
        }),
      );
    },
    [apply, sessionId],
  );

  const close = useCallback(
    async (countedCash: number, note?: string) => {
      if (!sessionId) throw new Error("Open the register first");
      const view = await call(`/api/pos/registers/session/${encodeURIComponent(sessionId)}/close`, {
        method: "POST",
        body: JSON.stringify({ countedCash, note }),
      });
      if (terminalId) writeCache(terminalId, null);
      setCached(null);
      setDetails(view);
      return view;
    },
    [sessionId, terminalId],
  );

  const session =
    details && details.status === "open" ? details : (cached ?? null);

  return { session, details, isLoading, open, moveCash, close, refresh };
}
