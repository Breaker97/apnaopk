"use client";

import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import {
  MAX_FOOTER_COLUMNS,
  MAX_FOOTER_ITEMS_PER_COLUMN,
  MAX_FOOTER_ROWS,
  type FooterLayout,
  type FooterLayoutColumn,
  type FooterLayoutItem,
  type FooterLayoutRow,
} from "@/lib/site-config/footer-layout";
import {
  footerItemMeta,
  footerItemSummary,
} from "@/components/admin/online-store/footer-studio/layout-style";
import type { FooterSelection } from "@/components/admin/online-store/footer-studio/property-panel";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import { cn } from "@/lib/utils";

/**
 * The footer canvas: the footer as a stack of rows, each row a set of column
 * placeholders holding item chips — the header studio's canvas, with the two
 * differences the footer model has. A row's columns are an array rather than
 * a fixed count, so a row carries its own add and remove affordances; and a
 * column can lay its items out side by side, which the chips follow so the
 * canvas and the storefront agree on what the legal strip looks like.
 *
 * Drag and drop is wired by the studio shell: one DndContext spans the
 * drawer and this canvas so a chip can be dragged straight from one to the
 * other.
 */
export function FooterCanvas({
  layout,
  selection,
  tSafe,
  onSelect,
  onAddRow,
  onRemoveRow,
  onAddColumn,
  onRemoveColumn,
  onRemoveItem,
}: {
  layout: FooterLayout;
  selection: FooterSelection;
  tSafe: TSafe;
  onSelect: (selection: FooterSelection) => void;
  onAddRow: () => void;
  onRemoveRow: (rowId: string) => void;
  onAddColumn: (rowId: string) => void;
  onRemoveColumn: (rowId: string, columnId: string) => void;
  onRemoveItem: (itemId: string) => void;
}) {
  return (
    // Clicking the canvas itself — the gaps between rows, the space under
    // the last one — clears the selection, which is what brings the footer's
    // own settings back into the property panel. Every row, column and item
    // stops its own click, so only genuine background clicks reach here.
    <div className="space-y-2.5 pb-6" onClick={() => onSelect(null)}>
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
            onAddColumn={() => onAddColumn(row.id)}
            onRemoveColumn={(columnId) => onRemoveColumn(row.id, columnId)}
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
        disabled={layout.rows.length >= MAX_FOOTER_ROWS}
        onClick={onAddRow}
        className="mx-auto flex h-10 w-1/2 min-w-40 items-center gap-2 rounded-[4px] border border-dashed border-primary/40 bg-primary/5 text-xs font-semibold text-primary hover:bg-primary/10"
      >
        {tSafe("admin.footerStudio.canvas.addRow", "Row")}
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

function CanvasRow({
  row,
  selection,
  tSafe,
  onSelect,
  onAddColumn,
  onRemoveColumn,
  onRemoveRow,
  onRemoveItem,
}: {
  row: FooterLayoutRow;
  selection: FooterSelection;
  tSafe: TSafe;
  onSelect: (selection: FooterSelection) => void;
  onAddColumn: () => void;
  onRemoveColumn: (columnId: string) => void;
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
      aria-label={tSafe("admin.footerStudio.canvas.row", "Footer row")}
      onClick={(event) => {
        event.stopPropagation();
        onSelect({ kind: "row", rowId: row.id });
      }}
      className={cn(
        "group/row flex items-stretch gap-2 rounded-[12px] border bg-card p-3 shadow-xs transition-shadow",
        isSelected && "border-emerald-500 ring-2 ring-emerald-500/30",
        isDragging && "opacity-70",
      )}
    >
      {/* The grip alone activates the drag, so the row body stays clickable
          for selection — listeners on the row itself would swallow that. */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label={tSafe("admin.footerStudio.canvas.reorderRow", "Reorder row")}
        onClick={(event) => event.stopPropagation()}
        className="flex cursor-grab items-center text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/* The divider the row draws along its top edge, shown where the
            storefront puts it: above the legal strip, not under it. */}
        {row.borderTop > 0 ? (
          <span
            aria-hidden
            className="h-px w-full bg-border"
            style={{ height: Math.min(row.borderTop, 4) }}
          />
        ) : null}

        <div className="flex min-w-0 items-stretch gap-2">
          <div
            className="grid min-w-0 flex-1"
            style={{
              // The columns' own shares, as the storefront draws them: a
              // 2fr brand column reads as the wide one here too, so the
              // canvas and the footer agree on which column is which.
              gridTemplateColumns: row.columns
                .map((column) => `minmax(0, ${column.width}fr)`)
                .join(" "),
              columnGap: row.gap,
            }}
          >
            {row.columns.map((column) => (
              <CanvasColumn
                key={column.id}
                row={row}
                column={column}
                selection={selection}
                tSafe={tSafe}
                onSelect={onSelect}
                onRemove={
                  // A row with no columns can hold nothing and cannot be
                  // filled again from the canvas, so the last one stays —
                  // the row's own trash is how a merchant gets rid of it.
                  row.columns.length > 1
                    ? () => onRemoveColumn(column.id)
                    : null
                }
                onRemoveItem={onRemoveItem}
              />
            ))}
          </div>

          <button
            type="button"
            disabled={row.columns.length >= MAX_FOOTER_COLUMNS}
            aria-label={tSafe("admin.footerStudio.canvas.addColumn", "Add column")}
            title={tSafe("admin.footerStudio.canvas.addColumn", "Add column")}
            onClick={(event) => {
              event.stopPropagation();
              onAddColumn();
            }}
            className="flex w-7 shrink-0 items-center justify-center rounded-[4px] border border-dashed border-primary/40 bg-primary/5 text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <button
        type="button"
        aria-label={tSafe("admin.footerStudio.panel.removeRow", "Remove row")}
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
  onRemove,
  onRemoveItem,
}: {
  row: FooterLayoutRow;
  column: FooterLayoutColumn;
  selection: FooterSelection;
  tSafe: TSafe;
  onSelect: (selection: FooterSelection) => void;
  /** `null` when this is the row's last column, which cannot be removed. */
  onRemove: (() => void) | null;
  onRemoveItem: (itemId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    // The drag-end branch reads `columnId` off whichever thing it lands on,
    // so the column carries its own id as well as its dnd-kit id.
    data: { kind: "column", columnId: column.id },
  });

  const isSelected =
    selection?.kind === "column" && selection.columnId === column.id;
  const isFull = column.items.length >= MAX_FOOTER_ITEMS_PER_COLUMN;
  const isRow = column.flow === "row";

  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={tSafe("admin.footerStudio.canvas.column", "Column")}
      onClick={(event) => {
        event.stopPropagation();
        // Selecting a column names its row too: the panel shows the column's
        // own fields but still knows which row it belongs to.
        onSelect({ kind: "column", rowId: row.id, columnId: column.id });
      }}
      className={cn(
        "group/column flex min-h-12 min-w-0 flex-col gap-1.5 rounded-[4px] border border-dashed border-border bg-muted/50 p-1.5 transition-colors hover:border-primary/40",
        isSelected &&
          "border-solid border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-500/30 dark:bg-emerald-950/20",
        isOver && !isFull && "border-primary bg-primary/5",
        isOver && isFull && "border-destructive/60",
      )}
    >
      {/* The caption says what the merchant is about to edit: a footer row
          has no fixed tracks, so the share and the flow are the only way to
          tell two grey placeholders apart. */}
      <div className="flex items-center gap-1.5 px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <span className="shrink-0">{`${column.width}fr`}</span>
        <span className="truncate">
          {isRow
            ? tSafe("admin.footerStudio.canvas.flow.row", "Side by side")
            : tSafe("admin.footerStudio.canvas.flow.stack", "Stacked")}
        </span>
        {onRemove ? (
          <button
            type="button"
            aria-label={tSafe(
              "admin.footerStudio.panel.removeColumn",
              "Remove column",
            )}
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            className="ml-auto shrink-0 opacity-0 transition-opacity group-hover/column:opacity-100 hover:text-destructive focus-visible:opacity-100"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      <SortableContext
        items={column.items.map((item) => item.id)}
        strategy={isRow ? horizontalListSortingStrategy : verticalListSortingStrategy}
      >
        <div
          className={cn(
            "flex min-w-0 flex-1 gap-1.5",
            isRow ? "flex-wrap items-center" : "flex-col items-stretch",
          )}
        >
          {column.items.length === 0 ? (
            <span className="flex flex-1 items-center justify-center px-1 py-1.5 text-center text-[11px] italic text-muted-foreground">
              {tSafe("admin.footerStudio.canvas.empty", "Drop an item here")}
            </span>
          ) : (
            column.items.map((item) => (
              <CanvasItemChip
                key={item.id}
                item={item}
                columnId={column.id}
                selection={selection}
                tSafe={tSafe}
                onSelect={onSelect}
                onRemove={() => onRemoveItem(item.id)}
              />
            ))
          )}
        </div>
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
  item: FooterLayoutItem;
  columnId: string;
  selection: FooterSelection;
  tSafe: TSafe;
  onSelect: (selection: FooterSelection) => void;
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
    // `columnId` is what makes a move between columns land: the drag-end
    // branch reads it off the item it dropped onto as well as off a column.
    data: { kind: "item", itemId: item.id, columnId },
  });

  const meta = footerItemMeta(item.type);
  const Icon = meta.icon;
  const isSelected = selection?.kind === "item" && selection.itemId === item.id;
  // `footerItemSummary` reads the fields each kind happens to carry, which
  // the item interfaces cannot offer as an index signature of their own.
  const summary = footerItemSummary(
    item as FooterLayoutItem & Record<string, unknown>,
  );

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        // A placed item is the thing a merchant hunts for on a busy canvas,
        // so it wears the studio's blue rather than the column's grey.
        "group/chip relative flex min-h-8 min-w-0 cursor-grab items-center gap-2 rounded-[4px] border border-sky-300 bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-900 shadow-xs transition-all hover:border-sky-400 hover:bg-sky-200 hover:shadow-sm active:cursor-grabbing dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100 dark:hover:bg-sky-900",
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
      <Icon className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-300" />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate">
          {tSafe(`admin.footerStudio.items.${item.type}`, meta.label)}
        </span>
        {summary ? (
          <span className="truncate text-[10px] font-normal text-sky-700/80 dark:text-sky-300/80">
            {summary}
          </span>
        ) : null}
      </span>
      {/* The chip spreads the drag listeners over itself, so the trash has to
          stop the pointer as well as the click or dnd-kit starts a drag and
          the click never arrives. */}
      <button
        type="button"
        aria-label={tSafe("admin.footerStudio.panel.removeItem", "Remove item")}
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