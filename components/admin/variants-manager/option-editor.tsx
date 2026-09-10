"use client";

import { useEffect, useState, useRef } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GripVertical,
  Trash2,
  Check,
  Layers,
  Loader2,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast-notification";
import { resolveColorNameToHex } from "@/lib/products/color-swatch";
import {
  isOptionVisual,
  isSwatchVisual,
  resolveOptionVisual,
} from "@/lib/products/option-visual";
import {
  generateId,
  type OptionValue,
  type ProductOption,
} from "@/components/admin/variants-manager/helpers";
import { VISUAL_OPTIONS } from "@/components/admin/variants-manager/visual-options";
import type { GlobalVariantOption } from "@/components/admin/variants-manager/use-global-variants";
import type { GlobalVariantVisual } from "@/types";

const DEFAULT_COLOR_CODE = "#000000";

function isColorOptionName(name: string) {
  const normalized = name.trim().toLowerCase();
  return normalized.includes("color") || normalized.includes("colour");
}

function isHex(value: string | undefined): value is string {
  return Boolean(value && /^#[0-9a-f]{6}$/i.test(value));
}

/**
 * The option-name field, upgraded to a Shopify-style combobox. As the merchant
 * types (or focuses the empty field) it suggests previously-saved global
 * variants; picking one fills the option's name and values in a single step,
 * while typing a brand-new name just creates a fresh option. This folds the old
 * separate "Add from global variants" picker into the normal add-option flow.
 */
function OptionNameCombobox({
  value,
  placeholder,
  globalVariants,
  usedNames,
  autoOpen,
  onNameChange,
  onPick,
}: {
  value: string;
  placeholder: string;
  globalVariants: GlobalVariantOption[];
  usedNames: Set<string>;
  autoOpen: boolean;
  onNameChange: (name: string) => void;
  onPick: (variant: GlobalVariantOption) => void;
}) {
  const [open, setOpen] = useState(autoOpen);
  const containerRef = useRef<HTMLDivElement>(null);

  const query = value.trim().toLowerCase();
  const suggestions = globalVariants.filter((variant) => {
    const name = variant.name.trim().toLowerCase();
    if (!name || usedNames.has(name)) return false;
    // While typing an exact match, don't suggest that same name back.
    if (name === query) return false;
    return query ? name.includes(query) : true;
  });

  // Close the dropdown on any outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative mt-1">
      <Input
        value={value}
        autoFocus={autoOpen}
        onChange={(e) => {
          onNameChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
      />

      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border bg-popover shadow-md">
          <p className="flex items-center gap-1.5 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
            <Layers className="size-3.5" />
            Saved variants
          </p>
          <div className="max-h-56 overflow-y-auto p-1">
            {suggestions.map((variant) => (
              <button
                key={variant._id}
                type="button"
                // Use onMouseDown so the pick fires before the input's blur.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(variant);
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start gap-1 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted"
              >
                <span className="text-sm font-medium">{variant.name}</span>
                <span className="flex flex-wrap gap-1">
                  {variant.values.slice(0, 8).map((v) => (
                    <span
                      key={v._id}
                      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {variant.type === "color" && isHex(v.colorCode) && (
                        <span
                          aria-hidden
                          className="size-2 rounded-full border border-border"
                          style={{ backgroundColor: v.colorCode }}
                        />
                      )}
                      {v.value}
                    </span>
                  ))}
                  {variant.values.length > 8 && (
                    <span className="text-xs text-muted-foreground">
                      +{variant.values.length - 8}
                    </span>
                  )}
                  {variant.values.length === 0 && (
                    <span className="text-xs text-muted-foreground">
                      No values
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function isHexColor(value: string | undefined): value is string {
  return Boolean(value && /^#[0-9a-f]{6}$/i.test(value));
}

function optionValueColor(value: OptionValue) {
  if (isHexColor(value.colorCode)) return value.colorCode;
  return DEFAULT_COLOR_CODE;
}

function SortableValueItem({
  id,
  value,
  colorCode,
  showColorPicker,
  onValueChange,
  onColorChange,
  onRemove,
}: {
  id: string;
  value: string;
  colorCode?: string;
  showColorPicker: boolean;
  onValueChange: (newValue: string) => void;
  onColorChange: (newColor: string) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("flex items-center gap-2", isDragging && "opacity-50")}
    >
      <button
        type="button"
        className="cursor-grab touch-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </button>
      <Input
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className="flex-1"
      />
      {showColorPicker && (
        <input
          type="color"
          value={
            isHexColor(colorCode)
              ? colorCode
              : optionValueColor({ id, value, colorCode, position: 0 })
          }
          onChange={(e) => onColorChange(e.target.value)}
          aria-label={`Pick color for ${value || "option value"}`}
          title="Pick color"
          className="h-8 w-10 shrink-0 cursor-pointer rounded-md border bg-background p-1"
        />
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

// Option Editor Component
export function OptionEditor({
  option,
  namePlaceholder,
  isExpanded,
  onToggle,
  onUpdate,
  onDelete,
  canDelete,
  globalVariants = [],
  existingOptionNames = [],
}: {
  option: ProductOption;
  namePlaceholder: string;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdate: (option: ProductOption) => void;
  onDelete: () => void;
  canDelete: boolean;
  globalVariants?: GlobalVariantOption[];
  existingOptionNames?: string[];
}) {
  const [newValue, setNewValue] = useState("");
  const [newValueColor, setNewValueColor] = useState(DEFAULT_COLOR_CODE);
  const [savingForReuse, setSavingForReuse] = useState(false);
  const [savedForReuse, setSavedForReuse] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionName = option.name.trim();
  const resolvedVisual = resolveOptionVisual(option);
  // Colour mode (per-value swatches) turns on for a "Color" name OR a swatch
  // visual — so a non-English name can still get swatches by picking the visual.
  const isColorOption =
    isColorOptionName(optionName) || isSwatchVisual(resolvedVisual);

  // Names already taken by the *other* options, so a saved variant can't be
  // suggested (and duplicated) into two options at once.
  const usedNames = new Set(
    existingOptionNames
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );

  // Seed a swatch on each value when we enter colour mode.
  const seedColorValues = (values: OptionValue[]): OptionValue[] =>
    values.map((v) => ({
      ...v,
      colorCode: isHexColor(v.colorCode)
        ? v.colorCode
        : (resolveColorNameToHex(v.value) ?? DEFAULT_COLOR_CODE),
    }));

  // Pull a saved global variant in as this option's name + values + visual.
  const handlePickGlobalVariant = (variant: GlobalVariantOption) => {
    onUpdate({
      ...option,
      name: variant.name,
      visual: isOptionVisual(variant.visual) ? variant.visual : undefined,
      values: variant.values.map((value, index) => ({
        id: generateId(),
        value: value.value,
        colorCode: value.colorCode,
        position: index,
      })),
    });
  };

  const handleVisualChange = (visual: GlobalVariantVisual) => {
    const nextIsColor =
      isColorOptionName(optionName) ||
      (isOptionVisual(visual) && isSwatchVisual(visual));
    onUpdate({
      ...option,
      visual,
      values: nextIsColor ? seedColorValues(option.values) : option.values,
    });
  };

  // "Save for reuse" — persist this option to Global Variants so it's offered on
  // future products. Only for a named option with values that isn't global yet.
  const alreadyGlobal = globalVariants.some(
    (gv) => gv.name.trim().toLowerCase() === optionName.toLowerCase(),
  );
  const canSaveForReuse =
    optionName.length > 0 &&
    option.values.some((v) => v.value.trim()) &&
    !alreadyGlobal;

  const handleSaveForReuse = async () => {
    if (savingForReuse || savedForReuse) return;
    setSavingForReuse(true);
    try {
      const res = await fetch("/api/admin/global-variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: optionName,
          type: isColorOption ? "color" : "text",
          visual: resolvedVisual,
          values: option.values
            .filter((v) => v.value.trim())
            .map((v) => ({
              value: v.value.trim(),
              colorCode: isColorOption ? v.colorCode : undefined,
            })),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to save variant");
      }
      setSavedForReuse(true);
      toast.success(`"${optionName}" saved to global variants`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save variant",
      );
    } finally {
      setSavingForReuse(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleAddValue = () => {
    if (!newValue.trim()) return;
    if (
      option.values.some(
        (v) => v.value.toLowerCase() === newValue.toLowerCase().trim()
      )
    ) {
      return;
    }

    const newOptionValue: OptionValue = {
      id: generateId(),
      value: newValue.trim(),
      colorCode: isColorOption
        ? (resolveColorNameToHex(newValue.trim()) ?? newValueColor)
        : undefined,
      position: option.values.length,
    };

    onUpdate({
      ...option,
      values: [...option.values, newOptionValue],
    });
    setNewValue("");
    setNewValueColor(DEFAULT_COLOR_CODE);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddValue();
    }
  };

  const handleRemoveValue = (valueId: string) => {
    onUpdate({
      ...option,
      values: option.values
        .filter((v) => v.id !== valueId)
        .map((v, idx) => ({ ...v, position: idx })),
    });
  };

  const handleValueChange = (valueId: string, newValue: string) => {
    onUpdate({
      ...option,
      values: option.values.map((v) =>
        v.id === valueId
          ? {
              ...v,
              value: newValue,
              // For colour options, track the typed name → swatch. Unresolved
              // names (e.g. "titanium red") keep the current colour.
              ...(isColorOption
                ? {
                    colorCode:
                      resolveColorNameToHex(newValue) ??
                      (isHexColor(v.colorCode)
                        ? v.colorCode
                        : DEFAULT_COLOR_CODE),
                  }
                : {}),
            }
          : v
      ),
    });
  };

  const handleColorChange = (valueId: string, newColor: string) => {
    const colorCode = newColor.toLowerCase();

    onUpdate({
      ...option,
      values: option.values.map((v) =>
        v.id === valueId ? { ...v, colorCode } : v
      ),
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = option.values.findIndex((v) => v.id === active.id);
      const newIndex = option.values.findIndex((v) => v.id === over.id);
      const newValues = arrayMove(option.values, oldIndex, newIndex).map(
        (v, idx) => ({ ...v, position: idx })
      );
      onUpdate({ ...option, values: newValues });
    }
  };

  // Collapsed view - show as badge row
  if (!isExpanded) {
    return (
      <div
        className="rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
          <span
            className={cn(
              "font-medium min-w-[80px]",
              !optionName && "text-muted-foreground",
            )}
          >
            {optionName || namePlaceholder}
          </span>
          <div className="flex flex-wrap gap-1">
            {option.values.map((v) => (
              <Badge key={v.id} variant="secondary" className="gap-1.5 text-xs">
                {isColorOption && (
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-full border border-border"
                    style={{ backgroundColor: optionValueColor(v) }}
                  />
                )}
                {v.value}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Expanded view - full editor
  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-start gap-2">
        <GripVertical className="h-5 w-5 text-muted-foreground mt-2 cursor-grab" />
        <div className="flex-1 space-y-4">
          {/* Option name (combobox) + Visual, side by side */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Option name
              </label>
              <OptionNameCombobox
                value={option.name}
                placeholder={namePlaceholder}
                globalVariants={globalVariants}
                usedNames={usedNames}
                autoOpen={!optionName}
                onNameChange={(nextName) => {
                  const nextIsColorOption =
                    isColorOptionName(nextName) || isSwatchVisual(resolvedVisual);
                  onUpdate({
                    ...option,
                    name: nextName,
                    values: nextIsColorOption
                      ? seedColorValues(option.values)
                      : option.values,
                  });
                }}
                onPick={handlePickGlobalVariant}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Visual
              </label>
              <Select
                value={resolvedVisual}
                onValueChange={(value) =>
                  handleVisualChange(value as GlobalVariantVisual)
                }
              >
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISUAL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className="flex items-center gap-2">
                        {opt.icon}
                        {opt.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Option values */}
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Option values
            </label>
            <div className="mt-2 space-y-2">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={option.values.map((v) => v.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {option.values
                    .sort((a, b) => a.position - b.position)
                    .map((v) => (
                      <SortableValueItem
                        key={v.id}
                        id={v.id}
                        value={v.value}
                        colorCode={v.colorCode}
                        showColorPicker={isColorOption}
                        onValueChange={(newVal) =>
                          handleValueChange(v.id, newVal)
                        }
                        onColorChange={(newColor) =>
                          handleColorChange(v.id, newColor)
                        }
                        onRemove={() => handleRemoveValue(v.id)}
                      />
                    ))}
                </SortableContext>
              </DndContext>

              {/* Auto-expanding add value input */}
              <div className="flex items-center gap-2">
                <div className="w-4" />
                <Input
                  ref={inputRef}
                  value={newValue}
                  onChange={(e) => {
                    const next = e.target.value;
                    setNewValue(next);
                    if (isColorOption) {
                      setNewValueColor(
                        resolveColorNameToHex(next) ?? DEFAULT_COLOR_CODE,
                      );
                    }
                  }}
                  onKeyDown={handleKeyDown}
                  onBlur={() => {
                    if (newValue.trim()) handleAddValue();
                  }}
                  placeholder="Add another value"
                  className="flex-1"
                />
                {isColorOption && (
                  <input
                    type="color"
                    value={newValueColor}
                    onChange={(e) => setNewValueColor(e.target.value)}
                    aria-label="Pick color for new option value"
                    title="Pick color"
                    className="h-8 w-10 shrink-0 cursor-pointer rounded-md border bg-background p-1"
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleAddValue}
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer with Delete, Save-for-reuse, and Done */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
        {canDelete ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDelete}
            className="text-destructive hover:text-destructive"
          >
            Delete
          </Button>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-2">
          {(canSaveForReuse || savedForReuse) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSaveForReuse}
              disabled={savingForReuse || savedForReuse}
              className="gap-1.5"
              title="Add this option to Global Variants for future products"
            >
              {savedForReuse ? (
                <>
                  <Check className="h-4 w-4" /> Saved for reuse
                </>
              ) : savingForReuse ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Layers className="h-4 w-4" /> Save for reuse
                </>
              )}
            </Button>
          )}
          <Button type="button" size="sm" onClick={onToggle}>
            <Check className="mr-1 h-4 w-4" />
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

// Image Selector Modal with Upload Support
