"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CollectionCondition, CollectionConditionField, CollectionConditionOperator } from "@/types";
import { useMultiVendorMode } from "@/providers/app-settings-provider";
import { apiClient } from "@/lib/api/client";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface CollectionConditionBuilderProps {
  conditions: CollectionCondition[];
  onChange: (conditions: CollectionCondition[]) => void;
  matchType: "all" | "any";
  onMatchTypeChange: (type: "all" | "any") => void;
}

const FIELD_OPTIONS: { value: CollectionConditionField; label: string; type: "string" | "number" | "date" }[] = [
  { value: "title", label: "Product title", type: "string" },
  { value: "productType", label: "Product type", type: "string" },
  { value: "vendor", label: "Vendor", type: "string" },
  { value: "tag", label: "Product tag", type: "string" },
  { value: "price", label: "Price", type: "number" },
  { value: "comparePrice", label: "Compare at price", type: "number" },
  { value: "weight", label: "Weight", type: "number" },
  { value: "stock", label: "Stock quantity", type: "number" },
  { value: "category", label: "Category", type: "string" },
];

const STRING_OPERATORS: { value: CollectionConditionOperator; label: string }[] = [
  { value: "equals", label: "is equal to" },
  { value: "not_equals", label: "is not equal to" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "is_set", label: "is set" },
  { value: "is_not_set", label: "is not set" },
];

const NUMBER_OPERATORS: { value: CollectionConditionOperator; label: string }[] = [
  { value: "equals", label: "is equal to" },
  { value: "not_equals", label: "is not equal to" },
  { value: "greater_than", label: "is greater than" },
  { value: "less_than", label: "is less than" },
  { value: "is_set", label: "is set" },
  { value: "is_not_set", label: "is not set" },
];

const VENDOR_OPERATORS: { value: CollectionConditionOperator; label: string }[] = [
  { value: "equals", label: "is equal to" },
  { value: "not_equals", label: "is not equal to" },
  { value: "is_set", label: "is set" },
  { value: "is_not_set", label: "is not set" },
];

type VendorOption = { _id: string; storeName: string; slug?: string };

/** `is_set` / `is_not_set` are complete on their own — they render no value. */
function needsValueInput(operator: CollectionConditionOperator) {
  return !["is_set", "is_not_set"].includes(operator);
}

