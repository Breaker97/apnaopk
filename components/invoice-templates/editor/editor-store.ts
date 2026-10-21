"use client";

/**
 * The template editor's state (docs/INVOICE_TEMPLATE_BUILDER.md §4.4, §5.4):
 * the design being edited, its history, the selection and the view.
 *
 * One store per open editor (`createEditorStore`, handed down through
 * `EditorStoreProvider`), so two editors — or two tests — never share one.
 *
 * The rules this file keeps:
 * - Every change to the design goes through `commit`, which records ONE undo
 *   step. Edits that pass the same `group` within 600 ms share a step (typing
 *   into a field, a burst of arrow-key nudges); everything else — add, delete,
 *   duplicate, arrange, a size change — is its own step.
 * - A drag, resize or rotate is a GESTURE: `beginGesture` remembers the
 *   design, `previewGesture` shows each pointer move without touching the
 *   history, and `endGesture` records one step on pointer-up (none if
 *   nothing changed). `cancelGesture` (Esc) puts the design back.
 * - Selection and view (zoom, page view) live beside the design, never in it,
 *   so selecting never writes geometry and never marks the template unsaved.
 * - "Unsaved" is a comparison with the last saved design and name
 *   (`selectIsDirty`), not a flag: undoing back to the saved state clears it.
 */
import { createContext, createElement, useContext, type ReactNode } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { FitResult } from "@/lib/invoice-templates/shrink";
import type { CanvasSizeKey } from "@/lib/invoice-templates/canvas-sizes";
import {
  alignElements,
  distributeElements,
  duplicateElements,
  nextElementId,
  moveLayerTo,
  reorderLayers,
  uniqueElementName,
  type AlignEdge,
  type AlignTarget,
  type LayerMove,
} from "@/lib/invoice-templates/editor/arrange";
import { clampZoom } from "@/lib/invoice-templates/editor/geometry";
import {
  designEquals,
  nudgeElements,
  removeElements,
  setElementFlag,
  updateElements,
  withCanvasSize,
  withCustomSize,
  withElements,
} from "@/lib/invoice-templates/editor/operations";
import { buildPaletteElement, paletteItem, type PaletteItemKey } from "@/lib/invoice-templates/editor/palette";
import { resetDesign, type ResetKind } from "@/lib/invoice-templates/editor/reset";
import { INITIAL_SAVE_STATE, saveTransition, type SaveEvent, type SaveState } from "@/lib/invoice-templates/editor/save-machine";
import {
  TEMPLATE_LIMITS,
  type TemplateCanvas,
  type TemplateCategory,
  type TemplateDesign,
  type TemplateElement,
} from "@/lib/invoice-templates/types";
import { emptyHistory, recordChange, redoChange, undoChange, type UndoHistory } from "@/lib/undo-history";

export type PageView = "single" | "flow";
export type ZoomMode = "fit" | "manual";
export type PanelTab = "design" | "layers" | "review";

export interface CommitOptions {
  /** Edits in the same group within 600 ms share one undo step. Default: a step of its own. */
  group?: string | null;
  /** The selection after the edit. */
  select?: string[];
}

export interface CustomSizeOptions extends CommitOptions {
  /** The margins to fit to the new size (default: the canvas's own); see `withCustomSize`. */
  marginMm?: TemplateCanvas["marginMm"];
}

export interface EditorState {
  category: TemplateCategory;
  /** A draft has never been saved: its baseline is where it started. */
  isDraft: boolean;
  /** The stored template's id; null for a draft. */
  templateId: string | null;
  /** The stored version the baseline is; every save names it (compare-and-set). Null for a draft. */
  version: number | null;
  /** The preset the template was made from; Reset can restore it. */
  presetKey: string | null;
  /** Where the last save got to (save-machine.ts). */
  save: SaveState;
  /** The right panel's open tab. */
  panelTab: PanelTab;
  /** Property sections the designer folded away (a view setting: never saved, never undone). */
  collapsedSections: string[];
  /** What the canvas's renderer measured for shrink-to-fit, by element id (view state: the Review tab reads it). */
  fits: Record<string, FitResult>;
  design: TemplateDesign;
  name: string;
  /** The last saved document; "unsaved" means the current one differs from it. */
  baseline: { design: TemplateDesign; name: string };
  history: UndoHistory<TemplateDesign>;
  /** The design as it was when the current drag, resize or rotate began. */
  gestureBase: TemplateDesign | null;
  /** Selected element ids, in the order they were selected. */
  selection: string[];
  zoom: number;
  zoomMode: ZoomMode;
  pageView: PageView;
  now: () => number;

