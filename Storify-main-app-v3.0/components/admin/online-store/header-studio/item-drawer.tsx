"use client";

import { useDraggable } from "@dnd-kit/core";
import type { HeaderItemType } from "@/lib/site-config/header-layout";
import {
  HEADER_ITEM_META,
  type HeaderItemMeta,
} from "@/components/admin/online-store/header-studio/layout-style";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import { cn } from "@/lib/utils";

/** The drag id a drawer chip carries; the canvas reads the type back off it. */
const NEW_ITEM_DRAG_PREFIX = "new-item:";

/**
 * The Figma item drawer — one horizontally scrolling strip of the pieces a
 * header can hold. A chip can be dragged into a column or simply clicked,
 * which drops it into the selected column; drag-only would leave the studio
 * unusable from a keyboard.
 */
export function ItemDrawer({
  tSafe,
  onAdd,
  canAdd,
}: {
  tSafe: TSafe;
  onAdd: (type: HeaderItemType) => void;
  canAdd: boolean;
}) {
  return (
    <div className="rounded-[12px] border border-primary/20 bg-primary/5 p-3">
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-primary">
          {tSafe("admin.headerStudio.drawer.title", "Items")}
        </span>
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
        {HEADER_ITEM_META.map((meta) => (
          <DrawerChip
            key={meta.type}
            meta={meta}
            tSafe={tSafe}
            canAdd={canAdd}
            onAdd={() => onAdd(meta.type)}
          />
        ))}
        </div>
      </div>
    </div>
  );
}

function DrawerChip({
  meta,
  tSafe,
  onAdd,
  canAdd,
}: {
  meta: HeaderItemMeta;
  tSafe: TSafe;
  onAdd: () => void;
  canAdd: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${NEW_ITEM_DRAG_PREFIX}${meta.type}`,
    data: { kind: "new", itemType: meta.type },
  });
  const Icon = meta.icon;
  const label = tSafe(`admin.headerStudio.items.${meta.type}`, meta.label);

  return (
    <button
      ref={setNodeRef}
      type="button"
      title={
        canAdd
          ? undefined
          : tSafe(
              "admin.headerStudio.drawer.needsColumn",
              "Select a column first, or drag the item onto one.",
            )
      }
      onClick={onAdd}
      className={cn(
        // The same blue a placed chip wears, so the drawer reads as the
        // source of exactly those.
        "flex h-10 shrink-0 cursor-grab items-center gap-2 rounded-[4px] border border-sky-300 bg-sky-100 px-4 text-xs font-semibold whitespace-nowrap text-sky-900 shadow-xs transition-all hover:border-sky-400 hover:bg-sky-200 hover:shadow-sm active:cursor-grabbing dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100 dark:hover:bg-sky-900",
        isDragging && "opacity-40",
      )}
      {...attributes}
      {...listeners}
    >
      <Icon className="h-4 w-4 text-sky-600 dark:text-sky-300" />
      {label}
    </button>
  );
}
