"use client";

import { GripVertical, Megaphone, Plus, Trash2 } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type {
  AnnouncementDraft,
} from "@/components/admin/online-store/header-chrome-state";
import {
  MAX_HEADER_ITEMS_PER_COLUMN,
  MAX_HEADER_ROWS,
  visibleColumns,
  type HeaderLayout,
  type HeaderLayoutColumn,
  type HeaderLayoutItem,
  type HeaderLayoutRow,
} from "@/lib/site-config/header-layout";
import { itemMeta } from "@/components/admin/online-store/header-studio/layout-style";
import type { StudioSelection } from "@/components/admin/online-store/header-studio/property-panel";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import { cn } from "@/lib/utils";

/**
 * The Figma canvas: the header as a stack of rows, each row a set of column
 * placeholders holding item chips. Selection drives the property panel, so
 * every level is clickable — and clicking a column must not also select the
 * row behind it, which is why the handlers stop propagation.
 *
 * Drag and drop is wired by the studio shell: one DndContext spans the
 * drawer and this canvas so a chip can be dragged straight from one to the
 * other.
 *
 * The announcement bar is pinned above the layout rows. It sits outside the
 * sortable list on purpose: the storefront always paints it above the
 * header, so letting it be dragged between the rows would promise a
 * placement the storefront cannot keep. (The trending tags that used to be
 * pinned below are ordinary Nav Links items in an ordinary row now.)
 */
