"use client";

/**
 * A short vertical list the designer can reorder: a block's fields, a product
 * table's columns, a price summary's rows. dnd-kit with the pointer (after
 * 4 px, so a click on a row's controls never starts a drag) and the keyboard
 * (focus the handle, Space, arrows, Space), announced in the admin's language;
 * and, because it is quicker than a drag, the handle also moves its row one
 * place with the Up and Down arrow keys.
 *
 * It only reports a move (`onMove(id, toIndex)`); the owner of the list writes
 * the new order as one undo step.
 */
import type { KeyboardEvent, ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

export function SortableList({
  ids,
  names,
  label,
  onMove,
  children,
}: {
  ids: readonly string[];
  /** What each row is called, for the announcements. */
  names: Readonly<Record<string, string>>;
  /** Names the list for assistive tech. */
  label: string;
  onMove: (id: string, toIndex: number) => void;
  children: ReactNode;
}) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.sortable");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const nameOf = (id: unknown) => names[String(id)] ?? String(id);
  const positionOf = (id: unknown) => ids.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("picked", { name: nameOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over ? t("over", { name: nameOf(active.id), position: positionOf(over.id), count: ids.length }) : undefined,
    onDragEnd: ({ active, over }) => t("dropped", { name: nameOf(active.id), position: positionOf((over ?? active).id), count: ids.length }),
    onDragCancel: ({ active }) => t("cancelled", { name: nameOf(active.id) }),
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const to = ids.indexOf(String(over.id));
    if (to >= 0) onMove(String(active.id), to);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      onDragEnd={onDragEnd}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t("instructions") } }}
    >
      <SortableContext items={[...ids]} strategy={verticalListSortingStrategy}>
        <ul aria-label={label} className="space-y-1.5" data-sortable-list="">
          {children}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

export function SortableRow({
  id,
  name,
  index,
  count,
  onMoveBy,
  dim,
  children,
}: {
  id: string;
  name: string;
  index: number;
  count: number;
  /** Move this row by -1 / +1 (the handle's arrow keys). */
  onMoveBy: (delta: -1 | 1) => void;
  /** Draws the row muted (a hidden field). */
  dim?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.sortable");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, active } = useSortable({ id });
  const dndKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => listeners?.onKeyDown?.(event);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // While a keyboard drag is running dnd-kit owns the arrows.
    if (active) return dndKeyDown(event);
    if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      onMoveBy(-1);
    } else if (event.key === "ArrowDown" && index < count - 1) {
      event.preventDefault();
      onMoveBy(1);
    } else {
      dndKeyDown(event);
    }
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-sortable-row={id}
      className={cn(
        "flex items-start gap-1 rounded-md border bg-background p-1.5",
        dim && "bg-muted/30",
        isDragging && "relative z-10 shadow-md ring-1 ring-border",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        onKeyDown={onKeyDown}
        aria-label={t("drag", { name })}
        title={t("dragHint")}
        data-sortable-handle={id}
        className="mt-0.5 flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      >
        <GripVertical aria-hidden className="size-3.5" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}
