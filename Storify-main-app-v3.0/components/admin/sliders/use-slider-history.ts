"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SliderDocument } from "@/lib/sliders/types";

/**
 * Undo and redo over a slider document.
 *
 * The editor is controlled — every edit is a whole new document handed to
 * the owner — so a history is just the documents that went before. Edits
 * that land within a breath of each other (keystrokes into a field, a
 * scrubbed number) collapse into one step, so undo takes back a word or a
 * drag, not a letter or a pixel. The stack is capped; a merchant who has
 * made two hundred edits does not need the first.
 */

const COALESCE_MS = 600;
const MAX_STEPS = 100;

export function useSliderHistory(
  value: SliderDocument,
  onChange: (next: SliderDocument) => void,
) {
  const past = useRef<SliderDocument[]>([]);
  const future = useRef<SliderDocument[]>([]);
  const lastPushAt = useRef(0);
  const current = useRef(value);
  // What the buttons need to know, kept as state so a change re-renders them.
  const [depth, setDepth] = useState({ past: 0, future: 0 });
  const publish = () =>
    setDepth({ past: past.current.length, future: future.current.length });

  // The owner may replace the document from outside (a save answered, a
  // draft discarded); the history then continues from that document.
  useEffect(() => {
    current.current = value;
  }, [value]);

  const change = useCallback(
    (next: SliderDocument) => {
      const now = Date.now();
      // A burst of edits keeps the step it opened with.
      if (now - lastPushAt.current > COALESCE_MS) {
        past.current = [...past.current.slice(-(MAX_STEPS - 1)), current.current];
        future.current = [];
      }
      lastPushAt.current = now;
      current.current = next;
      onChange(next);
      publish();
    },
    [onChange],
  );

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (!previous) return;
    future.current = [current.current, ...future.current];
    current.current = previous;
    lastPushAt.current = 0;
    onChange(previous);
    publish();
  }, [onChange]);

  const redo = useCallback(() => {
    const [next, ...rest] = future.current;
    if (!next) return;
    past.current = [...past.current, current.current];
    future.current = rest;
    current.current = next;
    lastPushAt.current = 0;
    onChange(next);
    publish();
  }, [onChange]);

  /** Forgets everything — after a save lands, or the slider changes under the editor. */
  const reset = useCallback(() => {
    past.current = [];
    future.current = [];
    lastPushAt.current = 0;
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
 * Whether a keyboard event is the undo or redo chord, and which. Ignores
 * chords typed into a text field, where the field's own undo applies.
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
