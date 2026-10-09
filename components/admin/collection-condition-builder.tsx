"use client";

import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createTSafe, type TSafe } from "@/components/admin/online-store/t-safe";
import { BrandSelect } from "@/components/admin/store-pages/brand-select";
import { CategorySelect } from "@/components/admin/store-pages/category-select";
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

/**
 * How a field's value is entered: typed text or a number, a vendor from the
 * list, or a brand or category from a searchable picker that stores the id.
 */
type FieldKind = "string" | "number" | "vendor" | "brand" | "category";

const FIELD_OPTIONS: { value: CollectionConditionField; label: string; kind: FieldKind }[] = [
  { value: "title", label: "Product title", kind: "string" },
  { value: "productType", label: "Product type", kind: "string" },
  { value: "vendor", label: "Vendor", kind: "vendor" },
  { value: "brand", label: "Brand", kind: "brand" },
  { value: "tag", label: "Product tag", kind: "string" },
  { value: "price", label: "Price", kind: "number" },
  { value: "comparePrice", label: "Compare at price", kind: "number" },
  { value: "weight", label: "Weight", kind: "number" },
  { value: "stock", label: "Stock quantity", kind: "number" },
  { value: "category", label: "Category", kind: "category" },
];

const OPERATOR_LABELS: Record<CollectionConditionOperator, string> = {
  equals: "is equal to",
  not_equals: "is not equal to",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  ends_with: "ends with",
  greater_than: "is greater than",
  less_than: "is less than",
  is_set: "is set",
  is_not_set: "is not set",
};

/** The operators each kind of field offers, in the order the select lists them. */
const OPERATORS: Record<FieldKind, CollectionConditionOperator[]> = {
  string: [
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "starts_with",
    "ends_with",
    "is_set",
    "is_not_set",
  ],
  number: ["equals", "not_equals", "greater_than", "less_than", "is_set", "is_not_set"],
  vendor: ["equals", "not_equals", "is_set", "is_not_set"],
  brand: ["equals", "not_equals", "is_set", "is_not_set"],
  // Every product carries a category, so only "is" and "is not" mean
  // anything — and both take the category's whole branch.
  category: ["equals", "not_equals"],
};

/**
 * A brand or category rule reads "is" / "is not": it names one thing, picked
 * from a list, rather than comparing text.
 */
const PICKED_OPERATOR_LABELS: Partial<Record<CollectionConditionOperator, { key: string; label: string }>> = {
  equals: { key: "is", label: "is" },
  not_equals: { key: "isNot", label: "is not" },
};

type VendorOption = { _id: string; storeName: string; slug?: string };
type CategoryEntry = { _id: string; name: string; slug?: string };

/** `is_set` / `is_not_set` are complete on their own — they render no value. */
function needsValueInput(operator: CollectionConditionOperator) {
  return !["is_set", "is_not_set"].includes(operator);
}

/** A stored id: 24 hex characters. Anything else was typed as text. */
function isStoredId(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
}

function kindOf(field: CollectionConditionField): FieldKind {
  return FIELD_OPTIONS.find((option) => option.value === field)?.kind ?? "string";
}

function operatorLabel(
  tSafe: TSafe,
  kind: FieldKind,
  operator: CollectionConditionOperator,
): string {
  const picked = kind === "brand" || kind === "category" ? PICKED_OPERATOR_LABELS[operator] : undefined;
  if (picked) {
    return tSafe(`admin.collectionConditions.operators.${picked.key}`, picked.label);
  }
  return tSafe(
    `admin.collectionConditions.operators.${operator}`,
    OPERATOR_LABELS[operator] ?? operator,
  );
}

/**
 * A category named as text — a rule saved before the picker — resolved the
 * way the rule reader resolves it: by slug, then by its exact name in any
 * case. Undefined when nothing matches.
 */
function categoryNamedBy(
  categories: CategoryEntry[],
  value: string,
): CategoryEntry | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  return (
    categories.find((category) => category.slug === lower) ??
    categories.find((category) => category.name.toLowerCase() === lower)
  );
}