export function CollectionConditionBuilder({
  conditions,
  onChange,
  matchType,
  onMatchTypeChange,
}: CollectionConditionBuilderProps) {
  // `null` until the first successful fetch: that is what "loading" means.
  const [vendors, setVendors] = useState<VendorOption[] | null>(null);
  const { isMultiVendor } = useMultiVendorMode();
  const hasRequestedVendors = useRef(false);
  // Bumped on failure so the effect below actually re-runs. Clearing the ref
  // alone would not: neither of its other deps changes when a fetch fails.
  const [vendorAttempt, setVendorAttempt] = useState(0);
  const fieldOptions = useMemo(
    () =>
      isMultiVendor
        ? FIELD_OPTIONS
        : FIELD_OPTIONS.filter((field) => field.value !== "vendor"),
    [isMultiVendor],
  );
  const hasVendorCondition = conditions.some(
    (condition) => condition.field === "vendor",
  );

  // Only a `vendor` condition reads this list, and most collections never add
  // one — so it is fetched on demand rather than on mount. The list route has
  // no projection option, so deferring is the only way to not pay for it.
  const isLoadingVendors =
    isMultiVendor && hasVendorCondition && vendors === null;
  useApplyOnChange([isMultiVendor], () => {
    if (!isMultiVendor) setVendors([]);
  });
  useEffect(() => {
    if (!isMultiVendor) {
      hasRequestedVendors.current = false;
      return;
    }
    if (!hasVendorCondition || hasRequestedVendors.current) return;

    hasRequestedVendors.current = true;

    // Deliberately not cancelled on cleanup: `hasVendorCondition` flips off the
    // moment the user switches that row to another field, and dropping the
    // in-flight result there would leave the one-shot ref set with no list.
    async function fetchVendors() {
      try {
        // `limit` is load-bearing: AdminListQuerySchema defaults it to 10 and
        // the route always applies it, so omitting it silently truncates the
        // picker to the first ten vendors.
        const result = await apiClient.get<{ data: VendorOption[] }>(
          "/api/admin/vendors",
          { query: { page: 1, limit: 100, status: "all", sortOrder: "asc" } },
        );
        const vendorList = result?.data;
        setVendors(Array.isArray(vendorList) ? vendorList : []);
      } catch {
        // Let a later vendor condition retry; the list stays "loading" until
        // one of those attempts lands.
        hasRequestedVendors.current = false;
        setVendorAttempt((attempt) => attempt + 1);
      } finally {
      }
    }

    fetchVendors();
  }, [isMultiVendor, hasVendorCondition, vendorAttempt]);

  // The list now usually lands after the condition was switched to `vendor`,
  // so the default selection that used to be applied inline in
  // `updateCondition` is applied here instead — for both orderings.
  useEffect(() => {
    if (!vendors || vendors.length === 0) return;

    let changed = false;
    const next = conditions.map((condition) => {
      if (condition.field !== "vendor") return condition;
      // `is_set` / `is_not_set` rows render no value input, so filling one in
      // would silently rewrite a stored condition on the next save.
      if (!needsValueInput(condition.operator)) return condition;
      if (typeof condition.value === "string" && condition.value) return condition;
      changed = true;
      return { ...condition, value: vendors[0]._id };
    });

    if (changed) onChange(next);
  }, [vendors, conditions, onChange]);

  const getFieldType = (field: CollectionConditionField) => {
    return fieldOptions.find((f) => f.value === field)?.type || "string";
  };

  const getOperatorsForField = (field: CollectionConditionField) => {
    if (field === "vendor") return VENDOR_OPERATORS;
    const fieldType = getFieldType(field);
    return fieldType === "number" ? NUMBER_OPERATORS : STRING_OPERATORS;
  };

  const addCondition = () => {
    onChange([
      ...conditions,
      { field: "title", operator: "contains", value: "" },
    ]);
  };

  const removeCondition = (index: number) => {
    onChange(conditions.filter((_, i) => i !== index));
  };

  const updateCondition = (
    index: number,
    updates: Partial<CollectionCondition>
  ) => {
    const newConditions = [...conditions];
    newConditions[index] = { ...newConditions[index], ...updates };

    // Reset operator if field type changes
    if (updates.field) {
      const currentOperator = newConditions[index].operator;
      const validOperators = getOperatorsForField(updates.field);

      if (!validOperators.find((op) => op.value === currentOperator)) {
        newConditions[index].operator = validOperators[0].value;
      }
    }

    onChange(newConditions);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Collection Conditions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Match Type */}
        <div className="space-y-2">
          <Label>Products must match:</Label>
          <div className="flex gap-4">
            <div className="flex items-center space-x-2">
              <input
                type="radio"
                id="match-all"
                name="matchType"
                value="all"
                checked={matchType === "all"}
                onChange={() => onMatchTypeChange("all")}
              />
              <Label htmlFor="match-all" className="font-normal cursor-pointer">
                All conditions
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="radio"
                id="match-any"
                name="matchType"
                value="any"
                checked={matchType === "any"}
                onChange={() => onMatchTypeChange("any")}
              />
              <Label htmlFor="match-any" className="font-normal cursor-pointer">
                Any condition
              </Label>
            </div>
          </div>
        </div>

        {/* Conditions */}
        <div className="space-y-3">
          {conditions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center border rounded-md">
              No conditions added. Add a condition to automatically include products.
            </p>
          ) : (
            conditions.map((condition, index) => {
              const operators = getOperatorsForField(condition.field);
              const fieldType = getFieldType(condition.field);

              return (
                <div
                  key={index}
                  className="flex flex-wrap items-end gap-2 p-3 border rounded-md bg-muted/30"
                >
                  {/* Field Select */}
                  <div className="flex-1 min-w-[150px]">
                    <Label className="text-xs text-muted-foreground">Field</Label>
                    <NativeSelect
                      value={condition.field}
                      onChange={(event) =>
                        updateCondition(index, {
                          field: event.target.value as CollectionConditionField,
                        })
                      }
                    >
                      {fieldOptions.map((field) => (
                        <option key={field.value} value={field.value}>
                          {field.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>

                  {/* Operator Select */}
                  <div className="flex-1 min-w-[150px]">
                    <Label className="text-xs text-muted-foreground">Condition</Label>
                    <NativeSelect
                      value={condition.operator}
                      onChange={(event) =>
                        updateCondition(index, {
                          operator: event.target.value as CollectionConditionOperator,
                        })
                      }
                    >
                      {operators.map((op) => (
                        <option key={op.value} value={op.value}>
                          {op.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>

                  {/* Value Input */}
                  {needsValueInput(condition.operator) && (
                    <div className="flex-1 min-w-[150px]">
                      <Label className="text-xs text-muted-foreground">Value</Label>
                      {condition.field === "vendor" &&
                      ((vendors?.length ?? 0) > 0 || isLoadingVendors) ? (
                        // Held disabled while the deferred list is in flight so
                        // the vendor row never briefly accepts free text.
                        <NativeSelect
                          disabled={isLoadingVendors}
                          value={typeof condition.value === "string" ? condition.value : ""}
                          onChange={(event) =>
                            updateCondition(index, { value: event.target.value })
                          }
                        >
                          <option value="" disabled>
                            {isLoadingVendors ? "Loading vendors…" : "Select vendor"}
                          </option>
                          {(vendors ?? []).map((v) => (
                            <option key={v._id} value={v._id}>
                              {v.storeName}
                            </option>
                          ))}
                        </NativeSelect>
                      ) : (
                        <Input
                          type={fieldType === "number" ? "number" : "text"}
                          value={condition.value as string}
                          onChange={(e) =>
                            updateCondition(index, {
                              value:
                                fieldType === "number"
                                  ? parseFloat(e.target.value) || 0
                                  : e.target.value,
                            })
                          }
                          placeholder={
                            fieldType === "number" ? "Enter number" : "Enter value"
                          }
                        />
                      )}
                    </div>
                  )}

                  {/* Delete Button */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeCondition(index)}
                    className="shrink-0"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              );
            })
          )}
        </div>

        {/* Add Condition Button */}
        <Button
          type="button"
          variant="outline"
          onClick={addCondition}
          className="w-full"
        >
          <Plus className="mr-2 h-4 w-4" />
          Add condition
        </Button>
      </CardContent>
    </Card>
  );
}
