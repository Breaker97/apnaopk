import type { StudioSession, StudioVersion } from "./types";

/**
 * Pure version-history transitions for a studio session. Kept free of React so
 * the undo/redo semantics are directly testable: appending after an undo
 * discards the redo tail, and stepping clamps to the history bounds.
 */

/** Append a version after the current index, discarding any redo tail. */
export function appendVersion(
  session: StudioSession,
  version: StudioVersion,
): StudioSession {
  const versions = [...session.versions.slice(0, session.index + 1), version];
  return { versions, index: versions.length - 1 };
}

/** Step the history index by delta, clamped to [0, last]. */
export function stepHistoryIndex(
  session: StudioSession,
  delta: number,
): number {
  return Math.min(
    session.versions.length - 1,
    Math.max(0, session.index + delta),
  );
}
