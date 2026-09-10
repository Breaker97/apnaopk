"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient, ApiClientError } from "@/lib/api/client";
import type { SectionInstance } from "@/lib/storefront/sections/types";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface DraftSaveResponse {
  draftUpdatedAt: string;
  isPublished: boolean;
  hasUnpublishedChanges: boolean;
}

interface DraftAutosaveOptions {
  /** Page ref — "home", "template:<type>", "group:<zone>", or a handle. */
  handle: string;
  sections: SectionInstance[];
  /** Applied on every landed save (publish flags, preview refresh). */
  onSaved: (result: DraftSaveResponse) => void;
  /** Surfaces a failed save; the hook stays free of UI dependencies. */
  onError: (message: string) => void;
  /** Shown when the failure carries no server message of its own. */
  fallbackErrorMessage: string;
  debounceMs?: number;
  /**
   * Demo deployments edit in memory only: the pipeline goes inert, so no
   * PATCH is ever sent and the badge never claims a draft was saved. The
   * builder still guards publish/discard itself.
   */
  disabled?: boolean;
}

interface DraftAutosave {
  saveState: SaveState;
  /**
   * Push everything pending and resolve once the SERVER holds the builder's
   * content. `false` means it does not — the caller must not publish.
   */
  flush: () => Promise<boolean>;
  /**
   * Sections that came FROM the server (discard, history restore) are not an
   * edit: skip the autosave they would otherwise trigger and reset the badge.
   */
  adoptServerSections: () => void;
}

/**
 * Draft autosave for the store-page builder.
 *
 * The pipeline is strictly SERIAL: at most one PATCH is ever in flight, and
 * an edit made while one is running QUEUES behind it rather than racing it.
 * Two concurrent saves can land out of order — the OLDER payload last —
 * which leaves the server holding a draft the builder never showed, and a
 * publish then ships exactly that. Serializing makes the reordering
 * structurally impossible instead of merely unlikely.
 *
 * `flush()` awaits the whole chain (running request plus any queued
 * follow-up), so publish and discard act on the true tail of the pipeline.
 */
export function useDraftAutosave({
  handle,
  sections,
  onSaved,
  onError,
  fallbackErrorMessage,
  debounceMs = 800,
  disabled = false,
}: DraftAutosaveOptions): DraftAutosave {
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skippedInitial = useRef(false);
  const latestSections = useRef(sections);
  // Mirrors for the pieces flush/unload must read outside the render: state
  // at click time is a stale closure, and a flush that publishes an older
  // draft than the builder shows is exactly the bug this prevents.
  const saveStateRef = useRef<SaveState>("idle");
  /** The running request AND anything queued behind it. */
  const inFlightSave = useRef<Promise<boolean> | null>(null);
  /** An edit arrived mid-save and is waiting for it to settle. */
  const resaveQueued = useRef(false);
  const saveAbort = useRef<AbortController | null>(null);

  // Callbacks are read through refs so the pipeline can stay identity-stable
  // across renders — a re-created callback must never restart a save chain.
  const onSavedRef = useRef(onSaved);
  const onErrorRef = useRef(onError);
  const fallbackRef = useRef(fallbackErrorMessage);
  const handleRef = useRef(handle);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    onSavedRef.current = onSaved;
    onErrorRef.current = onError;
    fallbackRef.current = fallbackErrorMessage;
    handleRef.current = handle;
    disabledRef.current = disabled;
  });

  const applySaveState = useCallback((state: SaveState) => {
    saveStateRef.current = state;
    setSaveState(state);
  }, []);

  /** ONE PATCH, carrying whatever the builder holds when it fires. */
  const runSave = useCallback(async (): Promise<boolean> => {
    applySaveState("saving");
    const controller = new AbortController();
    saveAbort.current = controller;
    try {
      const result = await apiClient.patch<DraftSaveResponse>(
        `/api/admin/store-pages/${handleRef.current}`,
        { sections: latestSections.current },
        { signal: controller.signal },
      );
      onSavedRef.current(result);
      return true;
    } catch (error) {
      // Aborted by unmount: neither a failure to report nor a state to
      // paint — the cleanup's keepalive PATCH carries the same content.
      if (controller.signal.aborted) return false;
      applySaveState("error");
      onErrorRef.current(
        error instanceof ApiClientError ? error.message : fallbackRef.current,
      );
      return false;
    } finally {
      if (saveAbort.current === controller) saveAbort.current = null;
    }
  }, [applySaveState]);

  const saveDraft = useCallback((): Promise<boolean> => {
    const running = inFlightSave.current;
    if (running) {
      resaveQueued.current = true;
      return running;
    }
    const chain = (async () => {
      let ok = false;
      do {
        resaveQueued.current = false;
        ok = await runSave();
        // A failed leg stops the chain: the queued edit stays pending and
        // the next debounce (or the unload flush) carries it, rather than
        // this loop hammering a server that just refused.
      } while (ok && resaveQueued.current);
      // Only claim "saved" when nothing was typed since this leg began — an
      // edit inside the debounce window already moved us back to "dirty".
      if (ok && saveStateRef.current === "saving") applySaveState("saved");
      return ok;
    })();
    inFlightSave.current = chain;
    void chain.finally(() => {
      // Identity-checked: only the chain that set this may clear it.
      if (inFlightSave.current === chain) inFlightSave.current = null;
    });
    return chain;
  }, [applySaveState, runSave]);

  useEffect(() => {
    latestSections.current = sections;
    if (!skippedInitial.current) {
      skippedInitial.current = true;
      return;
    }
    // Demo: the edit lives in React state and goes no further, so the badge
    // stays at "idle" rather than promising a save that never happens.
    if (disabled) return;
    // The badge flips to "dirty" the moment an edit lands; this effect is the
    // debounce timer's owner, so the transition belongs with it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    applySaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveDraft(), debounceMs);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [sections, saveDraft, applySaveState, debounceMs, disabled]);

  // Unsaved work must not evaporate on navigation: warn on tab close while
  // anything is pending, and fire a keepalive PATCH on unmount so an edit
  // still inside the debounce (or after a failed save) reaches the server.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (disabledRef.current) return;
      if (saveStateRef.current === "saved" || saveStateRef.current === "idle") {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Anything not confirmed saved goes out once more: an edit still inside
      // the debounce, a failed save, an edit queued behind a running one — or
      // that running save itself, aborted FIRST so it cannot land after this
      // keepalive and overwrite it with older sections.
      const pending =
        saveStateRef.current !== "idle" && saveStateRef.current !== "saved";
      saveAbort.current?.abort();
      if (disabledRef.current || (!pending && !resaveQueued.current)) return;
      void fetch(`/api/admin/store-pages/${handleRef.current}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: latestSections.current }),
        keepalive: true,
      }).catch(() => {});
    };
  }, []);

  const flush = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    // The chain covers the running request AND anything queued behind it,
    // so one await is enough to reach the true tail of the pipeline.
    if (inFlightSave.current) await inFlightSave.current;
    if (saveStateRef.current === "idle" || saveStateRef.current === "saved") {
      return true;
    }
    return saveDraft();
  }, [saveDraft]);

  const adoptServerSections = useCallback(() => {
    skippedInitial.current = false;
    applySaveState("idle");
  }, [applySaveState]);

  return { saveState, flush, adoptServerSections };
}
