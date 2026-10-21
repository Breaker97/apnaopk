"use client";

/**
 * A local draft copy for a long form: while it has unsaved changes, a copy is
 * kept in this browser's `localStorage`, and offered back when the form next
 * opens after the page was left without saving — a crash, a closed tab, the
 * browser's Back (which no leave guard can stop; see use-leave-guard.ts).
 *
 * - While something is unsaved, the copy is written about a second after the
 *   last change, and at once when the page is hidden or the form unmounts.
 * - When nothing is unsaved any more (an undo back to the start) the copy is
 *   removed; a successful save calls `stop()`, which removes it for good.
 * - On open, a copy left by an earlier visit is offered. Until the offer is
 *   answered nothing is written or removed, so a second tab's pristine form
 *   can't wipe the copy the first one kept.
 * - A copy older than a week, from another `version` of its shape, or that
 *   `validate` refuses is dropped without a word.
 *
 * Storage can be missing, full or blocked (private windows): every access is
 * wrapped, and the form works the same without it.
 *
 * The invoice editor keeps its own recovery copy (use-draft-recovery.ts),
 * which also hands edits over to the template a first Save creates.
 */
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

export const DRAFT_WRITE_DELAY_MS = 1000;
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredDraft {
  v: number;
  savedAt: number;
  data: unknown;
}

export interface LocalDraftCopy<T> {
  /** When it was written (ms). */
  savedAt: number;
  data: T;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function clearLocalDraft(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Nothing to clear without storage.
  }
}

/** The copy under `key`, if there is one that is current, recent and valid. */
export function readLocalDraft<T>(
  key: string,
  version: number,
  validate: (data: unknown) => T | null,
  now = Date.now(),
): LocalDraftCopy<T> | null {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredDraft> | null;
    const savedAt = stored?.savedAt;
    const fresh = stored?.v === version && typeof savedAt === "number" && now - savedAt <= DRAFT_MAX_AGE_MS;
    const data = fresh ? validate(stored?.data) : null;
    if (!data) {
      clearLocalDraft(key);
      return null;
    }
    return { savedAt: savedAt as number, data };
  } catch {
    clearLocalDraft(key);
    return null;
  }
}

/** Writes the copy; false when the browser wouldn't keep it. */
export function writeLocalDraft(key: string, version: number, data: unknown, now = Date.now()): boolean {
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(key, JSON.stringify({ v: version, savedAt: now, data } satisfies StoredDraft));
    return true;
  } catch {
    return false;
  }
}

export interface LocalDraftOptions<T> {
  /**
   * Where the copy lives. Null while there is nothing to keep: the form edits
   * something that already exists, or the signed-in user isn't known yet.
   */
  key: string | null;
  /** Bumped when the shape of the copy changes; an older copy is dropped. */
  version: number;
  /** Is there anything the user has changed and not saved? */
  unsaved: boolean;
  /** Changes whenever what `read` would return changes (the debounce restarts on it). */
  signal: unknown;
  read: () => T;
  apply: (data: T) => void;
  /** The copy as `T`, or null when it can't be trusted. */
  validate: (data: unknown) => T | null;
}

export interface LocalDraft {
  /** A copy from an earlier visit, waiting for Restore or Discard. */
  offer: { savedAt: number } | null;
  restore: () => void;
  discard: () => void;
  /** The edits were saved: forgets the copy and writes no more. */
  stop: () => void;
}

export function useLocalDraft<T>({ key, version, unsaved, signal, read, apply, validate }: LocalDraftOptions<T>): LocalDraft {
  const [offer, setOffer] = useState<LocalDraftCopy<T> | null>(null);
  // False until the stored copy, if any, has been looked at and answered.
  const [answered, setAnswered] = useState(false);
  const stopped = useRef(false);
  const pending = useRef(false);
  const seenUnsaved = useRef(false);

  const validateCopy = useEffectEvent((data: unknown) => validate(data));
  const readData = useEffectEvent(() => read());

  useEffect(() => {
    stopped.current = false;
    seenUnsaved.current = false;
    // Storage can only be read once the page is in the browser, after the
    // server-rendered markup was hydrated, so this has to be an effect.
    if (!key) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOffer(null);
      setAnswered(false);
      return;
    }
    const copy = readLocalDraft(key, version, (data) => validateCopy(data));
    setOffer(copy);
    setAnswered(!copy);
  }, [key, version]);

  const write = useEffectEvent(() => {
    pending.current = false;
    if (!key || !answered || stopped.current) return;
    writeLocalDraft(key, version, readData());
  });

  useEffect(() => {
    if (!key || !answered || stopped.current) return;
    if (!unsaved) {
      // Back to the start (an undo): there is nothing left to keep.
      pending.current = false;
      if (seenUnsaved.current) clearLocalDraft(key);
      return;
    }
    seenUnsaved.current = true;
    pending.current = true;
    const timer = window.setTimeout(() => write(), DRAFT_WRITE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [key, answered, unsaved, signal]);

  const flushIfUnsaved = useEffectEvent(() => {
    if (unsaved) write();
  });
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushIfUnsaved();
    };
    const onPageHide = () => flushIfUnsaved();
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  // Leaving within the app: whatever the last second's edits left unwritten.
  const flushPending = useEffectEvent(() => {
    if (pending.current) write();
  });
  useEffect(() => () => flushPending(), []);

  const restore = useCallback(() => {
    if (!offer) return;
    stopped.current = false;
    apply(offer.data);
    setOffer(null);
    setAnswered(true);
  }, [offer, apply]);

  const discard = useCallback(() => {
    if (key) clearLocalDraft(key);
    setOffer(null);
    setAnswered(true);
  }, [key]);

  const stop = useCallback(() => {
    stopped.current = true;
    pending.current = false;
    if (key) clearLocalDraft(key);
  }, [key]);

  return { offer: offer ? { savedAt: offer.savedAt } : null, restore, discard, stop };
}
