"use client";

import type { SliderDocument } from "@/lib/sliders/types";
import { historyChord, useUndoHistory } from "@/hooks/use-undo-history";

/**
 * Undo and redo over a slider document: the shared history
 * (`hooks/use-undo-history.ts`) with every edit in one group, so edits that
 * land within 600 ms of each other are one step, 100 steps deep.
 */
export function useSliderHistory(value: SliderDocument, onChange: (next: SliderDocument) => void) {
  return useUndoHistory<SliderDocument>(value, onChange);
}

export { historyChord };
