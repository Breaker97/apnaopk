"use client";

/**
 * Keeps the local draft-recovery copy (draft-recovery.ts) in step with the
 * editor, and offers a copy left behind by an earlier visit.
 *
 * - While the document is unsaved, a copy is written about a second after the
 *   last change (not during a drag: a gesture's previews aren't the
 *   document), and at once when the page is hidden or closed.
 * - When nothing is unsaved (a save landed, an undo back to the saved state)
 *   the copy is removed.
 * - On open, a copy that differs from what the editor loaded is offered.
 *   Until the offer is answered nothing is written, so the old copy can't be
 *   overwritten by the new visit's first edit.
 * - A copy made from an older version than the one open (the template was
 *   saved again since) is restored onto that older version: the next Save
 *   names it, so the server answers 409 and the conflict dialog asks Reload
 *   or Overwrite before the newer version is replaced. That holds while the
 *   restore is on the canvas: an Undo that takes it off saves onto the
 *   version open again, a Redo that brings it back asks again, and a save
 *   that lands ends it.
 * - When a create lands (a draft's first Save, Save as…), `handOff` moves the
 *   copy to the new template: whatever is still unsaved when this editor
 *   closes (edits made while the request was out) is written under the new
 *   template's key, and put back by itself when that template opens. A
 *   draft's offer that was never answered stays for the next new draft.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { designEquals } from "@/lib/invoice-templates/editor/operations";
import type { TemplateDesign } from "@/lib/invoice-templates/types";
import { clearRecovery, readRecovery, recoveredName, writeRecovery, type RecoveryCopy } from "./draft-recovery";
import { selectIsDirty, type EditorState } from "./editor-store";

export const RECOVERY_WRITE_DELAY_MS = 1000;

/** Where the edits go once a create landed. */
export interface RecoveryHandOff {
  /** The new template's key (`recoveryKey` with its id). */
  key: string;
  /**
   * Save as…: the copy as it was created (its version, the design sent, its
   * name). Left out for a draft's first Save: the editor's store is the new
   * template then, with its own baseline and version.
   */
  copy?: { version: number; design: TemplateDesign; name: string };
  /**
   * The editor is about to open the new template: its copy is put back
   * there by itself. False when the user had already left (the copy is
   * offered there as any other).
   */
  carried: boolean;
}

export interface DraftRecovery {
  /** A copy from an earlier visit, waiting for Restore or Discard. */
  offer: RecoveryCopy | null;
  /** The copy was made from an older saved version than the one open now. */
  offerIsStale: boolean;
  /** An older copy's restore is on the canvas: Save goes onto its version (409 → Reload / Overwrite). */
  restoredStale: boolean;
  restore: () => void;
  discard: () => void;
  /** Forgets the copy (after Reload): the edits were dealt with. */
  clear: () => void;
  /** A create landed: from now on the copy is the new template's (see `RecoveryHandOff`). */
  handOff: (to: RecoveryHandOff) => void;
}

/** A restored copy from an older version, while it may still be on the canvas. */
interface StaleRestore {
  /** The design the restore put on the canvas, and the one it replaced (history entries are these very objects). */
  restored: TemplateDesign;
  before: TemplateDesign;
  /** The name the restore set, when the copy was a rename (the name is outside the undo history). */
  renamedTo: string | null;
  copyVersion: number;
  openVersion: number;
}

/**
 * Whether the restore is still applied: its design is on the canvas or under
 * later edits (in the undo past). Undone, it sits in the redo future and the
 * design it replaced is back; undone and edited over, that design is in the
 * past. When neither design is anywhere, the step fell off the end of the
 * history (100 steps) and can't be undone any more: still applied.
 */
export function staleRestoreApplied(state: Pick<EditorState, "design" | "history" | "name">, restore: Omit<StaleRestore, "copyVersion" | "openVersion">): boolean {
  const { design, history } = state;
  if (restore.renamedTo !== null && state.name === restore.renamedTo) return true;
  if (design === restore.restored || history.past.includes(restore.restored)) return true;
  const known =
    design === restore.before || history.past.includes(restore.before) || history.future.includes(restore.before) || history.future.includes(restore.restored);
  return !known;
}