function Attention({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 flex w-full items-start gap-1.5 text-xs leading-snug text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function CollectionConditionBuilder({
  conditions,
  onChange,
  matchType,
  onMatchTypeChange,
}: CollectionConditionBuilderProps) {
  const t = useTranslations();
  const tSafe = createTSafe(t);
  // tSafe hands back its fallback as written; fill the fallback's
  // placeholders too, so a missing message still reads as a sentence.
  const tFill = (key: string, fallback: string, values: Record<string, string>) =>
    tSafe(key, fallback, values).replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
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

  // Category rules saved as text, before the picker, are matched against the
  // category list to say whether they still name one. Fetched only when such
  // a rule is on screen.
  const hasTextCategory = conditions.some(
    (condition) =>
      condition.field === "category" &&
      (condition.operator === "equals" || condition.operator === "not_equals") &&
      typeof condition.value === "string" &&
      condition.value.trim() !== "" &&
      !isStoredId(condition.value),
  );
  const [categories, setCategories] = useState<CategoryEntry[] | null>(null);
  const hasRequestedCategories = useRef(false);
  useEffect(() => {
    if (!hasTextCategory || hasRequestedCategories.current) return;
    hasRequestedCategories.current = true;
    apiClient
      .get<CategoryEntry[]>("/api/categories", { query: { flat: "true" } })
      .then((rows) => setCategories(Array.isArray(rows) ? rows : []))
      .catch(() => {
        hasRequestedCategories.current = false;
      });
  }, [hasTextCategory]);

  const getOperatorsForField = (field: CollectionConditionField) =>
    OPERATORS[kindOf(field)];

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
    const previous = newConditions[index];
    newConditions[index] = { ...previous, ...updates };

    // Reset operator if field type changes
    if (updates.field) {
      const currentOperator = newConditions[index].operator;
      const validOperators = getOperatorsForField(updates.field);

      if (!validOperators.includes(currentOperator)) {
        newConditions[index].operator = validOperators[0];
      }

      // A brand or category rule stores an id, every other rule text or a
      // number: a value carried across that line would be read as the wrong
      // thing, so it starts empty.
      const pickedKinds: FieldKind[] = ["brand", "category"];
      const before = kindOf(previous.field);
      const after = kindOf(updates.field);
      if (before !== after && (pickedKinds.includes(before) || pickedKinds.includes(after))) {
        newConditions[index].value = after === "number" ? 0 : "";
      }
    }

    onChange(newConditions);
  };

  const legacyCategoryNote = (operator: CollectionConditionOperator) => {
    if (operator === "is_set") {
      return tSafe(
        "admin.collectionConditions.legacyCategorySet",
        "This older rule matches every product. Choose “is” or “is not” and pick a category.",
      );
    }
    if (operator === "is_not_set") {
      return tSafe(
        "admin.collectionConditions.legacyCategoryNotSet",
        "This older rule matches no products. Choose “is” or “is not” and pick a category.",
      );
    }
    return tSafe(
      "admin.collectionConditions.legacyCategoryText",
      "This older rule compares category names as text. Choose “is” or “is not” and pick a category; the rule then also covers every category below it.",
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {tSafe("admin.collectionConditions.title", "Collection Conditions")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Match Type */}
        <div className="space-y-2">
          <Label>{tSafe("admin.collectionConditions.matchLabel", "Products must match:")}</Label>
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
                {tSafe("admin.collectionConditions.matchAll", "All conditions")}
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
                {tSafe("admin.collectionConditions.matchAny", "Any condition")}
              </Label>
            </div>
          </div>
        </div>

        {/* Conditions */}
        <div className="space-y-3">
          {conditions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center border rounded-md">
              {tSafe(
                "admin.collectionConditions.empty",
                "No conditions added. Add a condition to automatically include products.",
              )}
            </p>
          ) : (
            conditions.map((condition, index) => {
              const kind = kindOf(condition.field);
              const operators = getOperatorsForField(condition.field);
              // A category rule saved before the picker may carry an
              // operator the picker no longer offers. It still works, so it
              // stays selected — marked as the older rule it is.
              const legacyOperator =
                kind === "category" && !operators.includes(condition.operator)
                  ? condition.operator
                  : null;
              const textValue =
                typeof condition.value === "string" ? condition.value : "";
              const textCategory =
                kind === "category" && !legacyOperator && textValue.trim() && !isStoredId(textValue)
                  ? textValue.trim()
                  : null;
              const matchedCategory =
                textCategory && categories ? categoryNamedBy(categories, textCategory) : undefined;
              const fieldLabel = tSafe("admin.collectionConditions.fieldLabel", "Field");
              const operatorFieldLabel = tSafe("admin.collectionConditions.operatorLabel", "Condition");
              const valueLabel = tSafe("admin.collectionConditions.valueLabel", "Value");

              return (
                <div
                  key={index}
                  className="flex flex-wrap items-end gap-2 p-3 border rounded-md bg-muted/30"
                >
                  {/* Field Select */}
                  <div className="flex-1 min-w-[150px]">
                    <Label className="text-xs text-muted-foreground">{fieldLabel}</Label>
                    <NativeSelect
                      aria-label={fieldLabel}
                      value={condition.field}
                      onChange={(event) =>
                        updateCondition(index, {
                          field: event.target.value as CollectionConditionField,
                        })
                      }
                    >
                      {fieldOptions.map((field) => (
                        <option key={field.value} value={field.value}>
                          {tSafe(`admin.collectionConditions.fields.${field.value}`, field.label)}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>

                  {/* Operator Select */}
                  <div className="flex-1 min-w-[150px]">
                    <Label className="text-xs text-muted-foreground">{operatorFieldLabel}</Label>
                    <NativeSelect
                      aria-label={operatorFieldLabel}
                      value={condition.operator}
                      onChange={(event) =>
                        updateCondition(index, {
                          operator: event.target.value as CollectionConditionOperator,
                        })
                      }
                    >
                      {operators.map((op) => (
                        <option key={op} value={op}>
                          {operatorLabel(tSafe, kind, op)}
                        </option>
                      ))}
                      {legacyOperator ? (
                        <option value={legacyOperator}>
                          {tFill(
                            "admin.collectionConditions.legacyOperator",
                            "{operator} (older rule)",
                            { operator: operatorLabel(tSafe, "string", legacyOperator) },
                          )}
                        </option>
                      ) : null}
                    </NativeSelect>
                  </div>

                  {/* Value Input */}
                  {needsValueInput(condition.operator) && (
                    <div className="flex-1 min-w-[150px]">
                      <Label className="text-xs text-muted-foreground">{valueLabel}</Label>
                      {kind === "vendor" &&
                      ((vendors?.length ?? 0) > 0 || isLoadingVendors) ? (
                        // Held disabled while the deferred list is in flight so
                        // the vendor row never briefly accepts free text.
                        <NativeSelect
                          aria-label={valueLabel}
                          disabled={isLoadingVendors}
                          value={textValue}
                          onChange={(event) =>
                            updateCondition(index, { value: event.target.value })
                          }
                        >
                          <option value="" disabled>
                            {isLoadingVendors
                              ? tSafe("admin.collectionConditions.loadingVendors", "Loading vendors…")
                              : tSafe("admin.collectionConditions.selectVendor", "Select vendor")}
                          </option>
                          {(vendors ?? []).map((v) => (
                            <option key={v._id} value={v._id}>
                              {v.storeName}
                            </option>
                          ))}
                        </NativeSelect>
                      ) : kind === "brand" ? (
                        <BrandSelect
                          value={isStoredId(textValue) ? textValue : ""}
                          onChange={(id) => updateCondition(index, { value: id })}
                          ariaLabel={valueLabel}
                        />
                      ) : kind === "category" && !legacyOperator ? (
                        <CategorySelect
                          value={
                            isStoredId(textValue)
                              ? textValue
                              : (matchedCategory?._id ?? "")
                          }
                          onChange={(id) => updateCondition(index, { value: id })}
                          ariaLabel={valueLabel}
                        />
                      ) : (
                        <Input
                          aria-label={valueLabel}
                          type={kind === "number" ? "number" : "text"}
                          value={condition.value as string}
                          onChange={(e) =>
                            updateCondition(index, {
                              value:
                                kind === "number"
                                  ? parseFloat(e.target.value) || 0
                                  : e.target.value,
                            })
                          }
                          placeholder={
                            kind === "number"
                              ? tSafe("admin.collectionConditions.enterNumber", "Enter number")
                              : tSafe("admin.collectionConditions.enterValue", "Enter value")
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
                    aria-label={tSafe("admin.collectionConditions.remove", "Remove condition")}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>

                  {kind === "category" && !legacyOperator ? (
                    <p className="w-full text-xs text-muted-foreground">
                      {tSafe(
                        "admin.collectionConditions.categoryBranchHint",
                        "A category takes in every category below it.",
                      )}
                    </p>
                  ) : null}
                  {legacyOperator ? <Attention>{legacyCategoryNote(legacyOperator)}</Attention> : null}
                  {textCategory && categories ? (
                    <Attention>
                      {matchedCategory
                        ? tFill(
                            "admin.collectionConditions.categoryTextMatched",
                            "Saved as the text “{value}”, which matches this category. Pick it again to store the category itself.",
                            { value: textCategory },
                          )
                        : tFill(
                            "admin.collectionConditions.categoryTextUnmatched",
                            "No category matches “{value}”, so this rule matches no products. Pick a category.",
                            { value: textCategory },
                          )}
                    </Attention>
                  ) : null}
                  {kind === "brand" &&
                  needsValueInput(condition.operator) &&
                  textValue.trim() &&
                  !isStoredId(textValue) ? (
                    <Attention>
                      {tFill(
                        "admin.collectionConditions.brandText",
                        "Saved as the text “{value}”. Pick the brand from the list.",
                        { value: textValue.trim() },
                      )}
                    </Attention>
                  ) : null}
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
          {tSafe("admin.collectionConditions.add", "Add condition")}
        </Button>
      </CardContent>
    </Card>
  );
}
