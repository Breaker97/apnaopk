"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2, Plus, SquarePen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast-notification";
import { cn } from "@/lib/utils";
import { resolveColorNameToHex } from "@/lib/products/color-swatch";
import { isOptionVisual } from "@/lib/products/option-visual";
import { VISUAL_OPTIONS } from "@/components/admin/variants-manager/visual-options";
import type { GlobalVariantVisual, IGlobalVariant } from "@/types";

const DEFAULT_COLOR = "#e11d2a";

// ── Local draft shapes ─────────────────────────────────────────────
interface DraftValue {
  key: string;
  value: string;
  colorCode?: string;
}

interface Draft {
  name: string;
  visual: GlobalVariantVisual;
  values: DraftValue[];
}

// A saved variant carried in the list, serialized from the API.
interface VariantItem {
  _id: string;
  name: string;
  visual: GlobalVariantVisual;
  values: { _id: string; value: string; colorCode?: string }[];
  position: number;
}

let uidCounter = 0;
function uid() {
  uidCounter += 1;
  return `gv-${uidCounter}-${Math.floor(performance.now())}`;
}

function isHex(value: string | undefined): value is string {
  return Boolean(value && /^#[0-9a-f]{6}$/i.test(value));
}

// A variant is treated as a colour when its name says so (the same rule the
// product option editor and the storefront use) or when a colour-style visual
// is picked — that's what turns on per-value swatches.
function isColorName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized.includes("color") || normalized.includes("colour");
}

function isColorVisual(visual: GlobalVariantVisual): boolean {
  return visual === "color" || visual === "color_label";
}

function isColorMode(name: string, visual: GlobalVariantVisual): boolean {
  return isColorName(name) || isColorVisual(visual);
}

function emptyDraft(): Draft {
  return {
    name: "",
    visual: "rectangle",
    values: [],
  };
}

function toDraft(item: VariantItem): Draft {
  return {
    name: item.name,
    visual: item.visual,
    values: item.values.map((v) => ({
      key: v._id || uid(),
      value: v.value,
      colorCode: v.colorCode,
    })),
  };
}

