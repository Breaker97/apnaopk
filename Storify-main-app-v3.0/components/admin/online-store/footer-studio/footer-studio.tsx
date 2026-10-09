"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Loader2, Redo2, RotateCcw, Save, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import {
  createTSafe,
  type TSafe,
} from "@/components/admin/online-store/t-safe";
import {
  normalizeFooterSettings,
  type FooterSettings,
} from "@/lib/site-config/footer-config";
import {
  createFooterItem,
  resolveFooterLayout,
  MAX_FOOTER_ROWS,
  type FooterItemKind,
  type FooterLayout,
} from "@/lib/site-config/footer-layout";
import {
  addColumn,
  addRow,
  findColumn,
  findItem,
  insertItem,
  moveItem,
  moveRow,
  patchColumn,
  patchItem,
  patchRow,
  removeColumn,
  removeItem,
  removeRow,
} from "./mutations";
import { FooterCanvas } from "./canvas";
import { FooterItemDrawer } from "./item-drawer";
import { FooterPropertyPanel, type FooterSelection } from "./property-panel";
import { footerItemMeta } from "./layout-style";

/**
 * The Footer Studio: the footer edited as a layout, the way the header is.
 *
 * A store that has never opened this gets its existing footer as the
 * starting layout (`resolveFooterLayout` → `footerLayoutFromSettings`), so
 * the canvas opens on the merchant's own footer rather than a blank page and
 * there is nothing to migrate up front.
 */

type DragData =
  | { kind: "row" }
  | { kind: "column"; columnId: string }
  | { kind: "item"; itemId: string; columnId: string }
  | { kind: "new"; itemType: FooterItemKind };

/**
 * A row's sortable registers a droppable that WRAPS its columns, so plain
 * closest-centre always awards an item drop to the row and items never reach
 * a column. Filtering by kind is what makes columns reachable at all.
 *
 * Items then land only under the pointer: closest-centre dropped an item
 * into whichever column happened to be nearest, so releasing over the page
 * margin flung it somewhere the merchant never pointed. Rows keep
 * closest-centre — a row drag is a reorder along one axis, where snapping to
 * the nearest neighbour is the point.
 */
const collisionDetection: CollisionDetection = (args) => {
  const activeKind = (args.active.data.current as DragData | undefined)?.kind;
  const droppableContainers = args.droppableContainers.filter((container) => {
    const kind = (container.data.current as DragData | undefined)?.kind;
    return activeKind === "row"
      ? kind === "row"
      : kind === "column" || kind === "item";
  });
  if (activeKind !== "row" && args.pointerCoordinates) {
    return pointerWithin({ ...args, droppableContainers });
  }
  return closestCenter({ ...args, droppableContainers });
};

interface SettingsPayload {
  success?: boolean;
  data?: { footer?: unknown };
}