  // The document ------------------------------------------------------------
  commit: (next: TemplateDesign | ((design: TemplateDesign) => TemplateDesign), options?: CommitOptions) => void;
  /** Changes some fields of one element; pass a group so typing into a field is one step. */
  updateElement: (id: string, patch: Partial<TemplateElement>, options?: CommitOptions) => void;
  /**
   * Changes one element as a function of its latest copy (the property
   * panel's edits: a style key, a binding part, a config field). Prefer this
   * to `updateElement` when the change builds on what the element already
   * holds, so two quick edits never overwrite each other.
   */
  editElement: (id: string, edit: (element: TemplateElement) => TemplateElement, options?: CommitOptions) => void;
  updateCanvas: (patch: Partial<TemplateCanvas>, options?: CommitOptions) => void;
  /** Adds a palette item; returns the new element's id, or `null` at the element limit. */
  addFromPalette: (key: PaletteItemKey, init: { name: string; centre: { xMm: number; yMm: number } }) => string | null;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  /** Duplicates these elements (Layers), selecting the copies. */
  duplicateIds: (ids: readonly string[]) => void;
  nudgeSelection: (dxMm: number, dyMm: number) => void;
  alignSelection: (edge: AlignEdge, target: AlignTarget) => void;
  distributeSelection: (axis: "horizontal" | "vertical") => void;
  reorderSelection: (move: LayerMove) => void;
  /** Moves these elements up or down the layers (Layers' buttons). */
  reorderIds: (ids: readonly string[], move: LayerMove) => void;
  /** Moves one element to a place in the drawing order, 0 = bottom (Layers' drag). */
  moveLayer: (id: string, index: number) => void;
  setFlag: (ids: readonly string[], flag: "hidden" | "locked", value: boolean) => void;
  setCanvasSize: (key: CanvasSizeKey) => void;
  setCustomSize: (widthMm: number, heightMm: number, options?: CustomSizeOptions) => void;
  /** The Reset dialog's choices: one undo step; nothing is saved. */
  reset: (kind: ResetKind) => void;
  /** A recovered local copy back on the canvas: one undo step, and its name. */
  restoreDocument: (design: TemplateDesign, name: string) => void;
  undo: () => void;
  redo: () => void;

  // Gestures ------------------------------------------------------------------
  /**
   * Starts a drag, resize or rotate on the design as it is now. Pass the
   * design the press was made on: if an edit changed it since (a Delete or
   * an undo before the pointer travelled 3 px), nothing starts and `false`
   * comes back, so the gesture can't put that edit back.
   */
  beginGesture: (pressedOn?: TemplateDesign) => boolean;
  previewGesture: (next: TemplateDesign) => void;
  endGesture: () => void;
  cancelGesture: () => void;

  // Selection, view, name -------------------------------------------------------
  select: (ids: string[]) => void;
  toggleSelected: (id: string) => void;
  clearSelection: () => void;
  setZoom: (zoom: number) => void;
  /** The canvas reports what "Fit" is for its current size; applied only while fitting. */
  setFitZoom: (zoom: number) => void;
  fitToView: () => void;
  setPageView: (view: PageView) => void;
  setName: (name: string) => void;
  setPanelTab: (tab: PanelTab) => void;
  /** Folds or unfolds a property section (kept across selections). */
  toggleSection: (id: string) => void;
  /** The canvas reports its shrink-to-fit measurements (applied only when they differ). */
  setFits: (fits: Record<string, FitResult>) => void;
  /**
   * A save landed: this is now the saved document (what was sent, even if
   * the canvas has moved on since). The history stays.
   */
  markSaved: (design: TemplateDesign, name: string, stored?: { id: string; version: number }) => void;
  dispatchSave: (event: SaveEvent) => void;
}

