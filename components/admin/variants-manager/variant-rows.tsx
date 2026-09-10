"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  MapPin,
  Sparkles,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/providers/currency-provider";
import type { LocationInventory } from "@/types";
import {
  variantAvailable,
  type VariantAiImageTarget,
  type VariantOptionValue,
  type InventoryLocationLite,
  type MediaItem,
  type ProductVariant,
} from "@/components/admin/variants-manager/helpers";
import { ImageSelectorModal } from "@/components/admin/variants-manager/variant-edit-modal";
import { AppImage } from "@/components/ui/app-image";

function isColorOptionName(name: string | undefined) {
  const normalized = (name || "").trim().toLowerCase();
  return (
    normalized === "color" ||
    normalized === "colors" ||
    normalized === "colour" ||
    normalized === "colours"
  );
}

function isHexColor(value: string | undefined): value is string {
  return Boolean(value && /^#[0-9a-f]{6}$/i.test(value));
}

function getVariantColor(variant: ProductVariant): {
  name?: string;
  hex?: string;
} {
  const ov = variant.optionValues.find((o) =>
    isColorOptionName(o.optionName),
  );
  return {
    name: ov?.value,
    hex: isHexColor(ov?.colorCode) ? ov.colorCode : undefined,
  };
}

// Small AI trigger that overlays a variant image slot without clipping.
function AiImageBadge({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Generate variant image with AI"
      title="Generate with AI"
      className="absolute -right-1.5 -top-1.5 z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-primary text-primary-foreground shadow ring-2 ring-background transition-transform hover:scale-110"
    >
      <Sparkles className="h-2.5 w-2.5" />
    </button>
  );
}

function ColorSwatch({ optionValue }: { optionValue?: VariantOptionValue }) {
  if (!optionValue || !isColorOptionName(optionValue.optionName)) return null;
  if (!isHexColor(optionValue.colorCode)) return null;

  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 shrink-0 rounded-full border border-border align-middle"
      style={{ backgroundColor: optionValue.colorCode }}
    />
  );
}

