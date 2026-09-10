"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Star, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { UnitField } from "@/components/admin/unit-field";
import { cn } from "@/lib/utils";
import {
  PRODUCT_DETAIL_ROWS,
  PRODUCT_DETAIL_ROW_LABELS,
  parseProductDetailGroups,
  type ProductDetailRow,
  type ProductDetailRowGroup,
} from "@/lib/storefront/sections/product-detail-rows";
import {
  EMPTY_TYPOGRAPHY,
  parseProductDetailConfig,
  type ProductDetailConfig,
  type ProductDetailTypography,
  type ProductDetailTypographyKey,
  type ProductDetailVisibility,
} from "@/lib/storefront/sections/product-detail-style";

type TSafe = ReturnType<typeof createTSafe>;

/** The Figma "Product Details" layout tiles, in picker order. */
const LAYOUT_OPTIONS: { key: string; label: string }[] = [
  { key: "bottom", label: "Bottom Gallery" },
  { key: "left", label: "Left Gallery" },
  { key: "carousel", label: "Horizontal Carousel" },
  { key: "full", label: "Full Width" },
  { key: "vertical", label: "Vertical Carousel" },
  { key: "grid", label: "Grid" },
];

// Only the toggles the detail page actually renders — the card
// configurator's extras (item sold, variant count, …) stay out.
const VISIBILITY_ROWS: { key: keyof ProductDetailVisibility; label: string }[] =
  [
    { key: "discountChip", label: "Discount chip" },
    { key: "discountChipOnImage", label: "Discount chip on preview image" },
    { key: "ratingCount", label: "Rating count" },
    { key: "ratingMinimized", label: "Rating minimized" },
  ];

const TYPOGRAPHY_ROWS: { key: ProductDetailTypographyKey; label: string }[] = [
  { key: "brand", label: "Brand Text" },
  { key: "product", label: "Product Text" },
  { key: "category", label: "Category Text" },
  { key: "price", label: "Price Text" },
  { key: "discounted", label: "Discounted Price Text" },
  { key: "cart", label: "Cart Text" },
];

/**
 * The product template core's inspector (Figma 774:4992): the "Product
 * Details" gallery-layout tiles, the grouped "Order" row editor (draggable
 * rows with visibility switches), and the Visibility + Style panels. The
 * buy-box design itself follows the active theme — no template picker.
 */
