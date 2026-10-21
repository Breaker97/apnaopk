"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emptyHistory, recordChange, redoChange, undoChange, type UndoHistory } from "@/lib/undo-history";

/**
 * Undo and redo over a controlled document (`lib/undo-history.ts`).
 *
 * The editor is controlled — every edit is a whole new document handed to
 * the owner — so a history is just the documents that went before. By
 * default every edit is in one group, so edits that land within a breath of
 * each other (keystrokes into a field, a scrubbed number) collapse into one
 * step, which is what the slider editor has always done. A caller can name a
 * group per edit, or pass `null` to make an edit its own step.
 */

export interface UndoHistoryOptions {
  /** The group an edit joins when `change` is not told one. */
  defaultGroup?: string | null;
}

export interface ChangeOptions {
  group?: string | null;
}

export function useUndoHistory<T>(
  value: T,
  onChange: (next: T) => void,
  { defaultGroup = "edit" }: UndoHistoryOptions = {},
) {
  const history = useRef<UndoHistory<T>>(emptyHistory<T>());
  const current = useRef(value);
  // What the buttons need to know, kept as state so a change re-renders them.
  const [depth, setDepth] = useState({ past: 0, future: 0 });
  const publish = () => setDepth({ past: history.current.past.length, future: history.current.future.length });

  // The owner may replace the document from outside (a save answered, a
  // draft discarded); the history then continues from that document.
  useEffect(() => {
    current.current = value;
  }, [value]);

  const change = useCallback(
    (next: T, options: ChangeOptions = {}) => {
      const group = options.group === undefined ? defaultGroup : options.group;
      history.current = recordChange(history.current, current.current, { now: Date.now(), group });
      current.current = next;
      onChange(next);
      publish();
    },
    [onChange, defaultGroup],
  );

  const undo = useCallback(() => {
    const step = undoChange(history.current, current.current);
    if (!step) return;
    history.current = step.history;
    current.current = step.value;
    onChange(step.value);
    publish();
  }, [onChange]);

  const redo = useCallback(() => {
    const step = redoChange(history.current, current.current);
    if (!step) return;
    history.current = step.history;
    current.current = step.value;
    onChange(step.value);
    publish();
  }, [onChange]);

  /** Forgets everything — after a save lands, or the document changes under the editor. */
  const reset = useCallback(() => {
    history.current = emptyHistory<T>();
    publish();
  }, []);

  return {
    change,
    undo,
    redo,
    reset,
    canUndo: depth.past > 0,
    canRedo: depth.future > 0,
  };
}

/**
 * Whether a keyboard event is the undo or redo chord, and which: Ctrl/Cmd+Z
 * undoes, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y redo. Ignores chords typed into a
 * text field, where the field's own undo applies.
 */
export function historyChord(event: KeyboardEvent | React.KeyboardEvent): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey)) return null;
  const target = event.target as HTMLElement | null;
  const tag = target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y") return "redo";
  return null;
}