/** `key` null: no local copy is kept (an editor that can't name its owner). */
export function useDraftRecovery(store: StoreApi<EditorState>, key: string | null): DraftRecovery {
  const [offer, setOffer] = useState<RecoveryCopy | null>(null);
  // Mirrors `offer` for the store subscription; only the effects and callbacks below change either.
  const offerRef = useRef<RecoveryCopy | null>(null);
  // Set once the edits were dealt with elsewhere (Reload): nothing more is written.
  const suppressed = useRef(false);
  // Set once a create landed: the copy is the new template's from then on.
  const handedOff = useRef<RecoveryHandOff | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The older version a restored copy started from; the save goes onto it while the store still names it.
  const [staleBase, setStaleBase] = useState<number | null>(null);
  const staleRestore = useRef<StaleRestore | null>(null);
  const version = useStore(store, (state) => state.version);

  /** Points the next save at the copy's version while its restore is applied, at the version open once it isn't. */
  const syncStale = useCallback(
    (state: EditorState) => {
      const restore = staleRestore.current;
      if (!restore) return;
      if (state.version !== restore.copyVersion && state.version !== restore.openVersion) {
        // A save landed: the store holds the new version.
        staleRestore.current = null;
        setStaleBase(null);
        return;
      }
      const wanted = staleRestoreApplied(state, restore) ? restore.copyVersion : restore.openVersion;
      if (state.version !== wanted) store.setState({ version: wanted });
    },
    [store],
  );

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (suppressed.current) return;
    const state = store.getState();
    if (state.gestureBase) return;

    const to = handedOff.current;
    if (to) {
      const base = to.copy ?? { version: state.version, design: state.baseline.design, name: state.baseline.name };
      // A copy keeps the name it was created with; a draft's first Save is the template the toolbar names.
      const name = to.copy ? to.copy.name : state.name;
      if (name === base.name && designEquals(state.design, base.design)) {
        clearRecovery(to.key);
        return;
      }
      writeRecovery(to.key, {
        savedAt: Date.now(),
        name,
        baseName: base.name,
        design: state.design,
        baseVersion: base.version,
        ...(to.carried ? { carried: true as const } : {}),
      });
      return;
    }

    if (offerRef.current || !key) return;
    if (!selectIsDirty(state)) {
      clearRecovery(key);
      return;
    }
    writeRecovery(key, {
      savedAt: Date.now(),
      name: state.name,
      baseName: state.baseline.name,
      design: state.design,
      baseVersion: state.version,
    });
  }, [store, key]);

  // Read after mounting: the server has no localStorage, and the first client
  // render has to match the HTML it sent (a banner there was a hydration error).
  useEffect(() => {
    if (!key) return;
    const copy = readRecovery(key);
    if (!copy) return;
    const state = store.getState();
    if (recoveredName(copy, state.name) === state.name && designEquals(copy.design, state.design)) return;
    if (copy.carried && copy.baseVersion === state.version) {
      // Edits made while this template was being created: they belong here, unsaved.
      state.restoreDocument(copy.design, recoveredName(copy, state.name));
      flush();
      return;
    }
    offerRef.current = copy;
    setOffer(copy);
  }, [key, store, flush]);

  useEffect(() => {
    const schedule = (state: EditorState, previous: EditorState) => {
      syncStale(state);
      if (state.design === previous.design && state.name === previous.name && state.baseline === previous.baseline && state.gestureBase === previous.gestureBase) {
        return;
      }
      if (offerRef.current) return;
      if (!selectIsDirty(state)) {
        // Saved, or back to the saved state: nothing to recover.
        flush();
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, RECOVERY_WRITE_DELAY_MS);
    };
    const unsubscribe = store.subscribe(schedule);
    const onHide = () => flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      // Leaving the editor inside the app: keep what is unsaved.
      flush();
    };
  }, [store, flush, syncStale]);

  const restore = useCallback(() => {
    const copy = offerRef.current;
    if (!copy) return;
    offerRef.current = null;
    setOffer(null);
    const state = store.getState();
    const name = recoveredName(copy, state.name);
    state.restoreDocument(copy.design, name);
    if (copy.baseVersion !== null && state.version !== null && copy.baseVersion !== state.version) {
      // These edits start from the older version: saving them over the newer one has to be a conflict the user answers.
      staleRestore.current = {
        restored: store.getState().design,
        before: state.design,
        renamedTo: name !== state.name ? name : null,
        copyVersion: copy.baseVersion,
        openVersion: state.version,
      };
      setStaleBase(copy.baseVersion);
      syncStale(store.getState());
    }
    flush();
  }, [store, flush, syncStale]);

  const discard = useCallback(() => {
    offerRef.current = null;
    setOffer(null);
    if (key) clearRecovery(key);
    flush();
  }, [flush, key]);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    suppressed.current = true;
    offerRef.current = null;
    setOffer(null);
    if (key) clearRecovery(key);
  }, [key]);

  const handOff = useCallback(
    (to: RecoveryHandOff) => {
      handedOff.current = to;
      // A draft's unanswered offer is an older draft of its own: it stays for the next new draft. Otherwise what this key held went into the new template.
      const keepOffer = Boolean(offerRef.current) && !to.copy;
      offerRef.current = null;
      setOffer(null);
      if (key && key !== to.key && !keepOffer) clearRecovery(key);
      flush();
    },
    [flush, key],
  );

  return {
    offer,
    offerIsStale: Boolean(offer && offer.baseVersion !== null && version !== null && offer.baseVersion !== version),
    restoredStale: staleBase !== null && version === staleBase,
    restore,
    discard,
    clear,
    handOff,
  };
}