export function FooterStudio({ locale }: { locale: string }) {
  const t = useTranslations();
  // Memoised on `t`: the load effect depends on it, and a fresh closure per
  // render would refetch the settings forever.
  const tSafe = useMemo(() => createTSafe(t), [t]);

  const [settings, setSettings] = useState<FooterSettings | null>(null);
  const [layout, setLayoutState] = useState<FooterLayout | null>(null);
  /**
   * Undo/redo. The footer form this replaces has had it since before the
   * studio existed, so arriving without it would be a step down for the one
   * surface whose merchants already expect it — the header studio has none,
   * and that is the header's gap, not a pattern to copy.
   *
   * The ref mirrors the state because a keyboard handler registered once
   * would otherwise push a stale layout onto the stack.
   */
  const [undoStack, setUndoStack] = useState<FooterLayout[]>([]);
  const [redoStack, setRedoStack] = useState<FooterLayout[]>([]);
  const layoutRef = useRef<FooterLayout | null>(null);
  const [savedLayout, setSavedLayout] = useState<FooterLayout | null>(null);
  const [selection, setSelection] = useState<FooterSelection>(null);
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  /**
   * Every edit goes through here. A no-op edit is dropped rather than
   * pushed: dragging an item back where it started would otherwise cost a
   * press of undo that appears to do nothing.
   */
  const setLayout = useCallback((next: FooterLayout) => {
    const current = layoutRef.current;
    if (current && JSON.stringify(current) === JSON.stringify(next)) return;
    if (current) setUndoStack((stack) => [...stack, current].slice(-50));
    setRedoStack([]);
    setLayoutState(next);
  }, []);

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const previous = stack[stack.length - 1];
      const current = layoutRef.current;
      if (current) setRedoStack((redo) => [...redo, current]);
      setLayoutState(previous);
      return stack.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const next = stack[stack.length - 1];
      const current = layoutRef.current;
      if (current) setUndoStack((undoEntries) => [...undoEntries, current]);
      setLayoutState(next);
      return stack.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") {
        return;
      }
      // Not while the merchant is typing into a field — there, the
      // browser's own undo is the one they mean.
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/admin/settings", { method: "GET" });
        const payload = (await response.json()) as SettingsPayload;
        if (!response.ok || payload.success !== true) throw new Error("failed");
        const parsed = normalizeFooterSettings(payload.data?.footer);
        // The footer the store ALREADY has, when nothing has been built.
        const resolved = resolveFooterLayout(parsed.builder, parsed);
        setSettings(parsed);
        setLayoutState(resolved);
        setSavedLayout(resolved);
        setUndoStack([]);
        setRedoStack([]);
      } catch {
        toast.error(
          tSafe("admin.footerStudio.toast.loadFailed", "Could not load the footer"),
        );
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [tSafe]);

  const dirty = useMemo(
    () => JSON.stringify(layout) !== JSON.stringify(savedLayout),
    [layout, savedLayout],
  );

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  /** Where a clicked palette chip lands: the selected column, else the last. */
  const targetColumnId = useMemo(() => {
    if (!layout) return null;
    if (selection?.kind === "column") return selection.columnId;
    if (selection?.kind === "item") {
      return columnHolding(layout, selection.itemId);
    }
    const lastRow = layout.rows[layout.rows.length - 1];
    return lastRow?.columns[lastRow.columns.length - 1]?.id ?? null;
  }, [layout, selection]);

  const addItemToColumn = (
    columnId: string,
    kind: FooterItemKind,
    index?: number,
  ) => {
    if (!layout) return;
    const item = createFooterItem(kind);
    const next = insertItem(layout, columnId, item, index);
    // insertItem refuses silently when the column is full, so the caller has
    // to check — otherwise the chip simply never appears and nothing says why.
    if (!findItem(next, item.id)) {
      toast.error(
        tSafe(
          "admin.footerStudio.toast.columnFull",
          "That column is full — remove an item first",
        ),
      );
      return;
    }
    setLayout(next);
    setSelection({ kind: "item", itemId: item.id });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!layout || !over) return;
    const from = active.data.current as DragData | undefined;
    const to = over.data.current as DragData | undefined;
    if (!from || !to) return;

    if (from.kind === "row") {
      if (to.kind !== "row") return;
      setLayout(moveRow(layout, String(active.id), String(over.id)));
      return;
    }

    const columnId = to.kind === "column" || to.kind === "item" ? to.columnId : null;
    if (!columnId) return;

    // Dropping onto an item inserts before it; dropping on the column appends.
    const found =
      to.kind === "item"
        ? findColumn(layout, columnId)?.items.findIndex(
            (item) => item.id === to.itemId,
          )
        : undefined;
    const index = found === undefined || found < 0 ? undefined : found;

    if (from.kind === "new") {
      addItemToColumn(columnId, from.itemType, index);
      return;
    }
    if (from.kind === "item") {
      setLayout(moveItem(layout, from.itemId, columnId, index));
    }
  };

  const save = async () => {
    if (!settings || !layout) return;
    try {
      setIsSaving(true);
      const normalized = normalizeFooterSettings({ ...settings, builder: layout });
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "footer", data: normalized }),
      });
      const payload = (await response.json()) as SettingsPayload;
      if (!response.ok || payload.success !== true) throw new Error("failed");
      const saved = normalizeFooterSettings(payload.data?.footer ?? normalized);
      setSettings(saved);
      // Read the layout back from what the SERVER stored, not from what was
      // sent: the allow-list and the normalizer both sit in between, and a
      // key either one drops would otherwise look saved until a reload.
      const savedTree = resolveFooterLayout(saved.builder, saved);
      setLayoutState(savedTree);
      setSavedLayout(savedTree);
      setUndoStack([]);
      setRedoStack([]);
      toast.success(tSafe("admin.footerStudio.toast.saved", "Footer saved"));
    } catch {
      toast.error(tSafe("admin.footerStudio.toast.saveFailed", "Saving failed"));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || !layout) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {tSafe("admin.footerStudio.title", "Footer Studio")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {tSafe(
              "admin.footerStudio.subtitle",
              "The footer as rows of columns. It opens on the footer you already have.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={cnDot(dirty)}
              aria-hidden
            />
            {dirty
              ? tSafe("admin.footerStudio.unsaved", "Unsaved changes")
              : tSafe("admin.footerStudio.allSaved", "All changes saved")}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={undoStack.length === 0}
            onClick={undo}
            aria-label={tSafe("admin.footerStudio.undo", "Undo")}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={redoStack.length === 0}
            onClick={redo}
            aria-label={tSafe("admin.footerStudio.redo", "Redo")}
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={!dirty || isSaving}
            onClick={() => {
              if (savedLayout) setLayout(savedLayout);
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {tSafe("admin.footerStudio.discard", "Discard")}
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={!dirty || isSaving}
            onClick={() => void save()}
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {tSafe("admin.footerStudio.save", "Save")}
          </Button>
        </div>
      </div>

      {/* The drawer and the canvas share ONE DndContext — that is what lets a
          palette chip be dragged straight into a column. */}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={(event: DragStartEvent) =>
          setActiveDrag((event.active.data.current as DragData | undefined) ?? null)
        }
        onDragCancel={() => setActiveDrag(null)}
        onDragEnd={handleDragEnd}
      >
        <FooterItemDrawer
          tSafe={tSafe}
          onAdd={(meta) => {
            if (!targetColumnId) return;
            addItemToColumn(targetColumnId, meta.type);
          }}
        />

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <FooterCanvas
            layout={layout}
            selection={selection}
            tSafe={tSafe}
            onSelect={setSelection}
            onAddRow={() => {
              if (layout.rows.length >= MAX_FOOTER_ROWS) return;
              setLayout(addRow(layout));
            }}
            onRemoveRow={(rowId) => {
              setLayout(removeRow(layout, rowId));
              setSelection(null);
            }}
            onAddColumn={(rowId) => setLayout(addColumn(layout, rowId))}
            onRemoveColumn={(rowId, columnId) => {
              setLayout(removeColumn(layout, rowId, columnId));
              setSelection(null);
            }}
            onRemoveItem={(itemId) => {
              setLayout(removeItem(layout, itemId));
              setSelection(null);
            }}
          />

          <aside className="lg:sticky lg:top-4">
            <FooterPropertyPanel
              layout={layout}
              selection={selection}
              tSafe={tSafe}
              onPatchRow={(rowId, patch) => setLayout(patchRow(layout, rowId, patch))}
              onPatchColumn={(columnId, patch) =>
                setLayout(patchColumn(layout, columnId, patch))
              }
              onPatchItem={(itemId, patch) =>
                setLayout(patchItem(layout, itemId, patch))
              }
              onRemoveRow={(rowId) => {
                setLayout(removeRow(layout, rowId));
                setSelection(null);
              }}
              onRemoveItem={(itemId) => {
                setLayout(removeItem(layout, itemId));
                setSelection(null);
              }}
            />
          </aside>
        </div>

        <DragOverlay>
          {activeDrag && (activeDrag.kind === "new" || activeDrag.kind === "item") ? (
            <DragChip drag={activeDrag} layout={layout} tSafe={tSafe} />
          ) : null}
        </DragOverlay>
      </DndContext>

      <p className="text-xs text-muted-foreground">
        {tSafe(
          "admin.footerStudio.previewHint",
          "Save, then open the shop to see it live.",
        )}{" "}
        <a
          className="underline hover:text-foreground"
          href={`/${locale}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {tSafe("admin.footerStudio.openShop", "Open the shop")}
        </a>
      </p>
    </div>
  );
}

/** Which column holds an item — the canvas knows, the shell has to ask. */
function columnHolding(layout: FooterLayout, itemId: string): string | null {
  for (const row of layout.rows) {
    for (const column of row.columns) {
      if (column.items.some((item) => item.id === itemId)) return column.id;
    }
  }
  return null;
}

/** The dot beside the save state — amber while there is something to save. */
function cnDot(dirty: boolean): string {
  return `inline-block h-1.5 w-1.5 rounded-full ${dirty ? "bg-amber-500" : "bg-emerald-500"}`;
}

function DragChip({
  drag,
  layout,
  tSafe,
}: {
  drag: DragData;
  layout: FooterLayout;
  tSafe: TSafe;
}) {
  const kind =
    drag.kind === "new"
      ? drag.itemType
      : drag.kind === "item"
        ? findItem(layout, drag.itemId)?.type
        : undefined;
  if (!kind) return null;
  const meta = footerItemMeta(kind);
  const Icon = meta.icon;
  return (
    <span className="flex h-8 items-center gap-1.5 rounded-[8px] border border-primary bg-background px-2.5 text-xs font-medium shadow-lg">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      {tSafe(`admin.footerStudio.items.${meta.type}`, meta.label)}
    </span>
  );
}
