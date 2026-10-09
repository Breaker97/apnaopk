"use client";

import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import {
  FOOTER_ITEM_META,
  type FooterItemMeta,
} from "./layout-style";

/**
 * The palette. A chip is dragged straight into a column, which is why the
 * drawer and the canvas have to live inside ONE DndContext — put it outside
 * and in-canvas drags keep working while drawer drops silently stop.
 *
 * Clicking a chip adds it too: the pointer sensor has no keyboard
 * equivalent here, and "drag it" would be the only way in otherwise.
 */

const NEW_ITEM_PREFIX = "new-footer-item:";

export function FooterItemDrawer({
  tSafe,
  onAdd,
}: {
  tSafe: TSafe;
  onAdd: (meta: FooterItemMeta) => void;
}) {
  return (
    <div className="rounded-[12px] border border-primary/20 bg-primary/5 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {tSafe("admin.footerStudio.drawer.title", "Items")}
      </p>
      <div className="flex flex-wrap gap-2">
        {FOOTER_ITEM_META.map((meta) => (
          <DrawerChip key={meta.type} meta={meta} tSafe={tSafe} onAdd={onAdd} />
        ))}
      </div>
    </div>
  );
}

function DrawerChip({
  meta,
  tSafe,
  onAdd,
}: {
  meta: FooterItemMeta;
  tSafe: TSafe;
  onAdd: (meta: FooterItemMeta) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${NEW_ITEM_PREFIX}${meta.type}`,
    data: { kind: "new", itemType: meta.type },
  });
  const Icon = meta.icon;
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onAdd(meta)}
      className={cn(
        "flex h-8 cursor-grab items-center gap-1.5 rounded-[8px] border border-border bg-background px-2.5 text-xs font-medium transition hover:border-primary/50 hover:bg-accent",
        isDragging && "opacity-50",
      )}
      {...attributes}
      {...listeners}
    >
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      {tSafe(`admin.footerStudio.items.${meta.type}`, meta.label)}
    </button>
  );
}
