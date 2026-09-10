"use client";

import { useState } from "react";
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
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  Eye,
  EyeOff,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { cn } from "@/lib/utils";
import type {
  BlockInstance,
  SectionCatalogEntry,
} from "@/lib/storefront/sections/types";
import { buildBlockInstance } from "./instance-factory";
import { localizedDisplayValue } from "./localized-value";
import { fieldsForVariant } from "@/lib/storefront/sections/variant-fields";
import { FieldRenderer, humanize } from "./field-renderer";
import type { ImageFieldContext } from "./section-image-field";

/** First text-ish value a block carries — used as its row label preview. */
function blockPreview(
  block: BlockInstance,
  entry: SectionCatalogEntry,
  defaultLanguage: string,
): string {
  const fields =
    entry.blocks.find((def) => def.type === block.type)?.fields ?? [];
  for (const field of fields) {
    if (field.type !== "text" && field.type !== "textarea") continue;
    const preview = localizedDisplayValue(
      block.settings[field.key],
      defaultLanguage,
      defaultLanguage,
    );
    if (preview) return preview;
  }
  return "";
}

/**
 * Blocks list for one section instance: reorder, toggle, remove, expand to
 * edit, and one add button per block definition (respecting its max).
 *
 * Every mutation goes out as an UPDATER over the current blocks, never as
 * an array built from this render's props — a stale-closure write (TipTap's
 * first onUpdate, a slow-loading picker) must not resurrect old state.
 */
export function BlockEditor({
  entry,
  variant,
  sectionId,
  blocks,
  onChange,
  languages,
  defaultLanguage,
  locale,
  labelFor,
  renderFields,
}: {
  entry: SectionCatalogEntry;
  /** Active design — block fields the other designs use are hidden. */
  variant?: string;
  sectionId: string;
  blocks: BlockInstance[];
  onChange: (updater: (blocks: BlockInstance[]) => BlockInstance[]) => void;
  languages: string[];
  defaultLanguage: string;
  locale: string;
  /** Custom row label, for labels no text field carries (a picked
   * collection's name, say). Falls back to the text-field preview. */
  labelFor?: (block: BlockInstance, index: number) => string | undefined;
  /** Replaces the generated field list inside an expanded row — for
   * sections whose block controls need real data or dialogs. */
  renderFields?: (block: BlockInstance, index: number) => React.ReactNode;
}) {
  const t = useTranslations();
  const tSafe = createTSafe(t);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onChange((current) => {
      const from = current.findIndex((block) => block.id === active.id);
      const to = current.findIndex((block) => block.id === over.id);
      if (from < 0 || to < 0) return current;
      return arrayMove(current, from, to);
    });
  };

  return (
    <div className="space-y-2">
      {/* Pinned id: SSR'd dnd-kit contexts hydrate mismatched without one. */}
      <DndContext
        id={`block-editor-${sectionId}`}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={blocks.map((block) => block.id)}
          strategy={verticalListSortingStrategy}
        >
          {blocks.map((block, index) => (
            <SortableBlockRow
              key={block.id}
              block={block}
              index={index}
              label={
                labelFor?.(block, index) ||
                blockPreview(block, entry, defaultLanguage) ||
                `${tSafe(
                  `admin.storeBuilder.blocks.${block.type}`,
                  humanize(block.type),
                )} ${index + 1}`
              }
              expanded={expandedId === block.id}
              onToggleExpanded={() =>
                setExpandedId(expandedId === block.id ? null : block.id)
              }
              onToggleVisible={() =>
                onChange((current) =>
                  current.map((candidate) =>
                    candidate.id === block.id
                      ? { ...candidate, visible: !candidate.visible }
                      : candidate,
                  ),
                )
              }
              onRemove={() =>
                onChange((current) =>
                  current.filter((candidate) => candidate.id !== block.id),
                )
              }
            >
              {renderFields ? (
                renderFields(block, index)
              ) : (
              <FieldRenderer
                fields={fieldsForVariant(
                  entry.blocks.find((def) => def.type === block.type)?.fields ??
                    [],
                  variant,
                )}
                settings={block.settings}
                onChange={(key, value) =>
                  onChange((current) =>
                    current.map((candidate) =>
                      candidate.id === block.id
                        ? {
                            ...candidate,
                            settings: { ...candidate.settings, [key]: value },
                          }
                        : candidate,
                    ),
                  )
                }
                languages={languages}
                defaultLanguage={defaultLanguage}
                imageContext={
                  {
                    locale,
                    sectionType: entry.type,
                    sectionId,
                    blockType: block.type,
                    blockId: block.id,
                    blockIndex: index,
                  } satisfies ImageFieldContext
                }
              />
              )}
            </SortableBlockRow>
          ))}
        </SortableContext>
      </DndContext>

      <div className="flex flex-wrap gap-2">
        {entry.blocks.map((blockDef) => {
          const count = blocks.filter(
            (block) => block.type === blockDef.type,
          ).length;
          const atMax = blockDef.max !== undefined && count >= blockDef.max;
          return (
            <Button
              key={blockDef.type}
              type="button"
              variant="outline"
              size="sm"
              disabled={atMax}
              onClick={() => {
                const block = buildBlockInstance(entry, blockDef.type);
                onChange((current) => [...current, block]);
                setExpandedId(block.id);
              }}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              {tSafe(
                `admin.storeBuilder.addBlock.${blockDef.type}`,
                `Add ${humanize(blockDef.type)}`,
              )}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function SortableBlockRow({
  block,
  index,
  label,
  expanded,
  onToggleExpanded,
  onToggleVisible,
  onRemove,
  children,
}: {
  block: BlockInstance;
  index: number;
  label: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleVisible: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "overflow-hidden rounded-[10px] border border-border/80 bg-card shadow-xs",
        isDragging && "z-10 shadow-md",
        !block.visible && "opacity-60",
        expanded && "ring-1 ring-primary/20",
      )}
    >
      {/* The strip reads like the Header Studio's list cards: grip, a
          number, the row's name — so a merchant scanning six tabs can tell
          them apart before opening any. */}
      <div
        className={cn(
          "flex items-center gap-1.5 px-2 py-1.5",
          expanded ? "border-b bg-muted/40" : "bg-card",
        )}
      >
        <button
          type="button"
          className="cursor-grab touch-none p-1 text-muted-foreground"
          {...attributes}
          {...listeners}
          aria-label="Reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">
          {index + 1}
        </span>
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="truncate text-sm font-medium">{label}</span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          onClick={onToggleVisible}
        >
          {block.visible ? (
            <Eye className="h-3.5 w-3.5" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {expanded ? (
        <div className="border-t border-border p-3">{children}</div>
      ) : null}
    </div>
  );
}