export function StudioCanvas({
  layout,
  selection,
  announcement,
  tSafe,
  onSelect,
  onAddRow,
  onRemoveRow,
  onRemoveItem,
  onToggleAnnouncement,
}: {
  layout: HeaderLayout;
  selection: StudioSelection;
  announcement: AnnouncementDraft;
  tSafe: TSafe;
  onSelect: (selection: StudioSelection) => void;
  onAddRow: () => void;
  onRemoveRow: (rowId: string) => void;
  onRemoveItem: (itemId: string) => void;
  onToggleAnnouncement: (enabled: boolean) => void;
}) {
  return (
    <div className="space-y-2.5">
      <ChromeRow
        icon={Megaphone}
        label={tSafe("admin.headerStudio.chrome.announcement", "Announcement bar")}
        enabled={announcement.enabled}
        isSelected={selection?.kind === "announcement"}
        tSafe={tSafe}
        onSelect={() => onSelect({ kind: "announcement" })}
        onToggle={onToggleAnnouncement}
      >
        {announcement.text.trim() ? (
          <span className="truncate text-muted-foreground">
            {announcement.text}
          </span>
        ) : (
          <span className="truncate italic text-muted-foreground">
            {tSafe("admin.headerStudio.chrome.noText", "No text yet")}
          </span>
        )}
      </ChromeRow>

      <SortableContext
        items={layout.rows.map((row) => row.id)}
        strategy={verticalListSortingStrategy}
      >
        {layout.rows.map((row) => (
          <CanvasRow
            key={row.id}
            row={row}
            selection={selection}
            tSafe={tSafe}
            onSelect={onSelect}
            onRemoveRow={() => onRemoveRow(row.id)}
            onRemoveItem={onRemoveItem}
          />
        ))}
      </SortableContext>

      {/* Last on the canvas, so it is under the merchant's hand after the
          rows they have been building. */}
      <Button
        type="button"
        variant="ghost"
        disabled={layout.rows.length >= MAX_HEADER_ROWS}
        onClick={onAddRow}
        className="mx-auto flex h-10 w-1/2 min-w-40 items-center gap-2 rounded-[4px] border border-dashed border-primary/40 bg-primary/5 text-xs font-semibold text-primary hover:bg-primary/10"
      >
        {tSafe("admin.headerStudio.canvas.addRow", "Row")}
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

/**
 * A pinned chrome row: the same card as a layout row, minus the grip and
 * the trash — it cannot move and is switched off rather than removed, so
 * the merchant's copy survives a change of mind. The switch stops the
 * click so flipping it does not also change the selection.
 */
function ChromeRow({
  icon: Icon,
  label,
  enabled,
  isSelected,
  tSafe,
  onSelect,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  label: string;
  enabled: boolean;
  isSelected: boolean;
  tSafe: TSafe;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
  children: ReactNode;
}) {
  const toggleLabel = enabled
    ? tSafe("admin.headerStudio.chrome.hide", "Hide")
    : tSafe("admin.headerStudio.chrome.show", "Show");

  return (
    <div
      role="group"
      aria-label={label}
      onClick={onSelect}
      className={cn(
        "flex items-stretch gap-2 rounded-[12px] border bg-card p-3 shadow-xs transition-shadow",
        isSelected && "border-emerald-500 ring-2 ring-emerald-500/30",
        !enabled && "border-dashed",
      )}
    >
      <span className="flex items-center text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>

      <div
        className={cn(
          "flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-[4px] border border-dashed border-border bg-muted/50 px-3 py-2 text-xs",
          !enabled && "opacity-60",
        )}
      >
        <span className="shrink-0 font-medium">{label}</span>
        <span className="flex min-w-0 flex-1 items-center">{children}</span>
        {!enabled ? (
          <Badge variant="outline" className="shrink-0">
            {tSafe("admin.headerStudio.chrome.hidden", "Hidden")}
          </Badge>
        ) : null}
      </div>

      <span
        className="flex items-center"
        onClick={(event) => event.stopPropagation()}
      >
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          aria-label={`${toggleLabel}: ${label}`}
        />
      </span>
    </div>
  );
}

function CanvasRow({
  row,
  selection,
  tSafe,
  onSelect,
  onRemoveRow,
  onRemoveItem,
}: {
  row: HeaderLayoutRow;
  selection: StudioSelection;
  tSafe: TSafe;
  onSelect: (selection: StudioSelection) => void;
  onRemoveRow: () => void;
  onRemoveItem: (itemId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id, data: { kind: "row" } });

  const isSelected = selection?.kind === "row" && selection.rowId === row.id;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      role="group"
      aria-label={tSafe("admin.headerStudio.canvas.row", "Header row")}
      onClick={() => onSelect({ kind: "row", rowId: row.id })}
      className={cn(
        "group/row flex items-stretch gap-2 rounded-[12px] border bg-card p-3 shadow-xs transition-shadow",
        isSelected && "border-emerald-500 ring-2 ring-emerald-500/30",
        isDragging && "opacity-70",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label={tSafe("admin.headerStudio.canvas.reorderRow", "Reorder row")}
        onClick={(event) => event.stopPropagation()}
        className="flex cursor-grab items-center text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div
        className="grid min-w-0 flex-1"
        style={{
          // The columns' own shares, as the preview draws them: a 3.2fr
          // search column reads as the wide one here too, so the canvas
          // and the header agree on which column is which.
          gridTemplateColumns: visibleColumns(row)
            .map((column) => `minmax(0, ${column.width}fr)`)
            .join(" "),
          columnGap: row.gap,
        }}
      >
        {visibleColumns(row).map((column) => (
          <CanvasColumn
            key={column.id}
            row={row}
            column={column}
            selection={selection}
            tSafe={tSafe}
            onSelect={onSelect}
            onRemoveItem={onRemoveItem}
          />
        ))}
      </div>

      <button
        type="button"
        aria-label={tSafe("admin.headerStudio.panel.removeRow", "Remove row")}
        onClick={(event) => {
          event.stopPropagation();
          onRemoveRow();
        }}
        className="flex items-center text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 hover:text-destructive focus-visible:opacity-100"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function CanvasColumn({
  row,
  column,
  selection,
  tSafe,
  onSelect,
  onRemoveItem,
}: {
  row: HeaderLayoutRow;
  column: HeaderLayoutColumn;
  selection: StudioSelection;
  tSafe: TSafe;
  onSelect: (selection: StudioSelection) => void;
  onRemoveItem: (itemId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { kind: "column", columnId: column.id },
  });

  const isSelected =
    selection?.kind === "column" && selection.columnId === column.id;
  const isFull = column.items.length >= MAX_HEADER_ITEMS_PER_COLUMN;

  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={tSafe("admin.headerStudio.canvas.column", "Column")}
      onClick={(event) => {
        event.stopPropagation();
        onSelect({ kind: "column", rowId: row.id, columnId: column.id });
      }}
      className={cn(
        "flex min-h-12 min-w-0 flex-wrap items-center gap-2 rounded-[4px] border border-dashed border-border bg-muted/50 p-1.5 transition-colors hover:border-primary/40",
        isSelected && "border-solid border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-500/30 dark:bg-emerald-950/20",
        isOver && !isFull && "border-primary bg-primary/5",
        isOver && isFull && "border-destructive/60",
      )}
    >
      <SortableContext
        items={column.items.map((item) => item.id)}
        strategy={horizontalListSortingStrategy}
      >
        {column.items.map((item) => (
          <CanvasItemChip
            key={item.id}
            item={item}
            columnId={column.id}
            selection={selection}
            tSafe={tSafe}
            onSelect={onSelect}
            onRemove={() => onRemoveItem(item.id)}
          />
        ))}
      </SortableContext>
    </div>
  );
}

function CanvasItemChip({
  item,
  columnId,
  selection,
  tSafe,
  onSelect,
  onRemove,
}: {
  item: HeaderLayoutItem;
  columnId: string;
  selection: StudioSelection;
  tSafe: TSafe;
  onSelect: (selection: StudioSelection) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    data: { kind: "item", itemId: item.id, columnId },
  });

  const meta = itemMeta(item.type);
  const Icon = meta.icon;
  const isSelected = selection?.kind === "item" && selection.itemId === item.id;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        // A placed item is the thing a merchant hunts for on a busy canvas,
        // so it wears the studio's blue rather than the column's grey.
        "group/chip relative flex h-8 cursor-grab items-center gap-2 rounded-[4px] border border-sky-300 bg-sky-100 px-2.5 text-xs font-semibold whitespace-nowrap text-sky-900 shadow-xs transition-all hover:border-sky-400 hover:bg-sky-200 hover:shadow-sm active:cursor-grabbing dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100 dark:hover:bg-sky-900",
        isSelected && "border-emerald-500 ring-1 ring-emerald-500",
        isDragging && "opacity-50",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onSelect({ kind: "item", itemId: item.id });
      }}
      {...attributes}
      {...listeners}
    >
      <Icon className="h-3.5 w-3.5 text-sky-600 dark:text-sky-300" />
      {tSafe(`admin.headerStudio.items.${item.type}`, meta.label)}
      <button
        type="button"
        aria-label={tSafe("admin.headerStudio.panel.removeItem", "Remove item")}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm group-hover/chip:flex hover:text-destructive"
      >
        <Trash2 className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}
