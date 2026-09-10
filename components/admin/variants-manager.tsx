"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Trash2,
  Plus,
  RefreshCw,
} from "lucide-react";
import { generateBarcode } from "@/lib/products/codes";
import {
  MAX_OPTION_COUNT,
  applyBulkStockToVariants,
  collectVariantBarcodes,
  generateAllCombinations,
  generateId,
  generateVariantSku,
  getOptionNamePlaceholder,
  groupVariantsByOption,
  mergeVariants,
  variantAvailable,
  withSyncedLocations,
} from "@/components/admin/variants-manager/helpers";
import { OptionEditor } from "@/components/admin/variants-manager/option-editor";
import { useGlobalVariants } from "@/components/admin/variants-manager/use-global-variants";
import { VariantEditModal } from "@/components/admin/variants-manager/variant-edit-modal";
import {
  BulkPricePopover,
  BulkStockPopover,
  VariantGroup,
} from "@/components/admin/variants-manager/variant-rows";
export type {
  ProductOption,
  ProductVariant,
} from "@/components/admin/variants-manager/helpers";
import type {
  ProductOption,
  ProductVariant,
  VariantsManagerProps,
} from "@/components/admin/variants-manager/helpers";

export function VariantsManager({
  options,
  onOptionsChange,
  variants,
  onVariantsChange,
  mediaItems = [],
  defaultPrice = 0,
  locations = [],
  onRequestAiImage,
  defaultRequiresShipping = true,
  defaultWeightUnit = "kg",
}: VariantsManagerProps) {
  const { variants: globalVariants } = useGlobalVariants();
  const isMultiLocation = locations.length > 1;
  const hasAnyLocation = locations.length > 0;
  const defaultLocation =
    locations.find((l) => l.isDefault) || locations[0] || null;
  const [expandedOptionId, setExpandedOptionId] = useState<string | null>(null);
  const [groupByOptionId, setGroupByOptionId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedVariants, setSelectedVariants] = useState<Set<string>>(
    new Set()
  );
  const [collapseAll, setCollapseAll] = useState(false);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const sortedOptions = useMemo(
    () => [...options].sort((a, b) => a.position - b.position),
    [options],
  );
  const groupableOptions = useMemo(
    () => sortedOptions.filter((option) => option.name.trim()),
    [sortedOptions],
  );
  const activeGroupByOptionId =
    groupableOptions.some((option) => option.id === groupByOptionId)
      ? groupByOptionId
      : (groupableOptions[0]?.id ?? null);
  const editingVariant =
    variants.find((variant) => variant.id === editingVariantId) ?? null;

  // Whenever the active locations change (or variants are first generated),
  // make sure each variant has a locationInventory entry per active location.
  // This is what lets the "Available" cell write into a real location bucket
  // instead of the legacy stock field.
  useEffect(() => {
    if (locations.length === 0) return;
    const needsSync = variants.some((v) => {
      const li = v.locationInventory || [];
      if (li.length !== locations.length) return true;
      const ids = new Set(li.map((x) => String(x.locationId)));
      return locations.some((loc) => !ids.has(loc._id));
    });
    if (!needsSync) return;
    onVariantsChange(variants.map((v) => withSyncedLocations(v, locations)));
    // We intentionally only run when the locations prop identity changes;
    // adding `variants` would loop because we call onVariantsChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations]);

  // Regenerate variants when options change
  const regenerateVariants = useCallback(
    (newOptions: ProductOption[]) => {
      const combinations = generateAllCombinations(newOptions);
      const merged = mergeVariants(combinations, variants, defaultPrice);
      const synced =
        locations.length > 0
          ? merged.map((v) => withSyncedLocations(v, locations))
          : merged;
      onVariantsChange(synced);
    },
    [variants, defaultPrice, onVariantsChange, locations]
  );

  const handleAddOption = () => {
    if (options.length >= MAX_OPTION_COUNT) return;

    const newOption: ProductOption = {
      id: generateId(),
      name: "",
      values: [],
      position: options.length,
    };

    const newOptions = [...options, newOption];
    onOptionsChange(newOptions);
    setExpandedOptionId(newOption.id);
  };

  const handleUpdateOption = (updatedOption: ProductOption) => {
    const newOptions = options.map((o) =>
      o.id === updatedOption.id ? updatedOption : o
    );
    onOptionsChange(newOptions);
    regenerateVariants(newOptions);
  };

  const handleDeleteOption = (optionId: string) => {
    const newOptions = options
      .filter((o) => o.id !== optionId)
      .map((o, idx) => ({ ...o, position: idx }));
    onOptionsChange(newOptions);
    regenerateVariants(newOptions);

    if (groupByOptionId === optionId) {
      setGroupByOptionId(
        newOptions.find((option) => option.name.trim())?.id ?? null,
      );
    }
  };

  const handleUpdateVariant = (updatedVariant: ProductVariant) => {
    onVariantsChange(
      variants.map((v) => (v.id === updatedVariant.id ? updatedVariant : v))
    );
  };

  const handleUpdateGroupPrice = (variantIds: string[], price: number) => {
    const groupIds = new Set(variantIds);
    onVariantsChange(
      variants.map((variant) =>
        groupIds.has(variant.id) ? { ...variant, price } : variant,
      ),
    );
  };

  const handleRemoveVariant = (variantId: string) => {
    onVariantsChange(variants.filter((variant) => variant.id !== variantId));
    setSelectedVariants((current) => {
      const next = new Set(current);
      next.delete(variantId);
      return next;
    });
    if (editingVariantId === variantId) {
      setEditingVariantId(null);
    }
  };

  const handleSelectVariant = (variantId: string, selected: boolean) => {
    const newSelected = new Set(selectedVariants);
    if (selected) {
      newSelected.add(variantId);
    } else {
      newSelected.delete(variantId);
    }
    setSelectedVariants(newSelected);
  };

  const handleSelectGroupAll = (
    groupVariants: ProductVariant[],
    selected: boolean
  ) => {
    const newSelected = new Set(selectedVariants);
    for (const v of groupVariants) {
      if (selected) {
        newSelected.add(v.id);
      } else {
        newSelected.delete(v.id);
      }
    }
    setSelectedVariants(newSelected);
  };

  const toggleGroup = (groupName: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupName)) {
      newExpanded.delete(groupName);
    } else {
      newExpanded.add(groupName);
    }
    setExpandedGroups(newExpanded);
  };

  const handleCollapseAllToggle = () => {
    if (collapseAll) {
      const allGroups = Array.from(
        groupVariantsByOption(variants, activeGroupByOptionId || "").keys()
      );
      setExpandedGroups(new Set(allGroups));
    } else {
      setExpandedGroups(new Set());
    }
    setCollapseAll(!collapseAll);
  };

  // Bulk image set for multiple variants
  const handleBulkImageSet = (
    variantIds: string[],
    mediaId: string | undefined
  ) => {
    onVariantsChange(
      variants.map((v) => (variantIds.includes(v.id) ? { ...v, mediaId } : v))
    );
  };

  // Group variants
  const groupedVariants = useMemo(() => {
    if (!activeGroupByOptionId) {
      return new Map([["All variants", variants]]);
    }
    return groupVariantsByOption(variants, activeGroupByOptionId);
  }, [variants, activeGroupByOptionId]);

  const totalInventory = variants.reduce(
    (sum, v) => sum + variantAvailable(v),
    0,
  );
  const hasValidOptions = options.some(
    (o) => o.name.trim() && o.values.length > 0
  );

  return (
    <div className="space-y-4">
      {/* Options Section */}
      <div className="space-y-3">
        {sortedOptions.map((option, index) => (
          <OptionEditor
            key={option.id}
            option={option}
            namePlaceholder={getOptionNamePlaceholder(index)}
            isExpanded={expandedOptionId === option.id}
            onToggle={() =>
              setExpandedOptionId(
                expandedOptionId === option.id ? null : option.id
              )
            }
            onUpdate={handleUpdateOption}
            onDelete={() => handleDeleteOption(option.id)}
            canDelete={true}
            globalVariants={globalVariants}
            existingOptionNames={sortedOptions
              .filter((o) => o.id !== option.id)
              .map((o) => o.name)}
          />
        ))}

        {options.length < MAX_OPTION_COUNT && (
          <button
            type="button"
            onClick={handleAddOption}
            className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-foreground/80 transition-colors py-1"
          >
            <Plus className="h-4 w-4 rounded-full border border-current p-0.5" />
            {options.length === 0
              ? "Add options like size or color"
              : "Add another option"}
          </button>
        )}
      </div>

      {/* Variants Table */}
      {hasValidOptions && variants.length > 0 && (
        <>
          <Separator />

          {/* Variants Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Group by</span>
              <Select
                value={activeGroupByOptionId || ""}
                onValueChange={setGroupByOptionId}
              >
                <SelectTrigger className="w-[120px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groupableOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm text-muted-foreground">
              {variants.length} variant{variants.length !== 1 ? "s" : ""}
            </div>
          </div>

          {/* Bulk Actions Bar - shows when variants selected */}
          {selectedVariants.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2 px-3 bg-primary/10 border border-primary/20 rounded-lg">
              <span className="text-sm font-medium whitespace-nowrap">
                {selectedVariants.size} selected
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <BulkPricePopover
                  count={selectedVariants.size}
                  onApply={(price) => {
                    onVariantsChange(
                      variants.map((v) =>
                        selectedVariants.has(v.id) ? { ...v, price } : v
                      )
                    );
                  }}
                />
                <BulkPricePopover
                  count={selectedVariants.size}
                  field="comparePrice"
                  onApply={(price) => {
                    onVariantsChange(
                      variants.map((v) =>
                        selectedVariants.has(v.id)
                          ? { ...v, comparePrice: price > 0 ? price : undefined }
                          : v
                      )
                    );
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => {
                    onVariantsChange(
                      variants.map((variant) =>
                        selectedVariants.has(variant.id)
                          ? { ...variant, sku: generateVariantSku(variant) }
                          : variant,
                      ),
                    );
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Generate SKUs
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => {
                    const usedBarcodes = collectVariantBarcodes(
                      variants.filter(
                        (variant) => !selectedVariants.has(variant.id),
                      ),
                    );
                    onVariantsChange(
                      variants.map((variant) => {
                        if (!selectedVariants.has(variant.id)) return variant;
                        const barcode = generateBarcode(usedBarcodes);
                        usedBarcodes.add(barcode);
                        return {
                          ...variant,
                          barcode,
                          barcodeFormat: "ean13" as const,
                          barcodeSource: "internal" as const,
                        };
                      }),
                    );
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Generate barcodes
                </Button>
                <BulkStockPopover
                  count={selectedVariants.size}
                  locationName={isMultiLocation ? defaultLocation?.name : undefined}
                  onApply={(quantity) => {
                    onVariantsChange(
                      applyBulkStockToVariants({
                        variants,
                        selectedVariantIds: selectedVariants,
                        quantity,
                        locations,
                      }),
                    );
                  }}
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (
                      confirm(
                        `Delete ${selectedVariants.size} selected variants?`
                      )
                    ) {
                      onVariantsChange(
                        variants.filter((v) => !selectedVariants.has(v.id))
                      );
                      setSelectedVariants(new Set());
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Variants Table */}
          <div className="rounded-lg border">
            <div className="flex items-center gap-3 py-2 px-3 bg-muted/50 border-b text-sm font-medium">
              <div className="w-4" />
              <div className="w-10" />
              <div className="flex-1">
                <button
                  type="button"
                  onClick={handleCollapseAllToggle}
                  className="text-sm hover:underline"
                >
                  Variant · {collapseAll ? "Expand" : "Collapse"} all
                </button>
              </div>
              <div className="w-36 text-center">Price</div>
              <div className="w-20 text-center">Available</div>
            </div>

            {/* Variant Groups */}
            {Array.from(groupedVariants.entries()).map(
              ([groupName, groupVariants]) => (
                <VariantGroup
                  key={groupName}
                  groupName={groupName}
                  variants={groupVariants}
                  groupByOptionId={activeGroupByOptionId}
                  isExpanded={expandedGroups.has(groupName)}
                  onToggle={() => toggleGroup(groupName)}
                  onUpdateVariant={handleUpdateVariant}
                  onUpdateGroupPrice={handleUpdateGroupPrice}
                  onEditVariant={setEditingVariantId}
                  mediaItems={mediaItems}
                  selectedVariants={selectedVariants}
                  onSelectVariant={handleSelectVariant}
                  onSelectAll={(selected) =>
                    handleSelectGroupAll(groupVariants, selected)
                  }
                  onBulkImageSet={handleBulkImageSet}
                  onRequestAiImage={onRequestAiImage}
                  locations={locations}
                />
              )
            )}

            {/* Footer */}
            <div className="py-3 px-3 bg-muted/30 text-sm text-muted-foreground text-center border-t">
              {isMultiLocation
                ? `Total inventory across ${locations.length} locations: ${totalInventory} available`
                : hasAnyLocation
                  ? `Total inventory at ${defaultLocation?.name ?? locations[0].name}: ${totalInventory} available`
                  : `Total inventory: ${totalInventory} available`}
            </div>
          </div>

          <VariantEditModal
            key={editingVariant?.id ?? "variant-edit-modal"}
            variant={editingVariant}
            variants={variants}
            open={editingVariant !== null}
            onClose={() => setEditingVariantId(null)}
            onUpdate={handleUpdateVariant}
            onRemove={handleRemoveVariant}
            defaultRequiresShipping={defaultRequiresShipping}
            defaultWeightUnit={defaultWeightUnit}
          />
        </>
      )}
    </div>
  );
}
