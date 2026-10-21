"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The colours a merchant has kept from the colour picker, shared by every
 * picker on the page and remembered in this browser. Browser storage can be
 * blocked or empty, so a failed read or write only means nothing is
 * remembered next time — the list still works for the open page.
 */

const STORAGE_KEY = "storify:saved-colors";
export const MAX_SAVED_COLORS = 7;

const SAVED_HEX = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/;
const EMPTY: readonly string[] = [];

const listeners = new Set<() => void>();
let current: readonly string[] | null = null;

function load(): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return EMPTY;
    return parsed
      .filter((entry): entry is string => typeof entry === "string" && SAVED_HEX.test(entry))
      .slice(-MAX_SAVED_COLORS);
  } catch {
    return EMPTY;
  }
}

function notify() {
  listeners.forEach((listener) => listener());
}

function commit(next: readonly string[]) {
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Not persisted; the list still serves this page.
  }
  notify();
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  current = load();
  notify();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): readonly string[] {
  if (current === null) current = load();
  return current;
}

function getServerSnapshot(): readonly string[] {
  return EMPTY;
}

/** `#abc`-style spellings and capitals folded to the one form that is stored. */
function canonical(hex: string): string | null {
  const lower = hex.trim().toLowerCase();
  return SAVED_HEX.test(lower) ? lower : null;
}

export function useSavedColors() {
  const colors = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /** Keep a colour. A repeat moves to the newest slot; past the cap the oldest goes. */
  const save = useCallback((hex: string) => {
    const next = canonical(hex);
    if (!next) return;
    commit([...getSnapshot().filter((entry) => entry !== next), next].slice(-MAX_SAVED_COLORS));
  }, []);

  const remove = useCallback((hex: string) => {
    const target = canonical(hex);
    commit(getSnapshot().filter((entry) => entry !== target));
  }, []);

  return { colors, save, remove };
}
