"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getMegaCategoryBudget,
  getMegaPromoImages,
  getMegaPromoMode,
  type MenuItem,
} from "@/components/admin/menus/menu-form/helpers";

/**
 * The canvas is the flyout. Instead of three abstract list panes, a merchant
 * arranges the panel at the shape the storefront draws it in — which turns the
 * grid budget from a sentence into geometry: free slots are empty cells, and
 * anything the panel has no room for is drawn where the shopper will not see
 * it rather than blocked at the point of adding.
 */
export type MegaCanvasLabels = {
  rail: string;
  addCategory: string;
  synced: string;
  manual: string;
  emptyRail: string;
  formulaTitle: string;
  formulaL1: string;
  formulaL2: string;
  formulaL3: string;
  formulaL4: string;
  formulaHint: string;
  formulaSync: string;
  formulaManual: string;
  pickCategory: string;
  panelFor: string;
  addColumn: string;
  addLink: string;
  neverBlocked: string;
  belowFold: (count: number) => string;
  parkedTitle: (count: number) => string;
  parkedHint: (limit: number) => string;
  moveIn: string;
  remove: string;
  addBanner: string;
  addCard: string;
  viewAll: string;
  untitled: string;
};

export function MegaCategoryRail({
  items,
  activeIndex,
  labels,
  showFormula,
  onSelect,
  onAdd,
  onRemove,
  onReorder,
  onToggleFormula,
  onGoToSync,
}: {
  items: MenuItem[];
  activeIndex: number | null;
  labels: MegaCanvasLabels;
  showFormula: boolean;
  onSelect: (path: number[]) => void;
  onAdd: () => void;
  onRemove: (path: number[]) => void;
  onReorder: (parentPath: number[], from: number, to: number) => void;
  onToggleFormula: () => void;
  onGoToSync: () => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = Number(String(active.id).split(":")[1]);
    const to = Number(String(over.id).split(":")[1]);
    if (Number.isNaN(from) || Number.isNaN(to)) return;
    onReorder([], from, to);
  };

  return (
    <div className="flex min-h-0 flex-col border-e bg-muted/30">
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {labels.rail}
        </p>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {items.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {items.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            {labels.emptyRail}
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={items.map((_, index) => `cat:${index}`)}
              strategy={verticalListSortingStrategy}
            >
              {items.map((item, index) => (
                <RailRow
                  key={`cat:${index}`}
                  id={`cat:${index}`}
                  item={item}
                  labels={labels}
                  isActive={activeIndex === index}
                  onSelect={() => onSelect([index])}
                  onRemove={() => onRemove([index])}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {showFormula ? (
        <NestingFormula
          labels={labels}
          onSync={onGoToSync}
          onManual={onAdd}
        />
      ) : null}

      <div className="p-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full justify-start gap-2 border-dashed text-muted-foreground"
          onClick={onToggleFormula}
        >
          <Plus className="h-4 w-4" />
          {labels.addCategory}
        </Button>
      </div>
    </div>
  );
}

/**
 * The nesting rule stated where a category is added, because the mega menu
 * never invents structure — it inherits whatever the catalog was nested as.
 */
function NestingFormula({
  labels,
  onSync,
  onManual,
}: {
  labels: MegaCanvasLabels;
  onSync: () => void;
  onManual: () => void;
}) {
  const rungs = [
    { level: "L1", text: labels.formulaL1, muted: false },
    { level: "L2", text: labels.formulaL2, muted: false },
    { level: "L3", text: labels.formulaL3, muted: false },
    { level: "L4", text: labels.formulaL4, muted: true },
  ];

  return (
    <div className="mx-2 mb-2 space-y-2 rounded-lg border border-primary/30 bg-background p-3">
      <p className="text-xs font-semibold">{labels.formulaTitle}</p>
      <div className="space-y-1">
        {rungs.map((rung) => (
          <div
            key={rung.level}
            className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1"
          >
            <span
              className={cn(
                "rounded px-1 py-px text-[9px] font-bold tabular-nums tracking-wide",
                rung.muted
                  ? "bg-amber-100 text-amber-800"
                  : "bg-primary/10 text-primary",
              )}
            >
              {rung.level}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {rung.text}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {labels.formulaHint}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 flex-1 gap-1 px-2 text-xs"
          onClick={onSync}
        >
          <RefreshCw className="h-3 w-3" />
          {labels.formulaSync}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 flex-1 px-2 text-xs"
          onClick={onManual}
        >
          {labels.formulaManual}
        </Button>
      </div>
    </div>
  );
}

function RailRow({
  id,
  item,
  labels,
  isActive,
  onSelect,
  onRemove,
}: {
  id: string;
  item: MenuItem;
  labels: MegaCanvasLabels;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const budget = getMegaCategoryBudget(item);
  const count = (item.children || []).length;
  const isOver = count > budget.groupLimit;
  // A row that came from the catalog carries its category resource; anything
  // else was typed in here and sync will leave it alone.
  const isSynced = item.type === "category";

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group flex items-center gap-1.5 rounded-md border border-transparent pe-1",
        isActive ? "border-primary/40 bg-primary/10" : "hover:bg-muted/70",
        isDragging && "opacity-60 shadow-sm",
      )}
    >
      <button
        type="button"
        className="cursor-grab px-1 text-muted-foreground/60 hover:text-muted-foreground"
        aria-label="Reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 py-2 text-start text-sm"
      >
        <span
          title={isSynced ? labels.synced : labels.manual}
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            isSynced ? "bg-emerald-500" : "bg-muted-foreground/40",
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            isActive && "font-medium text-primary",
            !item.label.trim() && "italic text-muted-foreground",
          )}
        >
          {item.label.trim() || labels.untitled}
        </span>
        <span
          className={cn(
            "shrink-0 text-[11px] tabular-nums",
            isOver ? "font-bold text-amber-600" : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      </button>

      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function MegaFlyoutCanvas({
  category,
  categoryIndex,
  activePath,
  labels,
  onSelect,
  onAdd,
  onRemove,
  onReorder,
}: {
  category: MenuItem | null;
  categoryIndex: number | null;
  activePath: number[] | null;
  labels: MegaCanvasLabels;
  onSelect: (path: number[]) => void;
  onAdd: (parentPath: number[]) => void;
  onRemove: (path: number[]) => void;
  onReorder: (parentPath: number[], from: number, to: number) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  if (!category || categoryIndex === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-muted-foreground">
        {labels.pickCategory}
      </div>
    );
  }

  const budget = getMegaCategoryBudget(category);
  const groups = category.children || [];
  const shown = groups.slice(0, budget.groupLimit);
  const parked = groups.slice(budget.groupLimit);
  const promoMode = getMegaPromoMode(category);
  const promoImages = getMegaPromoImages(category);
  const freeSlots = Math.max(budget.groupLimit - shown.length, 0);
  const isCategorySelected = activePath?.length === 1;

  // One context for the whole panel: columns and links are separate sortable
  // lists, and the id prefix says which list a drag belongs to.
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = String(active.id).split(":");
    const to = String(over.id).split(":");
    if (from[0] !== to[0]) return;
    if (from[0] === "col") {
      onReorder([categoryIndex], Number(from[1]), Number(to[1]));
      return;
    }
    if (from[1] !== to[1]) return;
    onReorder([categoryIndex, Number(from[1])], Number(from[2]), Number(to[2]));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {labels.panelFor}{" "}
          <b className="font-medium text-foreground">
            {category.label.trim() || labels.untitled}
          </b>
        </span>
        <span className="tabular-nums">
          {budget.columns} × {budget.rows} · {budget.linkLimit} links per column
        </span>
      </div>

      <div className="min-w-[34rem] rounded-xl border bg-background p-4 shadow-sm">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <div
            className={cn(
              "grid items-start gap-3",
              promoMode === "side" && "grid-cols-[minmax(0,1fr)_12rem]",
            )}
          >
            <SortableContext
              items={shown.map((_, index) => `col:${index}`)}
              strategy={rectSortingStrategy}
            >
              <div
                className="grid gap-2"
                style={{
                  gridTemplateColumns: `repeat(${budget.columns}, minmax(0, 1fr))`,
                }}
              >
                {shown.map((group, index) => (
                  <CanvasColumn
                    key={`col:${index}`}
                    id={`col:${index}`}
                    group={group}
                    groupIndex={index}
                    linkLimit={budget.linkLimit}
                    activePath={activePath}
                    categoryIndex={categoryIndex}
                    labels={labels}
                    onSelect={onSelect}
                    onAdd={onAdd}
                    onRemove={onRemove}
                  />
                ))}

                {Array.from({ length: freeSlots }, (_, slot) => (
                  <button
                    key={`slot-${slot}`}
                    type="button"
                    onClick={() => onAdd([categoryIndex])}
                    className="flex min-h-[7rem] flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                  >
                    <span className="flex items-center gap-1">
                      <Plus className="h-3.5 w-3.5" />
                      {labels.addColumn}
                    </span>
                    <span className="text-[10px] uppercase tabular-nums tracking-wide">
                      {budget.linkLimit} links
                    </span>
                  </button>
                ))}
              </div>
            </SortableContext>

            {promoMode === "side" ? (
              <PromoSlot
                label={category.image || labels.addBanner}
                caption="side · 236px"
                filled={!!category.image}
                isSelected={isCategorySelected}
                onSelect={() => onSelect([categoryIndex])}
                className="min-h-[10rem] self-stretch"
              />
            ) : null}
          </div>
        </DndContext>

        {promoMode === "bottom" ? (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {Array.from({ length: 2 }, (_, index) => (
              <PromoSlot
                key={index}
                label={promoImages[index] || `${labels.addCard} ${index + 1}`}
                filled={!!promoImages[index]}
                isSelected={isCategorySelected}
                onSelect={() => onSelect([categoryIndex])}
                className="h-20"
              />
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-3 border-t pt-2.5 text-xs text-muted-foreground">
          <span className="truncate">{category.url || "/"}</span>
          <span className="shrink-0">{labels.viewAll} →</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => onAdd([categoryIndex])}
        >
          <Plus className="h-4 w-4" />
          {labels.addColumn}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {labels.neverBlocked}
        </span>
      </div>

      {parked.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
          <p className="flex items-start gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              {labels.parkedTitle(parked.length)}{" "}
              <span className="font-normal">
                {labels.parkedHint(budget.groupLimit)}
              </span>
            </span>
          </p>
          {parked.map((group, index) => (
            <div
              key={group._id || index}
              className="flex items-center gap-2 rounded-md border border-amber-300 bg-background px-2 py-1.5 text-sm dark:border-amber-900/60"
            >
              <span className="min-w-0 flex-1 truncate">
                {group.label.trim() || labels.untitled}
                <span className="ms-1.5 text-xs tabular-nums text-muted-foreground">
                  · {(group.children || []).length}
                </span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() =>
                  onReorder([categoryIndex], budget.groupLimit + index, 0)
                }
              >
                {labels.moveIn}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => onRemove([categoryIndex, budget.groupLimit + index])}
              >
                {labels.remove}
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PromoSlot({
  label,
  caption,
  filled,
  isSelected,
  onSelect,
  className,
}: {
  label: string;
  caption?: string;
  filled: boolean;
  isSelected: boolean;
  onSelect: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-lg border px-3 py-4 text-xs font-medium transition-colors",
        filled
          ? "border-primary/30 bg-gradient-to-br from-primary/10 to-muted text-primary"
          : "border-dashed text-muted-foreground hover:border-primary/40 hover:text-primary",
        isSelected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        className,
      )}
    >
      <ImageIcon className="h-4 w-4" />
      <span className="max-w-full truncate">{label}</span>
      {caption ? (
        <span className="text-[10px] uppercase tracking-wide opacity-70">
          {caption}
        </span>
      ) : null}
    </button>
  );
}

function CanvasColumn({
  id,
  group,
  groupIndex,
  linkLimit,
  activePath,
  categoryIndex,
  labels,
  onSelect,
  onAdd,
  onRemove,
}: {
  id: string;
  group: MenuItem;
  groupIndex: number;
  linkLimit: number;
  activePath: number[] | null;
  categoryIndex: number;
  labels: MegaCanvasLabels;
  onSelect: (path: number[]) => void;
  onAdd: (parentPath: number[]) => void;
  onRemove: (path: number[]) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const [showPast, setShowPast] = useState(false);
  const links = group.children || [];
  const isSelected = activePath?.length === 2 && activePath[1] === groupIndex;
  const isOver = links.length > linkLimit;
  const pastCount = Math.max(links.length - linkLimit, 0);
  // Everything is kept, but a column with twenty links would bury the panel,
  // so what the storefront hides is collapsed here too until asked for.
  const rendered = showPast ? links : links.slice(0, linkLimit);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group/col flex min-w-0 flex-col rounded-lg border p-2",
        isSelected
          ? "border-primary/40 bg-primary/5"
          : "border-transparent hover:bg-muted/50",
        isDragging && "opacity-60 shadow-sm",
      )}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="cursor-grab text-muted-foreground/50 opacity-0 transition-opacity hover:text-muted-foreground group-hover/col:opacity-100"
          aria-label="Reorder column"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onSelect([categoryIndex, groupIndex])}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-start"
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px] font-semibold",
              !group.label.trim() && "italic text-muted-foreground",
            )}
          >
            {group.label.trim() || labels.untitled}
          </span>
          <span
            className={cn(
              "shrink-0 text-[10px] tabular-nums",
              isOver ? "font-bold text-amber-600" : "text-muted-foreground",
            )}
          >
            {links.length}/{linkLimit}
          </span>
        </button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/col:opacity-100"
          onClick={() => onRemove([categoryIndex, groupIndex])}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <SortableContext
        items={rendered.map((_, index) => `lnk:${groupIndex}:${index}`)}
        strategy={verticalListSortingStrategy}
      >
        {rendered.map((link, index) => (
          <CanvasLink
            key={`lnk:${groupIndex}:${index}`}
            id={`lnk:${groupIndex}:${index}`}
            item={link}
            labels={labels}
            isPast={index >= linkLimit}
            isSelected={
              activePath?.length === 3 &&
              activePath[1] === groupIndex &&
              activePath[2] === index
            }
            onSelect={() => onSelect([categoryIndex, groupIndex, index])}
          />
        ))}
      </SortableContext>

      {pastCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowPast((prev) => !prev)}
          className="my-1 flex items-center gap-1.5 whitespace-nowrap text-[9px] font-medium uppercase tracking-wider text-amber-600 hover:text-amber-700"
        >
          <span className="h-px flex-1 bg-amber-300" />
          {labels.belowFold(pastCount)}
          {showPast ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          <span className="h-px flex-1 bg-amber-300" />
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => onAdd([categoryIndex, groupIndex])}
        className="mt-1.5 flex items-center justify-center gap-1 rounded-md border border-dashed py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
      >
        <Plus className="h-3 w-3" />
        {labels.addLink}
      </button>
    </div>
  );
}

function CanvasLink({
  id,
  item,
  labels,
  isPast,
  isSelected,
  onSelect,
}: {
  id: string;
  item: MenuItem;
  labels: MegaCanvasLabels;
  isPast: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "opacity-60" : undefined}
    >
      <button
        type="button"
        onClick={onSelect}
        {...attributes}
        {...listeners}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-start text-[13px]",
          isSelected
            ? "bg-primary text-primary-foreground"
            : isPast
              ? "text-muted-foreground/70 hover:bg-muted"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {item.label.trim() || labels.untitled}
        </span>
        {item.badge ? (
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 text-[10px] font-semibold",
              isSelected
                ? "bg-primary-foreground/20"
                : "bg-amber-100 text-amber-800",
            )}
          >
            {item.badge}
          </span>
        ) : null}
      </button>
    </div>
  );
}

/**
 * The grid budget as an object rather than a sentence: filled cells are the
 * columns the panel draws, empty ones are what is still free, and hatched
 * cells are the ones parked below it.
 */
export function MegaSlotMeter({
  category,
  label,
  summary,
}: {
  category: MenuItem | null;
  label: string;
  summary: (links: number) => string;
}) {
  if (!category) return null;
  const budget = getMegaCategoryBudget(category);
  const total = (category.children || []).length;
  const used = Math.min(total, budget.groupLimit);
  const over = Math.max(total - budget.groupLimit, 0);

  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className="flex gap-0.5"
        role="img"
        aria-label={`${used} / ${budget.groupLimit}`}
      >
        {Array.from({ length: budget.groupLimit }, (_, index) => (
          <span
            key={`slot-${index}`}
            className={cn(
              "h-4 w-3 rounded-[2px] border",
              index < used ? "border-primary bg-primary" : "bg-muted",
            )}
          />
        ))}
        {Array.from({ length: over }, (_, index) => (
          <span
            key={`over-${index}`}
            className="h-4 w-3 rounded-[2px] border border-amber-400 bg-amber-100"
          />
        ))}
      </span>
      <span className="text-xs text-muted-foreground">
        <b className="font-semibold tabular-nums text-foreground">
          {used}/{budget.groupLimit}
        </b>{" "}
        {summary(budget.linkLimit)}
      </span>
    </div>
  );
}
