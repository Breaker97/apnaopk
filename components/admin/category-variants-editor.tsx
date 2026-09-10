"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OptionEditor } from "@/components/admin/variants-manager/option-editor";
import { useGlobalVariants } from "@/components/admin/variants-manager/use-global-variants";
import {
  MAX_OPTION_COUNT,
  generateAllCombinations,
  generateId,
  getOptionNamePlaceholder,
  type ProductOption,
} from "@/components/admin/variants-manager/helpers";

/**
 * Category-level variant editor.
 *
 * A trimmed version of the product `VariantsManager`: it defines option names
 * and their values (with colour swatches) and stops at the "Group by" summary
 * — there is no per-variant table, pricing, stock, or images, because a
 * category only stores a reusable option *template*. Products assigned to the
 * category can inherit these options.
 */
export function CategoryVariantsEditor({
  options,
  onChange,
}: {
  options: ProductOption[];
  onChange: (options: ProductOption[]) => void;
}) {
  const [expandedOptionId, setExpandedOptionId] = useState<string | null>(null);
  const [groupByOptionId, setGroupByOptionId] = useState<string | null>(null);
  const { variants: globalVariants } = useGlobalVariants();

  const sortedOptions = useMemo(
    () => [...options].sort((a, b) => a.position - b.position),
    [options],
  );

  const groupableOptions = useMemo(
    () => sortedOptions.filter((option) => option.name.trim()),
    [sortedOptions],
  );

  const activeGroupByOptionId = groupableOptions.some(
    (option) => option.id === groupByOptionId,
  )
    ? groupByOptionId
    : (groupableOptions[0]?.id ?? null);

  const hasValidOptions = options.some(
    (option) => option.name.trim() && option.values.length > 0,
  );

  const variantCount = useMemo(
    () => generateAllCombinations(options).length,
    [options],
  );

  const handleAddOption = () => {
    if (options.length >= MAX_OPTION_COUNT) return;
    const newOption: ProductOption = {
      id: generateId(),
      name: "",
      values: [],
      position: options.length,
    };
    onChange([...options, newOption]);
    setExpandedOptionId(newOption.id);
  };

  const handleUpdateOption = (updated: ProductOption) => {
    onChange(options.map((option) => (option.id === updated.id ? updated : option)));
  };

  const handleDeleteOption = (optionId: string) => {
    const next = options
      .filter((option) => option.id !== optionId)
      .map((option, idx) => ({ ...option, position: idx }));
    onChange(next);
    if (groupByOptionId === optionId) {
      setGroupByOptionId(next.find((option) => option.name.trim())?.id ?? null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Options */}
      <div className="space-y-3">
        {sortedOptions.map((option, index) => (
          <OptionEditor
            key={option.id}
            option={option}
            namePlaceholder={getOptionNamePlaceholder(index)}
            isExpanded={expandedOptionId === option.id}
            onToggle={() =>
              setExpandedOptionId(
                expandedOptionId === option.id ? null : option.id,
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
            className="flex items-center gap-2 py-1 text-sm font-medium text-foreground transition-colors hover:text-foreground/80"
          >
            <Plus className="h-4 w-4 rounded-full border border-current p-0.5" />
            {options.length === 0
              ? "Add options like size or color"
              : "Add another option"}
          </button>
        )}
      </div>

      {/* Group-by summary — informational; no variant table follows. */}
      {hasValidOptions && (
        <>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Group by</span>
              <Select
                value={activeGroupByOptionId || ""}
                onValueChange={setGroupByOptionId}
              >
                <SelectTrigger className="h-8 w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groupableOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm text-muted-foreground">
              {variantCount} variant{variantCount !== 1 ? "s" : ""}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
