"use client";

/**
 * The Layers tab (§5.5): every element by name, the top of the list printing
 * on top (reverse drawing order). Drag a row's handle to reorder (dnd-kit,
 * pointer or keyboard); the eye hides, the padlock locks; the row's menu
 * renames, duplicates and moves one step up or down. A click selects
 * (Shift/Ctrl/Cmd+click adds or removes), which is how hidden elements are
 * reached; a double-click renames in place (Enter or leaving the field
 * commits, Esc cancels, an empty name is refused).
 *
 * Every change is one undo step through the store: `moveLayer` (drag),
 * `reorderIds` (up / down), `setFlag`, `duplicateIds`, and `updateElement`
 * for the name.
 */
import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { useShallow } from "zustand/react/shallow";
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
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, GripVertical, Lock, LockOpen, MoreHorizontal, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { drawingOrder } from "@/lib/invoice-templates/editor/arrange";
import type { TemplateElement } from "@/lib/invoice-templates/types";
import { cn } from "@/lib/utils";
import { useEditor, useEditorApi } from "./editor-store";
import { EDITOR_CARD_CLASS, EDITOR_HINT_CLASS } from "./editor-styles";

/** The layers top to bottom: what prints on top first. */
export function layerList(elements: readonly TemplateElement[]): TemplateElement[] {
  return drawingOrder(elements).reverse();
}

/** A move in the list (top-first) as a place in the drawing order (bottom-first). */
export function listIndexToDrawingIndex(listIndex: number, count: number): number {
  return count - 1 - listIndex;
}

const NAME_MAX = 80;

/** Rows only move up and down. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

interface RowProps {
  element: TemplateElement;
  selected: boolean;
  first: boolean;
  last: boolean;
}

function LayerRow({ element, selected, first, last }: RowProps) {
  const t = useTranslations("admin.invoiceTemplates.editor.layers");
  const tTypes = useTranslations("admin.invoiceTemplates.editor.types");
  const api = useEditorApi();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: element.id });
  const [renaming, setRenaming] = useState(false);
  const [text, setText] = useState(element.name);
  const closing = useRef(false);
  const store = () => api.getState();

  const startRename = () => {
    closing.current = false;
    setText(element.name);
    setRenaming(true);
  };
  const commitRename = () => {
    if (closing.current) return;
    closing.current = true;
    setRenaming(false);
    const next = text.trim();
    if (next && next !== element.name) store().updateElement(element.id, { name: next.slice(0, NAME_MAX) });
  };
  const onRenameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closing.current = true;
      setRenaming(false);
    }
  };
  const onSelect = (event: MouseEvent) => {
    if (event.shiftKey || event.ctrlKey || event.metaKey) store().toggleSelected(element.id);
    else store().select([element.id]);
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-layer={element.id}
      data-selected={selected || undefined}
      className={cn(
        "group flex items-center gap-0.5 rounded-[6px] py-0.5 pe-0.5 ps-0.5 text-xs font-medium",
        selected ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-accent/60",
        isDragging && "relative z-10 bg-background shadow-md ring-1 ring-border",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t("drag", { name: element.name })}
        className="flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        data-layer-handle=""
      >
        <GripVertical aria-hidden className="h-3.5 w-3.5" />
      </button>

      {renaming ? (
        <Input
          autoFocus
          aria-label={t("renameLabel")}
          value={text}
          maxLength={NAME_MAX}
          onChange={(event) => setText(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={onRenameKey}
          onBlur={commitRename}
          className="h-7 min-w-0 flex-1 px-1.5 text-xs"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={startRename}
          aria-pressed={selected}
          title={`${element.name} · ${tTypes(element.type)}`}
          className={cn(
            "flex h-7 min-w-0 flex-1 items-center rounded-[6px] px-1.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            element.hidden && "text-muted-foreground line-through decoration-muted-foreground/50",
          )}
          data-layer-name=""
        >
          <span className="truncate">{element.name}</span>
        </button>
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7 shrink-0", !element.hidden && "opacity-60 group-hover:opacity-100")}
        aria-label={element.hidden ? t("show", { name: element.name }) : t("hide", { name: element.name })}
        aria-pressed={Boolean(element.hidden)}
        onClick={() => store().setFlag([element.id], "hidden", !element.hidden)}
        data-layer-action="hidden"
      >
        {element.hidden ? <EyeOff aria-hidden className="h-3.5 w-3.5" /> : <Eye aria-hidden className="h-3.5 w-3.5" />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7 shrink-0", !element.locked && "opacity-60 group-hover:opacity-100")}
        aria-label={element.locked ? t("unlock", { name: element.name }) : t("lock", { name: element.name })}
        aria-pressed={Boolean(element.locked)}
        onClick={() => store().setFlag([element.id], "locked", !element.locked)}
        data-layer-action="locked"
      >
        {element.locked ? <Lock aria-hidden className="h-3.5 w-3.5" /> : <LockOpen aria-hidden className="h-3.5 w-3.5" />}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t("more", { name: element.name })}>
            <MoreHorizontal aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={startRename}>
            <Pencil aria-hidden />
            {t("rename")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => store().duplicateIds([element.id])}>
            <Copy aria-hidden />
            {t("duplicate")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={first} onSelect={() => store().reorderIds([element.id], "forward")}>
            <ArrowUp aria-hidden />
            {t("up")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={last} onSelect={() => store().reorderIds([element.id], "backward")}>
            <ArrowDown aria-hidden />
            {t("down")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function LayersPanel() {
  const t = useTranslations("admin.invoiceTemplates.editor.layers");
  const api = useEditorApi();
  const elements = useEditor((state) => state.design.elements);
  const selection = useEditor(useShallow((state) => state.selection));
  const layers = useMemo(() => layerList(elements), [elements]);
  const ids = useMemo(() => layers.map((element) => element.id), [layers]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const nameOf = (id: unknown) => layers.find((element) => element.id === id)?.name ?? "";
  const positionOf = (id: unknown) => ids.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("picked", { name: nameOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over ? t("over", { name: nameOf(active.id), position: positionOf(over.id), count: ids.length }) : undefined,
    onDragEnd: ({ active, over }) =>
      t("dropped", { name: nameOf(active.id), position: positionOf((over ?? active).id), count: ids.length }),
    onDragCancel: ({ active }) => t("cancelled", { name: nameOf(active.id) }),
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const to = ids.indexOf(String(over.id));
    if (to < 0) return;
    api.getState().moveLayer(String(active.id), listIndexToDrawingIndex(to, ids.length));
  };

  return (
    <div className="space-y-2 p-3" data-layers-panel="">
      <p className={cn("px-1", EDITOR_HINT_CLASS)}>{t("hint")}</p>
      {layers.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">{t("empty")}</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[verticalOnly]}
          onDragEnd={onDragEnd}
          accessibility={{ announcements, screenReaderInstructions: { draggable: t("instructions") } }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul aria-label={t("title")} className={cn(EDITOR_CARD_CLASS, "space-y-0.5 p-1.5")}>
              {layers.map((element, index) => (
                <LayerRow
                  key={element.id}
                  element={element}
                  selected={selection.includes(element.id)}
                  first={index === 0}
                  last={index === layers.length - 1}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