export interface EditorInit {
  category: TemplateCategory;
  design: TemplateDesign;
  name: string;
  isDraft: boolean;
  templateId?: string | null;
  version?: number | null;
  presetKey?: string | null;
  /** A fixed zoom instead of "Fit" (tests, or a remembered zoom). */
  zoom?: number;
  /** The clock the history groups edits by. */
  now?: () => number;
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

export function createEditorStore(init: EditorInit): StoreApi<EditorState> {
  return createStore<EditorState>()((set, get) => {
    /** Keeps only ids that still exist (after an undo, a delete). */
    const pruned = (selection: string[], design: TemplateDesign) => {
      const ids = new Set(design.elements.map((element) => element.id));
      const kept = selection.filter((id) => ids.has(id));
      return kept.length === selection.length ? selection : kept;
    };

    const commit: EditorState["commit"] = (next, options = {}) => {
      const state = get();
      if (state.gestureBase) return;
      const design = typeof next === "function" ? next(state.design) : next;
      const selection = options.select ?? state.selection;
      if (design === state.design || designEquals(design, state.design)) {
        if (!sameIds(selection, state.selection)) set({ selection: pruned(selection, state.design) });
        return;
      }
      set({
        design,
        history: recordChange(state.history, state.design, { now: state.now(), group: options.group ?? null }),
        selection: pruned(selection, design),
      });
    };

    const movableSelection = () => {
      const { design, selection } = get();
      return design.elements.filter((element) => selection.includes(element.id) && !element.locked).map((element) => element.id);
    };

    return {
      category: init.category,
      isDraft: init.isDraft,
      templateId: init.templateId ?? null,
      version: init.version ?? null,
      presetKey: init.presetKey ?? null,
      save: INITIAL_SAVE_STATE,
      panelTab: "design",
      collapsedSections: [],
      fits: {},
      design: init.design,
      name: init.name,
      baseline: { design: init.design, name: init.name },
      history: emptyHistory<TemplateDesign>(),
      gestureBase: null,
      selection: [],
      zoom: init.zoom === undefined ? 1 : clampZoom(init.zoom),
      zoomMode: init.zoom === undefined ? "fit" : "manual",
      pageView: "single",
      now: init.now ?? Date.now,

      commit,

      updateElement: (id, patch, options) =>
        commit((design) => updateElements(design, [id], (element) => ({ ...element, ...patch }) as TemplateElement), options),

      editElement: (id, edit, options) => commit((design) => updateElements(design, [id], edit), options),

      updateCanvas: (patch, options) => commit((design) => ({ ...design, canvas: { ...design.canvas, ...patch } }), options),

      addFromPalette: (key, { name, centre }) => {
        const { design, category } = get();
        if (design.elements.length >= TEMPLATE_LIMITS.elements) return null;
        const { type } = paletteItem(key);
        const id = nextElementId(type, new Set(design.elements.map((element) => element.id)));
        const element = buildPaletteElement(key, {
          design,
          category,
          id,
          name: uniqueElementName(name, design.elements.map((each) => each.name)),
          zIndex: Math.max(-1, ...design.elements.map((each) => each.zIndex)) + 1,
          centre,
        });
        commit({ ...design, elements: [...design.elements, element] }, { select: [id] });
        // "The new element is selected and its properties open" (§5.3).
        set({ panelTab: "design" });
        return id;
      },

      deleteSelection: () => {
        const { selection } = get();
        if (selection.length === 0) return;
        // Locked elements stay (and stay selected) until they are unlocked.
        commit((design) => removeElements(design, selection));
      },

      duplicateSelection: () => get().duplicateIds(get().selection),

      duplicateIds: (ids) => {
        const { design } = get();
        if (ids.length === 0) return;
        if (design.elements.length + ids.length > TEMPLATE_LIMITS.elements) return;
        const result = duplicateElements(design.elements, ids, design.locale);
        commit({ ...design, elements: result.elements }, { select: result.ids });
      },

      nudgeSelection: (dxMm, dyMm) => {
        const ids = movableSelection();
        if (ids.length === 0) return;
        // A burst of nudges to the same elements is one step.
        commit((design) => nudgeElements(design, ids, dxMm, dyMm), { group: `nudge:${ids.join(",")}` });
      },

      alignSelection: (edge, target) => {
        const { selection } = get();
        if (selection.length === 0) return;
        commit((design) => withElements(design, alignElements(design.elements, selection, edge, target, design.canvas)));
      },

      distributeSelection: (axis) => {
        const { selection } = get();
        commit((design) => withElements(design, distributeElements(design.elements, selection, axis)));
      },

      reorderSelection: (move) => get().reorderIds(get().selection, move),

      reorderIds: (ids, move) => {
        if (ids.length === 0) return;
        commit((design) => withElements(design, reorderLayers(design.elements, ids, move)));
      },

      moveLayer: (id, index) => commit((design) => withElements(design, moveLayerTo(design.elements, id, index))),

      setFlag: (ids, flag, value) => commit((design) => setElementFlag(design, ids, flag, value)),

      setCanvasSize: (key) => commit((design) => withCanvasSize(design, key)),
      setCustomSize: (widthMm, heightMm, { marginMm, ...options } = {}) =>
        commit((design) => withCustomSize(design, widthMm, heightMm, marginMm), options),

      reset: (kind) => {
        const state = get();
        const next = resetDesign(kind, { design: state.design, baseline: state.baseline.design, presetKey: state.presetKey });
        commit(next, kind === "styles" ? {} : { select: [] });
        if (kind === "discard") set({ name: state.baseline.name });
      },

      restoreDocument: (design, name) => {
        commit(design, { select: [] });
        set({ name });
      },

      undo: () => {
        const state = get();
        if (state.gestureBase) return;
        const step = undoChange(state.history, state.design);
        if (!step) return;
        set({ design: step.value, history: step.history, selection: pruned(state.selection, step.value) });
      },

      redo: () => {
        const state = get();
        if (state.gestureBase) return;
        const step = redoChange(state.history, state.design);
        if (!step) return;
        set({ design: step.value, history: step.history, selection: pruned(state.selection, step.value) });
      },

      beginGesture: (pressedOn) => {
        const state = get();
        const current = state.gestureBase ?? state.design;
        if (pressedOn && pressedOn !== current && !designEquals(pressedOn, current)) return false;
        if (!state.gestureBase) set({ gestureBase: state.design });
        return true;
      },

      previewGesture: (next) => {
        if (!get().gestureBase) return;
        set({ design: next });
      },

      endGesture: () => {
        const state = get();
        const base = state.gestureBase;
        if (!base) return;
        if (state.design === base || designEquals(state.design, base)) {
          set({ gestureBase: null, design: base });
          return;
        }
        set({
          gestureBase: null,
          history: recordChange(state.history, base, { now: state.now(), group: null }),
        });
      },

      cancelGesture: () => {
        const base = get().gestureBase;
        if (base) set({ gestureBase: null, design: base });
      },

      select: (ids) => {
        const state = get();
        const next = pruned([...new Set(ids)], state.design);
        if (!sameIds(next, state.selection)) set({ selection: next });
      },

      toggleSelected: (id) => {
        const { selection } = get();
        get().select(selection.includes(id) ? selection.filter((each) => each !== id) : [...selection, id]);
      },

      clearSelection: () => {
        if (get().selection.length > 0) set({ selection: [] });
      },

      setZoom: (zoom) => set({ zoom: clampZoom(zoom), zoomMode: "manual" }),
      setFitZoom: (zoom) => {
        const state = get();
        const next = clampZoom(zoom);
        if (state.zoomMode === "fit" && Math.abs(state.zoom - next) > 1e-4) set({ zoom: next });
      },
      fitToView: () => set({ zoomMode: "fit" }),
      setPageView: (pageView) => set({ pageView }),
      setName: (name) => set({ name }),
      setPanelTab: (panelTab) => set({ panelTab }),
      setFits: (fits) =>
        set((state) => {
          const keys = Object.keys(fits);
          const same =
            keys.length === Object.keys(state.fits).length &&
            keys.every((key) => state.fits[key]?.px === fits[key]!.px && state.fits[key]?.fits === fits[key]!.fits);
          return same ? state : { fits };
        }),
      toggleSection: (id) =>
        set((state) => ({
          collapsedSections: state.collapsedSections.includes(id)
            ? state.collapsedSections.filter((each) => each !== id)
            : [...state.collapsedSections, id],
        })),
      markSaved: (design, name, stored) =>
        set({
          baseline: { design, name },
          isDraft: false,
          ...(stored ? { templateId: stored.id, version: stored.version } : {}),
        }),
      dispatchSave: (event) => {
        const save = saveTransition(get().save, event);
        if (save !== get().save) set({ save });
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectIsDirty = (state: EditorState): boolean =>
  state.name !== state.baseline.name || !designEquals(state.design, state.baseline.design);
export const selectCanUndo = (state: EditorState): boolean => !state.gestureBase && state.history.past.length > 0;
export const selectCanRedo = (state: EditorState): boolean => !state.gestureBase && state.history.future.length > 0;

/** The selected elements, in selection order. */
export function selectedElements(state: Pick<EditorState, "design" | "selection">): TemplateElement[] {
  const byId = new Map(state.design.elements.map((element) => [element.id, element]));
  return state.selection.map((id) => byId.get(id)).filter((element): element is TemplateElement => Boolean(element));
}

// ---------------------------------------------------------------------------
// React
// ---------------------------------------------------------------------------

const EditorStoreContext = createContext<StoreApi<EditorState> | null>(null);

export function EditorStoreProvider({ store, children }: { store: StoreApi<EditorState>; children: ReactNode }) {
  return createElement(EditorStoreContext.Provider, { value: store }, children);
}

/** The store itself, for event handlers that read the latest state (`getState`). */
export function useEditorApi(): StoreApi<EditorState> {
  const store = useContext(EditorStoreContext);
  if (!store) throw new Error("useEditorApi must be used inside <EditorStoreProvider>");
  return store;
}

export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useStore(useEditorApi(), selector);
}