// ── A single, drag-sortable option-value row ───────────────────────
function SortableValueRow({
  item,
  isColor,
  placeholder,
  onChange,
  onColorChange,
  onRemove,
  canRemove,
}: {
  item: DraftValue;
  isColor: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onColorChange: (color: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.key });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("flex items-center gap-2", isDragging && "opacity-60")}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground/60 hover:text-muted-foreground"
        aria-label="Reorder value"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>

      <Input
        value={item.value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 flex-1 rounded-xl"
      />

      {isColor && (
        <label
          className="relative size-11 shrink-0 cursor-pointer overflow-hidden rounded-xl border"
          style={{ backgroundColor: isHex(item.colorCode) ? item.colorCode : "#ffffff" }}
          title="Pick color"
        >
          <input
            type="color"
            value={isHex(item.colorCode) ? item.colorCode : DEFAULT_COLOR}
            onChange={(e) => onColorChange(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label={`Pick color for ${item.value || "value"}`}
          />
        </label>
      )}

      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
          canRemove
            ? "hover:bg-muted hover:text-destructive"
            : "cursor-not-allowed opacity-40",
        )}
        aria-label="Remove value"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

// ── The full expanded editor card ──────────────────────────────────
function GlobalVariantEditor({
  initial,
  saving,
  deleting,
  onSave,
  onDelete,
}: {
  initial: Draft;
  saving: boolean;
  deleting: boolean;
  onSave: (draft: Draft) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [pendingValue, setPendingValue] = useState("");
  const [pendingColor, setPendingColor] = useState(DEFAULT_COLOR);

  const isColor = isColorMode(draft.name, draft.visual);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const update = useCallback((patch: Partial<Draft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  // Give every value a swatch when we enter colour mode, so existing values
  // light up without the merchant having to touch each one.
  const seedSwatches = (values: DraftValue[]): DraftValue[] =>
    values.map((v) => ({
      ...v,
      colorCode: isHex(v.colorCode)
        ? v.colorCode
        : (resolveColorNameToHex(v.value) ?? DEFAULT_COLOR),
    }));

  // Renaming to/from a colour name reseeds swatches automatically.
  const handleNameChange = (name: string) => {
    setDraft((prev) => ({
      ...prev,
      name,
      values: isColorMode(name, prev.visual)
        ? seedSwatches(prev.values)
        : prev.values,
    }));
  };

  // Picking a colour visual (Color / Color & Label) also turns on swatches.
  const handleVisualChange = (visual: GlobalVariantVisual) => {
    setDraft((prev) => ({
      ...prev,
      visual,
      values: isColorMode(prev.name, visual)
        ? seedSwatches(prev.values)
        : prev.values,
    }));
  };

  const commitPendingValue = () => {
    const label = pendingValue.trim();
    if (!label) return;
    const nextValue: DraftValue = {
      key: uid(),
      value: label,
      colorCode: isColor
        ? (resolveColorNameToHex(label) ?? pendingColor)
        : undefined,
    };
    update({ values: [...draft.values, nextValue] });
    setPendingValue("");
    setPendingColor(DEFAULT_COLOR);
  };

  const updateValue = (key: string, patch: Partial<DraftValue>) => {
    update({
      values: draft.values.map((v) => (v.key === key ? { ...v, ...patch } : v)),
    });
  };

  const removeValue = (key: string) => {
    update({ values: draft.values.filter((v) => v.key !== key) });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = draft.values.findIndex((v) => v.key === active.id);
      const newIndex = draft.values.findIndex((v) => v.key === over.id);
      update({ values: arrayMove(draft.values, oldIndex, newIndex) });
    }
  };

  const busy = saving || deleting;

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <div className="space-y-5">
        {/* Variant name + visual */}
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-semibold">Variant Name</label>
            <Input
              value={draft.name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Color, Size, Storage"
              className="h-11 rounded-xl"
            />
            <p className="text-xs text-muted-foreground">
              Name it “Color” (or “Colour”) to get color swatches automatically.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold">Visual</label>
            <Select
              value={draft.visual}
              onValueChange={(value) =>
                handleVisualChange(value as GlobalVariantVisual)
              }
            >
              <SelectTrigger className="h-11 w-full rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISUAL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="flex items-center gap-2">
                      {option.icon}
                      {option.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Option values */}
        <div className="space-y-3">
          <label className="text-sm font-semibold">Option Values</label>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={draft.values.map((v) => v.key)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {draft.values.map((value) => (
                  <SortableValueRow
                    key={value.key}
                    item={value}
                    isColor={isColor}
                    onChange={(next) =>
                      updateValue(value.key, {
                        value: next,
                        ...(isColor
                          ? {
                              colorCode:
                                resolveColorNameToHex(next) ??
                                (isHex(value.colorCode)
                                  ? value.colorCode
                                  : DEFAULT_COLOR),
                            }
                          : {}),
                      })
                    }
                    onColorChange={(color) =>
                      updateValue(value.key, { colorCode: color })
                    }
                    onRemove={() => removeValue(value.key)}
                    canRemove
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {/* Add-another-value row */}
          <div className="flex items-center gap-2">
            <span className="w-4 shrink-0" />
            <Input
              value={pendingValue}
              onChange={(e) => {
                const next = e.target.value;
                setPendingValue(next);
                if (isColor) {
                  setPendingColor(resolveColorNameToHex(next) ?? DEFAULT_COLOR);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitPendingValue();
                }
              }}
              onBlur={commitPendingValue}
              placeholder="Add another value"
              className="h-11 flex-1 rounded-xl"
            />
            {isColor && (
              <label
                className="relative size-11 shrink-0 cursor-pointer overflow-hidden rounded-xl border"
                style={{ backgroundColor: isHex(pendingColor) ? pendingColor : "#ffffff" }}
                title="Pick color"
              >
                <input
                  type="color"
                  value={pendingColor}
                  onChange={(e) => setPendingColor(e.target.value)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label="Pick color for new value"
                />
              </label>
            )}
            <button
              type="button"
              onClick={commitPendingValue}
              className="flex size-11 shrink-0 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
              aria-label="Add value"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onDelete}
            disabled={busy}
            className="rounded-full border-destructive/30 px-6 text-destructive hover:bg-destructive/5 hover:text-destructive"
          >
            {deleting ? <Loader2 className="size-4 animate-spin" /> : "Delete"}
          </Button>
          <Button
            type="button"
            onClick={() => onSave(draft)}
            disabled={busy}
            className="rounded-full px-8"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Collapsed saved-variant row ────────────────────────────────────
function CollapsedRow({
  item,
  onEdit,
}: {
  item: VariantItem;
  onEdit: () => void;
}) {
  const isColor = isColorMode(item.name, item.visual);
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border bg-card px-5 py-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-base font-semibold">{item.name}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {item.values.map((value) => (
            <span
              key={value._id}
              className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
            >
              {isColor && isHex(value.colorCode) && (
                <span
                  aria-hidden
                  className="size-2.5 rounded-full border border-border"
                  style={{ backgroundColor: value.colorCode }}
                />
              )}
              {value.value}
            </span>
          ))}
          {item.values.length === 0 && (
            <span className="text-xs text-muted-foreground">No values yet</span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={`Edit ${item.name}`}
      >
        <SquarePen className="size-4" />
      </button>
    </div>
  );
}

// ── Top-level manager ──────────────────────────────────────────────
export function GlobalVariantsManager() {
  const [items, setItems] = useState<VariantItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(() => {
    const request = async () => {
      const res = await fetch("/api/admin/global-variants");
      const json = await res.json();
      if (!json?.success || !Array.isArray(json.data)) return null;
      return (json.data as IGlobalVariant[]).map((raw) => ({
        _id: String(raw._id),
        name: raw.name,
        visual: isOptionVisual(raw.visual) ? raw.visual : "rectangle",
        position: raw.position ?? 0,
        values: (raw.values ?? []).map((v) => ({
          _id: String(v._id),
          value: v.value,
          colorCode: v.colorCode,
        })),
      }));
    };
    return request()
      .then((items) => {
        if (items) setItems(items);
      })
      .catch((error) => {
        console.error("Failed to load global variants:", error);
        toast.error("Could not load global variants");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // `visual` comes straight from the picker. `type` is no longer a UI control,
  // so we persist a sensible value derived from colour mode to keep existing
  // consumers/documents consistent (colour variants keep type "color").
  const draftToPayload = (draft: Draft) => {
    const color = isColorMode(draft.name, draft.visual);
    return {
      name: draft.name.trim(),
      type: color ? "color" : "text",
      visual: draft.visual,
      values: draft.values
        .filter((v) => v.value.trim())
        .map((v) => ({
          value: v.value.trim(),
          colorCode: color ? v.colorCode : undefined,
        })),
    };
  };

  const handleCreate = async (draft: Draft) => {
    if (!draft.name.trim()) {
      toast.error("Give the variant a name");
      return;
    }
    setSavingId("__new__");
    try {
      const res = await fetch("/api/admin/global-variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftToPayload(draft)),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to create variant");
      }
      setCreating(false);
      await load();
      toast.success("Global variant created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setSavingId(null);
    }
  };

  const handleUpdate = async (id: string, draft: Draft) => {
    if (!draft.name.trim()) {
      toast.error("Give the variant a name");
      return;
    }
    setSavingId(id);
    try {
      const res = await fetch(`/api/admin/global-variants/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftToPayload(draft)),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to update variant");
      }
      setEditingId(null);
      await load();
      toast.success("Global variant updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/global-variants/${id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to delete variant");
      }
      setEditingId(null);
      setItems((prev) => prev.filter((item) => item._id !== id));
      toast.success("Global variant deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete");
    } finally {
      setDeletingId(null);
    }
  };

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.position - b.position),
    [items],
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {/* Header */}
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-2xl font-bold tracking-tight">
            Global Variants
          </CardTitle>
          <CardDescription>
            Create one variant once and use it to any product in the store.
          </CardDescription>
        </CardHeader>
      </Card>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      ) : (
        <div className="space-y-3">
          {sortedItems.map((item) =>
            editingId === item._id ? (
              <GlobalVariantEditor
                key={item._id}
                initial={toDraft(item)}
                saving={savingId === item._id}
                deleting={deletingId === item._id}
                onSave={(draft) => handleUpdate(item._id, draft)}
                onDelete={() => handleDelete(item._id)}
              />
            ) : (
              <CollapsedRow
                key={item._id}
                item={item}
                onEdit={() => {
                  setCreating(false);
                  setEditingId(item._id);
                }}
              />
            ),
          )}

          {creating && (
            <GlobalVariantEditor
              key="__new__"
              initial={emptyDraft()}
              saving={savingId === "__new__"}
              deleting={false}
              onSave={handleCreate}
              onDelete={() => setCreating(false)}
            />
          )}

          {!creating && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setCreating(true);
              }}
              className="flex w-full items-center gap-2 rounded-2xl border bg-card px-5 py-4 text-base font-semibold transition-colors hover:bg-muted/50"
            >
              <Plus className="size-5 rounded-full border border-current p-0.5" />
              Create Variant
            </button>
          )}
        </div>
      )}
    </div>
  );
}
