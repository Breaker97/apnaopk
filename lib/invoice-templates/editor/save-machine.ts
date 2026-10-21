/**
 * The editor's save states (docs/INVOICE_TEMPLATE_BUILDER.md §5.2, §7 Phase 4
 * "the save state machine"):
 *
 *   idle ──start──▶ saving ──success──▶ saved
 *                     │  ├──failure──▶ error
 *                     │  └──conflict─▶ conflict (409 stale_version: Reload / Overwrite)
 *   saved, error, conflict ──start──▶ saving       (Save again, Overwrite)
 *   error, conflict ──dismiss──▶ idle
 *
 * "Unsaved" is not a state here: it is the comparison with the last saved
 * document (`selectIsDirty`). A `start` while saving is ignored, which is
 * what stops a double submit. Every other event that doesn't fit the state is
 * ignored too, so a late answer can't move a machine that has moved on.
 *
 * Pure and client-safe.
 */
export const SAVE_STATUSES = ["idle", "saving", "saved", "error", "conflict"] as const;
export type SaveStatus = (typeof SAVE_STATUSES)[number];

/** Save onto the template, or Save as… a new one. */
export type SaveKind = "save" | "saveAs";

export interface SaveState {
  status: SaveStatus;
  /** What the current or last attempt was. */
  kind?: SaveKind;
  /** `error`: what went wrong, in words. */
  error?: string;
  /** `conflict`: the version the server has now; Overwrite saves onto it. */
  currentVersion?: number;
  /** `saved`: when, for "Saved" in the toolbar. */
  at?: number;
}

export type SaveEvent =
  | { type: "start"; kind: SaveKind }
  | { type: "success"; at: number }
  | { type: "failure"; error: string }
  | { type: "conflict"; currentVersion: number }
  | { type: "dismiss" };

export const INITIAL_SAVE_STATE: SaveState = { status: "idle" };

export function canStartSave(state: SaveState): boolean {
  return state.status !== "saving";
}

export function saveTransition(state: SaveState, event: SaveEvent): SaveState {
  switch (event.type) {
    case "start":
      return canStartSave(state) ? { status: "saving", kind: event.kind } : state;
    case "success":
      return state.status === "saving" ? { status: "saved", kind: state.kind, at: event.at } : state;
    case "failure":
      return state.status === "saving" ? { status: "error", kind: state.kind, error: event.error } : state;
    case "conflict":
      return state.status === "saving" ? { status: "conflict", kind: state.kind, currentVersion: event.currentVersion } : state;
    case "dismiss":
      return state.status === "error" || state.status === "conflict" ? INITIAL_SAVE_STATE : state;
    default:
      return state;
  }
}