function VariantRow({
  variant,
  groupByOptionId,
  onUpdate,
  onEdit,
  mediaItems,
  isSelected,
  onSelectChange,
  onRequestAiImage,
  locations,
}: {
  variant: ProductVariant;
  groupByOptionId: string | null;
  onUpdate: (variant: ProductVariant) => void;
  onEdit: () => void;
  mediaItems: MediaItem[];
  isSelected: boolean;
  onSelectChange: (selected: boolean) => void;
  onRequestAiImage?: (target: VariantAiImageTarget) => void;
  locations: InventoryLocationLite[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const visibleOptionValues = variant.optionValues.filter(
    (ov) => ov.optionId !== groupByOptionId,
  );

  const mediaUrl = mediaItems.find((m) => m._id === variant.mediaId)?.url;

  return (
    <div
      className="flex cursor-pointer items-center gap-3 rounded px-3 py-2 hover:bg-muted/30"
      onClick={onEdit}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={(e) => onSelectChange(e.target.checked)}
        onClick={(e) => e.stopPropagation()}
        className="h-4 w-4 rounded border-gray-300"
      />

      {/* Media thumbnail — opens the product media gallery picker */}
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setPickerOpen(true);
          }}
          title="Select image from product media"
          className={cn(
            "relative h-10 w-10 rounded border-2 border-dotted border-primary/50 bg-muted/30 flex items-center justify-center overflow-hidden cursor-pointer transition-all hover:border-primary hover:bg-primary/5",
            mediaUrl && "border-solid border-transparent"
          )}
        >
          {mediaUrl ? (
            <AppImage src={mediaUrl} alt="" fill sizes="40px" className="object-cover" />
          ) : (
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {onRequestAiImage ? (
          <AiImageBadge
            onClick={(e) => {
              e.stopPropagation();
              const color = getVariantColor(variant);
              onRequestAiImage({
                variantIds: [variant.id],
                label: variant.name || color.name || "variant",
                colorName: color.name,
                colorHex: color.hex,
              });
            }}
          />
        ) : null}
      </div>

      <ImageSelectorModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        mediaItems={mediaItems}
        selectedId={variant.mediaId}
        onSelect={(id) => onUpdate({ ...variant, mediaId: id })}
      />

      {/* Variant name */}
      <div className="flex-1 min-w-[120px]">
        <span className="flex items-center gap-1.5 text-sm">
          {visibleOptionValues.length > 0
            ? visibleOptionValues.map((ov, index) => (
                <span
                  key={ov.valueId}
                  className="inline-flex items-center gap-1.5"
                >
                  <ColorSwatch optionValue={ov} />
                  <span>{ov.value}</span>
                  {index < visibleOptionValues.length - 1 && <span>/</span>}
                </span>
              ))
            : variant.name}
        </span>
      </div>

      {/* Price */}
      <div className="w-36">
        <NumberInput
          step="0.01"
          min={0}
          value={variant.price}
          whenEmpty={0}
          onClick={(e) => e.stopPropagation()}
          onValueChange={(next) => onUpdate({ ...variant, price: next ?? 0 })}
          placeholder="0.00"
          className="h-8 text-sm"
        />
      </div>

      {/* Available — location-aware */}
      <div className="w-24" onClick={(e) => e.stopPropagation()}>
        <VariantAvailableCell
          variant={variant}
          locations={locations}
          onUpdate={onUpdate}
        />
      </div>
    </div>
  );
}

// Renders the per-row "Available" control. Behavior depends on how many
// locations the store has:
//   0 locations → editable input writes to legacy variant.stock
//   1 location  → editable input writes to that one location's quantity
//   2+ locations → read-only sum + popover to edit per-location
function VariantAvailableCell({
  variant,
  locations,
  onUpdate,
}: {
  variant: ProductVariant;
  locations: InventoryLocationLite[];
  onUpdate: (variant: ProductVariant) => void;
}) {
  const [open, setOpen] = useState(false);

  const setLocationQuantity = (locationId: string, qty: number) => {
    const safe = Math.max(0, qty);
    const existing = variant.locationInventory || [];
    const found = existing.some(
      (li) => String(li.locationId) === locationId,
    );
    const next: LocationInventory[] = found
      ? existing.map((li) =>
          String(li.locationId) === locationId
            ? { ...li, quantity: safe }
            : li,
        )
      : [
          ...existing,
          {
            locationId,
            locationName: locations.find((l) => l._id === locationId)?.name,
            quantity: safe,
          },
        ];
    const total = next.reduce((s, l) => s + (l.quantity || 0), 0);
    onUpdate({ ...variant, locationInventory: next, stock: total });
  };

  // No locations configured at all — fall back to the legacy stock field.
  if (locations.length === 0) {
    return (
      <NumberInput
        min={0}
        step={1}
        value={variant.stock}
        whenEmpty={0}
        normalize={Math.trunc}
        onValueChange={(next) => onUpdate({ ...variant, stock: next ?? 0 })}
        placeholder="0"
        className="h-8 text-sm"
      />
    );
  }

  // Exactly one location — edit it directly, looks like a normal input.
  if (locations.length === 1) {
    const onlyLoc = locations[0];
    const qty =
      variant.locationInventory?.find(
        (li) => String(li.locationId) === onlyLoc._id,
      )?.quantity ?? 0;
    return (
      <NumberInput
        min={0}
        step={1}
        value={qty}
        whenEmpty={0}
        normalize={Math.trunc}
        onValueChange={(next) => setLocationQuantity(onlyLoc._id, next ?? 0)}
        placeholder="0"
        className="h-8 text-sm"
      />
    );
  }

  // Multiple locations — total is read-only, click to edit per location.
  const total = variantAvailable(variant);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-full justify-between font-normal"
        >
          <span>{total}</span>
          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="space-y-2">
          <div className="text-sm font-medium">Inventory by location</div>
          {locations.map((loc) => {
            const qty =
              variant.locationInventory?.find(
                (li) => String(li.locationId) === loc._id,
              )?.quantity ?? 0;
            return (
              <div
                key={loc._id}
                className="flex items-center justify-between gap-2"
              >
                <div className="flex-1 text-sm">
                  {loc.name}
                  {loc.isDefault && (
                    <Badge variant="outline" className="ml-1.5 text-[10px]">
                      Default
                    </Badge>
                  )}
                </div>
                <NumberInput
                  min={0}
                  step={1}
                  value={qty}
                  whenEmpty={0}
                  normalize={Math.trunc}
                  onValueChange={(next) =>
                    setLocationQuantity(loc._id, next ?? 0)
                  }
                  placeholder="0"
                  className="h-8 w-20 text-sm"
                />
              </div>
            );
          })}
          <Separator />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="font-medium">{total}</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Renders the collapsed group's price cell. Mirrors Shopify:
// - all child variants share a price -> shows that single value
// - children differ -> shows "min - max" range
// - all zero/unset -> empty placeholder
// Typing a number bulk-applies it to every child variant.
function GroupPriceInput({
  variants,
  onApplyPrice,
}: {
  variants: ProductVariant[];
  onApplyPrice: (price: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const { currency } = useCurrency();
  const currencySymbol = currency?.symbol || currency?.code || "";

  const prices = variants.map((v) => v.price || 0);
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 0;
  const allSame = min === max;
  const hasAnyPrice = max > 0;

  const display = !hasAnyPrice
    ? ""
    : allSame
      ? min.toFixed(2)
      : `${min.toFixed(2)} - ${max.toFixed(2)}`;

  return (
    <CurrencyInput
      type="text"
      currencySymbol={currencySymbol}
      inputMode="decimal"
      placeholder="0.00"
      className="h-8 text-sm"
      value={draft ?? display}
      onClick={(e) => e.stopPropagation()}
      onFocus={() => setDraft(allSame && hasAnyPrice ? String(min) : "")}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const n = parseFloat(raw);
        if (!Number.isNaN(n) && n >= 0) {
          onApplyPrice(n);
        }
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

function BulkNumberPopover({
  buttonLabel,
  heading,
  placeholder,
  step,
  parseValue,
  onApply,
}: {
  buttonLabel: string;
  heading: string;
  placeholder: string;
  step: string;
  parseValue: (value: string) => number;
  onApply: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  const parsedValue = parseValue(value);
  const isValid = value !== "" && !Number.isNaN(parsedValue) && parsedValue >= 0;

  const apply = () => {
    if (!isValid) return;
    onApply(parsedValue);
    setOpen(false);
    setValue("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {buttonLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="space-y-3">
          <div className="text-sm font-medium">{heading}</div>
          <Input
            autoFocus
            type="number"
            step={step}
            min="0"
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                apply();
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setValue("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={apply}
              disabled={!isValid}
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Shopify-style bulk price editor: small popover with a numeric input + Apply.
// Used for both `price` and `comparePrice` (compare-at) bulk edits.
export function BulkPricePopover({
  count,
  field = "price",
  onApply,
}: {
  count: number;
  field?: "price" | "comparePrice";
  onApply: (price: number) => void;
}) {
  const buttonLabel =
    field === "price" ? "Set price" : "Set compare-at price";
  const heading =
    field === "price"
      ? `Set price for ${count} variant${count !== 1 ? "s" : ""}`
      : `Set compare-at price for ${count} variant${count !== 1 ? "s" : ""}`;

  return (
    <BulkNumberPopover
      buttonLabel={buttonLabel}
      heading={heading}
      placeholder="0.00"
      step="0.01"
      parseValue={(rawValue) => parseFloat(rawValue)}
      onApply={onApply}
    />
  );
}

export function BulkStockPopover({
  count,
  locationName,
  onApply,
}: {
  count: number;
  locationName?: string;
  onApply: (quantity: number) => void;
}) {
  const variantLabel = `variant${count !== 1 ? "s" : ""}`;
  const locationSuffix = locationName ? ` at ${locationName}` : "";

  return (
    <BulkNumberPopover
      buttonLabel="Set stock"
      heading={`Set stock for ${count} ${variantLabel}${locationSuffix}`}
      placeholder="0"
      step="1"
      parseValue={(rawValue) => parseInt(rawValue, 10)}
      onApply={onApply}
    />
  );
}

export function VariantGroup({
  groupName,
  variants,
  groupByOptionId,
  isExpanded,
  onToggle,
  onUpdateVariant,
  onUpdateGroupPrice,
  onEditVariant,
  mediaItems,
  selectedVariants,
  onSelectVariant,
  onSelectAll,
  onBulkImageSet,
  onRequestAiImage,
  locations,
}: {
  groupName: string;
  variants: ProductVariant[];
  groupByOptionId: string | null;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdateVariant: (variant: ProductVariant) => void;
  onUpdateGroupPrice: (variantIds: string[], price: number) => void;
  onEditVariant: (variantId: string) => void;
  mediaItems: MediaItem[];
  selectedVariants: Set<string>;
  onSelectVariant: (variantId: string, selected: boolean) => void;
  onSelectAll: (selected: boolean) => void;
  onBulkImageSet: (variantIds: string[], mediaId: string | undefined) => void;
  onRequestAiImage?: (target: VariantAiImageTarget) => void;
  locations: InventoryLocationLite[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const allSelected = variants.every((v) => selectedVariants.has(v.id));
  const someSelected =
    variants.some((v) => selectedVariants.has(v.id)) && !allSelected;

  // Get the most common media for this group (if any)
  const groupMediaId = variants[0]?.mediaId;
  const groupMediaUrl = mediaItems.find((m) => m._id === groupMediaId)?.url;
  const groupOptionValue = variants[0]?.optionValues.find(
    (ov) => ov.optionId === groupByOptionId && ov.value === groupName,
  );

  return (
    <div className="border-b last:border-b-0">
      {/* Group header */}
      <div
        className="flex items-center gap-3 py-3 px-3 cursor-pointer hover:bg-muted/30"
        onClick={onToggle}
      >
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected;
          }}
          onChange={(e) => {
            e.stopPropagation();
            onSelectAll(e.target.checked);
          }}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded border-gray-300"
        />

        {/* Group image — opens the product media gallery picker */}
        <div className="relative shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setPickerOpen(true);
          }}
          title="Select image from product media"
          className={cn(
            "relative h-10 w-10 rounded border-2 border-dotted border-primary/50 bg-muted/30 flex items-center justify-center overflow-hidden cursor-pointer transition-all hover:border-primary hover:bg-primary/5",
            groupMediaUrl && "border-solid border-transparent"
          )}
        >
          {groupMediaUrl ? (
            <AppImage
              src={groupMediaUrl}
              alt=""
              fill
              sizes="40px"
              className="object-cover"
            />
          ) : (
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {onRequestAiImage ? (
          <AiImageBadge
            onClick={(e) => {
              e.stopPropagation();
              const isColorGroup = isColorOptionName(
                groupOptionValue?.optionName,
              );
              onRequestAiImage({
                variantIds: variants.map((v) => v.id),
                label: groupName,
                colorName: isColorGroup ? groupName : undefined,
                colorHex:
                  isColorGroup && isHexColor(groupOptionValue?.colorCode)
                    ? groupOptionValue?.colorCode
                    : undefined,
              });
            }}
          />
        ) : null}
        </div>

        <div className="flex-1">
          <div className="flex items-center gap-2">
            <ColorSwatch optionValue={groupOptionValue} />
            <span className="font-medium">{groupName}</span>
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {variants.length} variant{variants.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Group-level bulk price + available - always visible, like Shopify */}
        <div className="w-36">
          <GroupPriceInput
            variants={variants}
            onApplyPrice={(price) =>
              onUpdateGroupPrice(
                variants.map((variant) => variant.id),
                price,
              )
            }
          />
        </div>
        <div className="w-20 text-center">
          <span className="text-sm text-muted-foreground">
            {variants.reduce((sum, v) => sum + variantAvailable(v), 0)}
          </span>
        </div>
      </div>

      {/* Expanded variants */}
      {isExpanded && (
        <div className="pl-6 pb-2">
          {variants.map((variant) => (
            <VariantRow
              key={variant.id}
              variant={variant}
              groupByOptionId={groupByOptionId}
              onUpdate={onUpdateVariant}
              onEdit={() => onEditVariant(variant.id)}
              mediaItems={mediaItems}
              isSelected={selectedVariants.has(variant.id)}
              onSelectChange={(selected) =>
                onSelectVariant(variant.id, selected)
              }
              onRequestAiImage={onRequestAiImage}
              locations={locations}
            />
          ))}
        </div>
      )}

      <ImageSelectorModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        mediaItems={mediaItems}
        selectedId={groupMediaId}
        onSelect={(id) => onBulkImageSet(variants.map((v) => v.id), id)}
        isBulk
        bulkCount={variants.length}
      />
    </div>
  );
}

// Main Component
