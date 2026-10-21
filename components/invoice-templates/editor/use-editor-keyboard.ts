"use client";

/**
 * The editor's keyboard (§5.4):
 * - Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z and Ctrl+Y redo; Ctrl/Cmd+D duplicate —
 *   anywhere in the editor except inside a text field.
 * - Ctrl/Cmd+S saves, even from a text field (the browser would offer to
 *   save the page); not from a dialog, which has its own buttons, and not
 *   during a drag, resize or rotate.
 * - With the canvas focused (or nothing focused): arrows nudge 1 mm
 *   (Shift: 10 mm), Delete/Backspace delete, Esc deselects, Enter moves focus
 *   to the first property. Tab walking the elements is the canvas's own.
 * Shortcuts never fire inside inputs, dialogs, menus or list boxes, and a
 * focused handle keeps the arrow keys for itself (resize / rotate).
 */
import { useEffect } from "react";
import { historyChord } from "@/hooks/use-undo-history";
import type { EditorState } from "./editor-store";
import type { StoreApi } from "zustand/vanilla";

const NUDGE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Whether a key press belongs to a field, a dialog or a menu rather than to the editor. */
export function isOwnedByControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return true;
  return Boolean(target.closest('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[role="combobox"]'));
}

export function useEditorKeyboard(api: StoreApi<EditorState>, options: { onEnter: () => void; onSave?: () => void }) {
  const { onEnter, onSave } = options;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (onSave && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target?.closest('[role="dialog"],[role="alertdialog"]')) return;
        event.preventDefault();
        // Mid-drag the canvas shows a preview, not the document: nothing to save until it lands.
        if (api.getState().gestureBase) return;
        // A name or number being typed commits on blur; let it land first.
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) target.blur();
        onSave();
        return;
      }
      if (isOwnedByControl(event.target)) return;
      const state = api.getState();
      const chord = historyChord(event);
      if (chord) {
        event.preventDefault();
        if (chord === "undo") state.undo();
        else state.redo();
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "d") {
        // The browser would bookmark the page.
        event.preventDefault();
        state.duplicateSelection();
        return;
      }
      if (mod || event.altKey) return;

      const target = event.target as HTMLElement | null;
      // The canvas region (`data-editor-canvas`), or nothing focused at all; a toolbar button keeps its own keys.
      const onCanvas = !target || target === document.body || Boolean(target.closest("[data-editor-canvas]"));
      if (!onCanvas || target?.closest("[data-handle]")) return;

      const nudge = NUDGE[event.key];
      if (nudge) {
        if (state.selection.length === 0) return;
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        state.nudgeSelection(nudge[0] * step, nudge[1] * step);
        return;
      }
      switch (event.key) {
        case "Delete":
        case "Backspace":
          if (state.selection.length === 0) return;
          event.preventDefault();
          state.deleteSelection();
          return;
        case "Escape":
          if (state.selection.length === 0) return;
          event.preventDefault();
          state.clearSelection();
          return;
        case "Enter":
          if (state.selection.length === 0) return;
          event.preventDefault();
          onEnter();
          return;
        default:
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [api, onEnter, onSave]);
}
