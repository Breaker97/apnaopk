/**
 * Undo and redo over any immutable document, as plain data.
 *
 * A history is the documents that went before the current one (`past`) and
 * the ones an undo stepped back from (`future`). Edits that land within a
 * breath of each other in the same GROUP — keystrokes into one field, a
 * burst of arrow-key nudges — collapse into one step, so undo takes back a
 * word or a nudge, not a letter or a millimetre. An edit with no group is
 * always its own step. The stack is capped; a merchant who has made two
 * hundred edits does not need the first.
 *
 * Pure: the caller owns the current document and the clock. The slider
 * editor's hook (`useUndoHistory`) and the invoice template editor's store
 * both run on these functions.
 */

/** Edits in the same group closer together than this share one step. */
export const HISTORY_COALESCE_MS = 600;
/** The most steps undo can take back. */
export const HISTORY_MAX_STEPS = 100;

export interface UndoHistory<T> {
  readonly past: readonly T[];
  readonly future: readonly T[];
  /** The group of the last recorded edit; `null` after an undo, a redo or an ungrouped edit. */
  readonly group: string | null;
  /** When the last recorded edit landed. */
  readonly at: number;
}

export interface RecordOptions {
  now: number;
  /**
   * Edits with the same group within `coalesceMs` of the previous one share
   * its step. `null` (the default) always opens a new step.
   */
  group?: string | null;
  coalesceMs?: number;
  maxSteps?: number;
}

export function emptyHistory<T>(): UndoHistory<T> {
  return { past: [], future: [], group: null, at: 0 };
}

/**
 * The history after `previous` was replaced by an edit. A new edit always
 * clears redo. Within a burst the step keeps the document it opened with,
 * and the window slides: each edit restarts it.
 */
export function recordChange<T>(history: UndoHistory<T>, previous: T, options: RecordOptions): UndoHistory<T> {
  const group = options.group ?? null;
  const coalesceMs = options.coalesceMs ?? HISTORY_COALESCE_MS;
  const maxSteps = options.maxSteps ?? HISTORY_MAX_STEPS;
  const joins =
    group !== null && group === history.group && history.past.length > 0 && options.now - history.at <= coalesceMs;
  return {
    past: joins ? history.past : [...history.past.slice(-(maxSteps - 1)), previous],
    future: [],
    group,
    at: options.now,
  };
}

/** One step back: the document to show and the history after it, or `null` with nothing to undo. */
export function undoChange<T>(history: UndoHistory<T>, current: T): { history: UndoHistory<T>; value: T } | null {
  if (history.past.length === 0) return null;
  const value = history.past[history.past.length - 1]!;
  return {
    value,
    history: { past: history.past.slice(0, -1), future: [current, ...history.future], group: null, at: 0 },
  };
}

/** One step forward again, or `null` with nothing to redo. */
export function redoChange<T>(history: UndoHistory<T>, current: T): { history: UndoHistory<T>; value: T } | null {
  if (history.future.length === 0) return null;
  const [value, ...rest] = history.future;
  return {
    value: value!,
    history: { past: [...history.past, current], future: rest, group: null, at: 0 },
  };
}