export function ProductMainEditor({
  settings,
  onSettingChange,
}: {
  settings: Record<string, unknown>;
  onSettingChange: (key: string, value: unknown) => void;
}) {
  const t = useTranslations();
  const tSafe = createTSafe(t);
  const [addItemOpen, setAddItemOpen] = useState(false);

  const galleryLayout =
    typeof settings.galleryLayout === "string"
      ? settings.galleryLayout
      : "bottom";

  const groups = useMemo(
    () => parseProductDetailGroups(settings.rows),
    [settings.rows],
  );
  const commitGroups = (next: ProductDetailRowGroup[]) =>
    onSettingChange("rows", JSON.stringify(next));

  const config = useMemo(
    () => parseProductDetailConfig(settings.detailStyle),
    [settings.detailStyle],
  );
  const commitConfig = (next: ProductDetailConfig) =>
    onSettingChange("detailStyle", JSON.stringify(next));
  const patchVisibility = (patch: Partial<ProductDetailVisibility>) =>
    commitConfig({ ...config, visibility: { ...config.visibility, ...patch } });
  const patchStyle = (patch: Partial<ProductDetailConfig["style"]>) =>
    commitConfig({ ...config, style: { ...config.style, ...patch } });
  const patchTypography = (
    key: ProductDetailTypographyKey,
    patch: Partial<ProductDetailTypography>,
  ) =>
    patchStyle({
      typography: {
        ...config.style.typography,
        [key]: {
          ...(config.style.typography[key] ?? EMPTY_TYPOGRAPHY),
          ...patch,
        },
      },
    });

  const usedKeys = new Set(
    groups.flatMap((group) => group.items.map((item) => item.key)),
  );
  const availableRows = PRODUCT_DETAIL_ROWS.filter((key) => !usedKeys.has(key));

  const rowLabel = (key: ProductDetailRow) =>
    tSafe(
      `admin.storeBuilder.productRows.${key}`,
      PRODUCT_DETAIL_ROW_LABELS[key],
    );

  // ---- drag & drop across groups ------------------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const findGroupIndex = (id: string) =>
    groups.findIndex(
      (group) => group.id === id || group.items.some((item) => item.key === id),
    );

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const from = findGroupIndex(String(active.id));
    const to = findGroupIndex(String(over.id));
    if (from < 0 || to < 0 || from === to) return;

    const next = groups.map((group) => ({ ...group, items: [...group.items] }));
    const fromItems = next[from].items;
    const itemIndex = fromItems.findIndex((item) => item.key === active.id);
    if (itemIndex < 0) return;
    const [moved] = fromItems.splice(itemIndex, 1);
    const overIndex = next[to].items.findIndex((item) => item.key === over.id);
    next[to].items.splice(
      overIndex < 0 ? next[to].items.length : overIndex,
      0,
      moved,
    );
    commitGroups(next);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = findGroupIndex(String(active.id));
    const to = findGroupIndex(String(over.id));
    if (from < 0 || from !== to) return; // cross-group moves happen in onDragOver
    const items = groups[from].items;
    const oldIndex = items.findIndex((item) => item.key === active.id);
    const newIndex = items.findIndex((item) => item.key === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = groups.map((group, index) =>
      index === from
        ? { ...group, items: arrayMove(items, oldIndex, newIndex) }
        : group,
    );
    commitGroups(next);
  };

  const patchItem = (key: ProductDetailRow, on: boolean) => {
    commitGroups(
      groups.map((group) => ({
        ...group,
        items: group.items.map((item) =>
          item.key === key ? { ...item, on } : item,
        ),
      })),
    );
  };

  const addItem = (key: ProductDetailRow) => {
    const next = groups.map((group) => ({ ...group, items: [...group.items] }));
    if (next.length === 0) next.push({ id: crypto.randomUUID(), items: [] });
    next[next.length - 1].items.push({ key, on: true });
    commitGroups(next);
    setAddItemOpen(false);
  };

  const heading = (text: string) => (
    <p className="text-lg font-bold tracking-tight text-foreground">{text}</p>
  );
  const subheading = (text: string) => (
    <p className="text-base font-bold tracking-tight text-foreground">{text}</p>
  );

  const visibilityExample = (key: keyof ProductDetailVisibility) => {
    switch (key) {
      case "discountChip":
      case "discountChipOnImage":
        return (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
            10% OFF
          </span>
        );
      case "ratingCount":
        return (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Star className="h-3 w-3 fill-amber-500 text-amber-500" /> (350)
          </span>
        );
      case "ratingMinimized":
        return (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-foreground">
            <Star className="h-3 w-3 fill-amber-500 text-amber-500" /> 4.5
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-7">
      {/* Layout picker and Order side by side; each stacks below lg. */}
      <div className="grid gap-7 lg:grid-cols-2 lg:gap-8">
        <div className="space-y-2">
          {heading(
            tSafe("admin.storeBuilder.productLayoutTitle", "Product Details"),
          )}
          <div
            role="radiogroup"
            aria-label={tSafe(
              "admin.storeBuilder.productLayoutTitle",
              "Product Details",
            )}
            className="grid grid-cols-2 gap-3"
          >
            {LAYOUT_OPTIONS.map((option) => {
              const selected = option.key === galleryLayout;
              return (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onSettingChange("galleryLayout", option.key)}
                  className={cn(
                    "rounded-xl border p-1 text-left transition-colors",
                    selected
                      ? "border-primary ring-1 ring-primary"
                      : "border-transparent hover:border-primary/40",
                  )}
                >
                  <LayoutThumb layout={option.key} />
                  <span
                    className={cn(
                      "mx-auto mt-1.5 block w-fit rounded-md px-2 py-0.5 text-center text-[11px] font-medium",
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {tSafe(
                      `admin.storeBuilder.productLayouts.${option.key}`,
                      option.label,
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          {heading(tSafe("admin.storeBuilder.orderTitle", "Order"))}

          <DndContext
            id="product-main-order"
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <div className="space-y-4">
              {groups.map((group, index) => (
                <OrderGroup
                  key={group.id}
                  group={group}
                  index={index}
                  tSafe={tSafe}
                  rowLabel={rowLabel}
                  onToggle={patchItem}
                  onRemoveGroup={() =>
                    commitGroups(groups.filter((g) => g.id !== group.id))
                  }
                />
              ))}
            </div>
          </DndContext>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              onClick={() =>
                commitGroups([
                  ...groups,
                  { id: crypto.randomUUID(), items: [] },
                ])
              }
              className="rounded-full px-5 font-semibold"
            >
              {tSafe("admin.storeBuilder.addGroup", "Add Group")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={availableRows.length === 0}
              onClick={() => setAddItemOpen(true)}
              className="gap-1.5 rounded-full px-5 font-semibold"
            >
              {tSafe("admin.storeBuilder.addItem", "Add Item")}
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>
                  {tSafe("admin.storeBuilder.addItem", "Add Item")}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-1">
                {availableRows.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => addItem(key)}
                    className="flex w-full items-center rounded-md border border-transparent px-3 py-2 text-left text-sm font-medium transition-colors hover:border-border hover:bg-accent/40"
                  >
                    {rowLabel(key)}
                  </button>
                ))}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="mx-auto w-full space-y-3 lg:w-1/2">
        {heading(tSafe("admin.storeBuilder.visibilityTitle", "Visibility"))}
        <div className="space-y-2.5">
          {VISIBILITY_ROWS.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                <span className="truncate">
                  {tSafe(`admin.storeBuilder.detailVisibility.${key}`, label)}
                </span>
                {visibilityExample(key)}
              </span>
              <Switch
                checked={config.visibility[key]}
                onCheckedChange={(checked) =>
                  patchVisibility({ [key]: checked })
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto w-full space-y-4 lg:w-1/2">
        {heading(tSafe("admin.storeBuilder.styleTitle", "Style"))}

        <div className="space-y-2.5">
          {subheading(tSafe("admin.storeBuilder.detailStyle.gap", "Gap"))}
          <SliderRow
            label={tSafe(
              "admin.storeBuilder.detailStyle.groupGap",
              "Group gap",
            )}
            value={config.style.groupGap}
            max={80}
            onChange={(groupGap) => patchStyle({ groupGap })}
          />
          <SliderRow
            label={tSafe("admin.storeBuilder.detailStyle.itemGap", "Item gap")}
            value={config.style.itemGap}
            max={40}
            onChange={(itemGap) => patchStyle({ itemGap })}
          />
        </div>

        <div className="space-y-2.5">
          {subheading(
            tSafe("admin.storeBuilder.detailStyle.typography", "Typography"),
          )}
          {TYPOGRAPHY_ROWS.map(({ key, label }) => (
            <TypographyRow
              key={key}
              label={tSafe(`admin.storeBuilder.detailTypography.${key}`, label)}
              value={config.style.typography[key]}
              onChange={(patch) => patchTypography(key, patch)}
              tSafe={tSafe}
            />
          ))}
        </div>

        <div className="space-y-2.5">
          {subheading(tSafe("admin.storeBuilder.detailStyle.cart", "Cart"))}
          <ColorRow
            label={tSafe(
              "admin.storeBuilder.detailStyle.cartBackground",
              "Cart Button background",
            )}
            value={config.style.cartBackground}
            onChange={(cartBackground) => patchStyle({ cartBackground })}
          />
          <ColorRow
            label={tSafe(
              "admin.storeBuilder.detailStyle.cartBorder",
              "Cart Button border",
            )}
            value={config.style.cartBorder}
            onChange={(cartBorder) => patchStyle({ cartBorder })}
          />
          <SliderRow
            label={tSafe(
              "admin.storeBuilder.detailStyle.cartBorderWidth",
              "Cart border thickness",
            )}
            value={config.style.cartBorderWidth}
            max={4}
            step={0.5}
            onChange={(cartBorderWidth) => patchStyle({ cartBorderWidth })}
          />
          <SliderRow
            label={tSafe(
              "admin.storeBuilder.detailStyle.cartRadius",
              "Cart button radius",
            )}
            value={config.style.cartRadius}
            max={30}
            onChange={(cartRadius) => patchStyle({ cartRadius })}
          />
        </div>

        <div className="space-y-2.5">
          {subheading(
            tSafe(
              "admin.storeBuilder.detailStyle.miscellaneous",
              "Miscellaneous",
            ),
          )}
          <ColorRow
            label={tSafe(
              "admin.storeBuilder.detailStyle.ratingColor",
              "Rating Color",
            )}
            value={config.style.ratingColor}
            onChange={(ratingColor) => patchStyle({ ratingColor })}
          />
          <ColorRow
            label={tSafe(
              "admin.storeBuilder.detailStyle.stockBackground",
              "Stock background",
            )}
            value={config.style.stockBackground}
            onChange={(stockBackground) => patchStyle({ stockBackground })}
          />
          <TypographyRow
            label={tSafe(
              "admin.storeBuilder.detailTypography.stock",
              "Stock Text",
            )}
            value={config.style.typography.stock}
            onChange={(patch) => patchTypography("stock", patch)}
            tSafe={tSafe}
          />
        </div>
      </div>
    </div>
  );
}

// ---- Order group ----------------------------------------------------------

function OrderGroup({
  group,
  index,
  tSafe,
  rowLabel,
  onToggle,
  onRemoveGroup,
}: {
  group: ProductDetailRowGroup;
  index: number;
  tSafe: TSafe;
  rowLabel: (key: ProductDetailRow) => string;
  onToggle: (key: ProductDetailRow, on: boolean) => void;
  onRemoveGroup: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: group.id });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold">
          {tSafe("admin.storeBuilder.groupLabel", "Group {number}", {
            number: index + 1,
          })}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-full bg-muted/60 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
          onClick={onRemoveGroup}
          aria-label={tSafe("admin.storeBuilder.removeGroup", "Remove group")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <SortableContext
        items={group.items.map((item) => item.key)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className={cn(
            "space-y-2 rounded-md transition-colors",
            isOver && "bg-accent/30",
            group.items.length === 0 &&
              "border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground",
          )}
        >
          {group.items.length === 0
            ? tSafe(
                "admin.storeBuilder.emptyGroup",
                "Drag a row here, or remove the group.",
              )
            : group.items.map((item) => (
                <OrderRow
                  key={item.key}
                  item={item}
                  label={rowLabel(item.key)}
                  onToggle={(on) => onToggle(item.key, on)}
                />
              ))}
        </div>
      </SortableContext>
    </div>
  );
}

function OrderRow({
  item,
  label,
  onToggle,
}: {
  item: { key: ProductDetailRow; on: boolean };
  label: string;
  onToggle: (on: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.key });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-1.5",
        isDragging && "z-10 opacity-80",
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
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-full border border-border bg-card px-4 py-2">
        <span
          className={cn(
            "truncate text-sm font-medium",
            !item.on && "text-muted-foreground",
          )}
        >
          {label}
        </span>
        <Switch checked={item.on} onCheckedChange={onToggle} />
      </div>
    </div>
  );
}

// ---- Style controls -------------------------------------------------------
// Exported: the product CARD configurator (product-card-builder.tsx) renders
// the same Figma control rows and reuses these instead of redrawing them.

export function SliderRow({
  label,
  value,
  max,
  min = 0,
  step = 1,
  zeroLabel,
  unit = "px",
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  min?: number;
  step?: number;
  /** Shown in place of the unit while 0 means "use the default". */
  zeroLabel?: string;
  unit?: string;
  onChange: (value: number) => void;
}) {
  // A typed number with a draggable unit, not a rail: the exact pixel is
  // the point of these rows and a slider could never land on it.
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate text-sm text-foreground">{label}</span>
      <UnitField
        ariaLabel={label}
        value={value}
        unit={unit}
        min={min}
        max={max}
        step={step}
        zeroLabel={zeroLabel}
        onChange={onChange}
        className="w-28 shrink-0"
      />
    </div>
  );
}

/** A theme token a color field may bind to instead of a fixed hex. */
interface ColorToken {
  key: string;
  label: string;
  /** The CSS reference stored verbatim, e.g. `var(--primary)`. */
  value: string;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function ColorRow({
  label,
  value,
  fallback,
  tokens,
  onChange,
}: {
  label: string;
  value: string;
  /**
   * The color an EMPTY value actually renders as (a hex), so the swatch and
   * the picker open on the value in effect instead of a blank/white square.
   */
  fallback?: string;
  /** Theme tokens offered beside the picker; the current one is ringed. */
  tokens?: readonly ColorToken[];
  onChange: (value: string) => void;
}) {
  const token = tokens?.find((entry) => entry.value === value);
  const effective = value || fallback || "";
  // <input type="color"> only understands #rrggbb: a token or an odd
  // stored string seeds the picker with the fallback instead.
  const pickerValue = HEX_RE.test(value)
    ? value
    : HEX_RE.test(fallback ?? "")
      ? (fallback as string)
      : "#ffffff";

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate text-sm text-foreground">{label}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={`${label}: clear`}
            title="Reset to default"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            ×
          </button>
        ) : null}
        {tokens?.length ? (
          <span className="flex items-center gap-1" role="group">
            {tokens.map((entry) => (
              <button
                key={entry.key}
                type="button"
                title={entry.label}
                aria-label={`${label}: ${entry.label}`}
                aria-pressed={entry.value === value}
                onClick={() => onChange(entry.value === value ? "" : entry.value)}
                className={cn(
                  "h-4 w-4 rounded-full border border-border/70 transition-shadow",
                  entry.value === value && "ring-2 ring-primary ring-offset-1",
                )}
                style={{ backgroundColor: entry.value }}
              />
            ))}
          </span>
        ) : null}
        {/* The value in effect, spelled out — a token by name, a hex as-is,
            and the default in muted text so a glance tells set from unset. */}
        <span
          className={cn(
            "w-[76px] truncate text-right font-mono text-[11px] uppercase",
            value ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {token ? token.label : effective}
        </span>
        {/* The Figma swatch: a color pill sitting inside a light frame. The
            native input is stretched invisibly over it — browsers draw their
            own chrome around <input type="color">, which is what looked
            broken before. */}
        <span className="relative inline-flex h-8 w-[72px] items-center rounded-[4px] border border-border/70 bg-muted/50 p-1 shadow-xs">
          <span
            className={cn(
              "h-full w-full rounded-[2px]",
              !effective && "border border-dashed border-border/70 bg-background/60",
              !value && effective && "border border-dashed border-foreground/20",
            )}
            style={effective ? { backgroundColor: effective } : undefined}
          />
          <input
            type="color"
            value={pickerValue}
            onChange={(event) => onChange(event.target.value)}
            aria-label={label}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </span>
      </span>
    </div>
  );
}

const FONT_WEIGHTS = ["", "400", "500", "600", "700", "800"] as const;
const WEIGHT_LABELS: Record<string, string> = {
  "": "Default",
  "400": "Normal",
  "500": "Medium",
  "600": "Semibold",
  "700": "Bold",
  "800": "Extra bold",
};

/** What a text element renders as when nothing is set — see the card config. */
interface TypographyDefaults {
  weight: string;
  style: string;
  size: number;
  color: string;
}

export function TypographyRow({
  label,
  value,
  defaults,
  colorTokens,
  onChange,
  tSafe,
}: {
  label: string;
  value: ProductDetailTypography | undefined;
  /**
   * The effective defaults. With them every control shows the value in
   * effect (weight, size, color) rather than "Default"/"Auto"/white; a
   * Reset link returns the row to the theme's own values.
   */
  defaults?: TypographyDefaults;
  colorTokens?: readonly ColorToken[];
  onChange: (patch: Partial<ProductDetailTypography>) => void;
  tSafe: TSafe;
}) {
  const current = value ?? EMPTY_TYPOGRAPHY;
  const customized =
    Boolean(current.weight || current.style || current.color) ||
    current.size > 0;
  const shownWeight = current.weight || defaults?.weight || "";
  const shownStyle = current.style || defaults?.style || "";
  const shownSize = current.size > 0 ? current.size : (defaults?.size ?? 0);

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate text-sm text-foreground">{label}</span>
      <span className="flex shrink-0 items-center gap-2">
        {/* The value in effect at a glance: weight · size · style. */}
        {defaults ? (
          <span
            className={cn(
              "hidden text-[11px] tabular-nums sm:inline",
              customized ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {WEIGHT_LABELS[shownWeight] ?? shownWeight}
            {shownSize > 0 ? ` · ${shownSize}px` : ""}
            {shownStyle === "italic" ? " · Italic" : ""}
          </span>
        ) : null}
        <Popover>
          <PopoverTrigger asChild>
            {/* The trigger PREVIEWS the configured design: a serif "T" wearing
                the row's weight, style, and color (the Figma's red italic T),
                so a glance shows what — if anything — was customized. */}
            <button
              type="button"
              aria-label={label}
              className={cn(
                "flex h-8 w-11 shrink-0 items-center justify-center rounded-lg border bg-background transition-colors",
                customized
                  ? "border-primary/60"
                  : "border-border hover:border-primary/50",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "font-serif text-[17px] leading-none",
                  !customized && !defaults?.color && "text-muted-foreground",
                )}
                style={{
                  color: current.color || defaults?.color || undefined,
                  fontWeight: shownWeight ? Number(shownWeight) : 600,
                  fontStyle: shownStyle || undefined,
                }}
              >
                T
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-96 space-y-4 rounded-2xl p-5 shadow-lg"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground">
                {tSafe("admin.storeBuilder.detailTypography.weight", "Weight")}
              </span>
              <NativeSelect
                value={shownWeight}
                onChange={(event) => onChange({ weight: event.target.value })}
                className="w-36 rounded-lg"
              >
                {FONT_WEIGHTS.filter((weight) => weight || !defaults).map(
                  (weight) => (
                    <option key={weight} value={weight}>
                      {WEIGHT_LABELS[weight]}
                    </option>
                  ),
                )}
              </NativeSelect>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground">
                {tSafe("admin.storeBuilder.detailTypography.style", "Style")}
              </span>
              <NativeSelect
                value={shownStyle}
                onChange={(event) => onChange({ style: event.target.value })}
                className="w-36 rounded-lg"
              >
                {defaults ? null : <option value="">Default</option>}
                <option value="normal">Normal</option>
                <option value="italic">Italic</option>
              </NativeSelect>
            </div>
            <SliderRow
              label={tSafe("admin.storeBuilder.detailTypography.size", "Size")}
              value={shownSize}
              max={48}
              zeroLabel={tSafe("admin.storeBuilder.detailStyle.auto", "Auto")}
              onChange={(size) => onChange({ size })}
            />
            <ColorRow
              label={tSafe("admin.storeBuilder.detailTypography.color", "Color")}
              value={current.color}
              fallback={defaults?.color}
              tokens={colorTokens}
              onChange={(color) => onChange({ color })}
            />
            {defaults && customized ? (
              <button
                type="button"
                onClick={() =>
                  onChange({ weight: "", style: "", size: 0, color: "" })
                }
                className="text-xs font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                {tSafe(
                  "admin.storeBuilder.detailTypography.reset",
                  "Reset to theme default",
                )}
              </button>
            ) : null}
          </PopoverContent>
        </Popover>
      </span>
    </div>
  );
}

// ---- Layout thumbnails ----------------------------------------------------

/**
 * Miniatures of the six gallery arrangements, redrawn from the Figma PNGs:
 * a soft gray card with a browser-chrome strip, dark media plates, and
 * light text pills.
 */
const PLATE = "rounded-[3px] bg-foreground/35";
const PILL = "rounded-full bg-foreground/12";

function ThumbChrome() {
  return (
    <span className="flex items-center justify-between gap-2">
      <span className={cn(PILL, "h-1.5 w-6 shrink-0")} />
      <span className="flex flex-1 items-center justify-center gap-1">
        {Array.from({ length: 4 }, (_, index) => (
          <span key={index} className={cn(PILL, "h-1 w-4")} />
        ))}
      </span>
      <span className={cn(PILL, "h-1.5 w-3 shrink-0")} />
    </span>
  );
}

function ThumbText({ buttons = true }: { buttons?: boolean }) {
  return (
    <span className="flex min-w-0 flex-col justify-start gap-1.5">
      <span className={cn(PILL, "h-2 w-3/5")} />
      <span className="mt-1 flex flex-col gap-1">
        <span className={cn(PILL, "h-1 w-2/5")} />
        <span className={cn(PILL, "h-2 w-full")} />
        <span className={cn(PILL, "h-1 w-1/3")} />
      </span>
      {buttons ? (
        <span className="mt-1 flex gap-1">
          <span className={cn(PILL, "h-2 w-2/5")} />
          <span className={cn(PILL, "h-2 w-2/5")} />
        </span>
      ) : null}
    </span>
  );
}

function LayoutThumb({ layout }: { layout: string }) {
  const content = (() => {
    switch (layout) {
      case "left":
        return (
          <span className="grid flex-1 grid-cols-[0.5fr_2fr_1.6fr] gap-1.5">
            <span className="flex flex-col gap-1">
              <span className={cn(PLATE, "aspect-square")} />
              <span className={cn(PLATE, "aspect-square")} />
              <span className={cn(PLATE, "aspect-square")} />
            </span>
            <span className={PLATE} />
            <ThumbText />
          </span>
        );
      case "carousel":
        return (
          <span className="flex flex-1 flex-col gap-1.5 overflow-hidden">
            <span className="grid flex-1 grid-cols-[1fr_1fr_0.45fr] gap-1.5">
              <span className={PLATE} />
              <span className={PLATE} />
              <span className={cn(PLATE, "-mr-3")} />
            </span>
            <span className="flex w-2/5 flex-col gap-1">
              <span className={cn(PILL, "h-2 w-full")} />
              <span className={cn(PILL, "h-1 w-3/5")} />
              <span className={cn(PILL, "h-2 w-full")} />
            </span>
          </span>
        );
      case "full":
        return (
          <span className="-mx-2.5 -mt-6 flex flex-1 flex-col">
            <span className={cn("relative flex-1 rounded-t-lg", PLATE)}>
              <span className="absolute bottom-1.5 right-1.5 flex gap-1">
                {Array.from({ length: 4 }, (_, index) => (
                  <span
                    key={index}
                    className="h-2.5 w-4 rounded-[2px] bg-background/60"
                  />
                ))}
              </span>
            </span>
            <span className="flex w-2/5 flex-col gap-1 px-2.5 py-1.5">
              <span className={cn(PILL, "h-2 w-full")} />
              <span className={cn(PILL, "h-1 w-3/5")} />
              <span className={cn(PILL, "h-2 w-full")} />
            </span>
          </span>
        );
      case "vertical":
        return (
          <span className="grid flex-1 grid-cols-[1.4fr_1.6fr] gap-1.5 overflow-hidden">
            <span className="-mb-4 flex flex-col gap-1.5">
              <span className={cn(PLATE, "h-2/5 shrink-0")} />
              <span className={cn(PLATE, "h-2/5 shrink-0")} />
              <span className={cn(PLATE, "h-2/5 shrink-0")} />
            </span>
            <ThumbText buttons={false} />
          </span>
        );
      case "grid":
        return (
          <span className="grid flex-1 grid-cols-[1.6fr_1.4fr] gap-1.5 overflow-hidden">
            <span className="-mb-3 grid grid-cols-2 gap-1.5">
              {Array.from({ length: 6 }, (_, index) => (
                <span key={index} className={cn(PLATE, "aspect-square")} />
              ))}
            </span>
            <ThumbText />
          </span>
        );
      // "bottom" — main plate with a thumbnail row underneath.
      default:
        return (
          <span className="grid flex-1 grid-cols-[2fr_1.6fr] gap-1.5">
            <span className="flex flex-col gap-1">
              <span className={cn(PLATE, "flex-1")} />
              <span className="flex justify-center gap-1">
                <span className={cn(PLATE, "h-3 w-1/4")} />
                <span className={cn(PLATE, "h-3 w-1/4")} />
                <span className={cn(PLATE, "h-3 w-1/4")} />
              </span>
            </span>
            <ThumbText />
          </span>
        );
    }
  })();

  return (
    <span className="flex aspect-[7/4] flex-col gap-2 overflow-hidden rounded-lg bg-muted/70 p-2.5 pt-2">
      <ThumbChrome />
      {content}
    </span>
  );
}
