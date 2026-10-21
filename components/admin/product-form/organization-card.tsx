"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Badge } from "@/components/ui/badge";
import { TagInput } from "@/components/ui/tag-input";
import { Separator } from "@/components/ui/separator";
import { CategoryPicker } from "@/components/admin/product-form/category-picker";
import type {
  Brand,
  Category,
  CollectionOption,
  ProductFormData,
} from "@/components/admin/product-form/schema";

// Sentinel for "no brand" — SearchableSelect has no empty-value option, so the
// clear choice rides along as a regular option and maps back to "".
const NO_BRAND = "none";

interface OrganizationCardProps {
  form: UseFormReturn<ProductFormData>;
  categories: Category[];
  brands: Brand[];
  availableCollections: CollectionOption[];
  /**
   * Whether `categories` is an answer. Only a "ready" empty list means the
   * store has no categories; while loading, or after the list failed to
   * load, "create a category first" would send the merchant off to make one
   * they already have.
   */
  categoriesState?: "loading" | "unavailable" | "ready";
}

export function OrganizationCard({
  form,
  categories,
  brands,
  availableCollections,
  categoriesState = "ready",
}: OrganizationCardProps) {
  const t = useTranslations();
  const [collectionSearchValue, setCollectionSearchValue] = useState("");
  const [showCollectionDropdown, setShowCollectionDropdown] = useState(false);

  const watchedCollectionIds =
    useWatch({ control: form.control, name: "collectionIds" }) || [];
  const watchedTags = useWatch({ control: form.control, name: "tags" }) || [];

  const handleToggleCollectionId = (collectionId: string) => {
    const currentIds = form.getValues("collectionIds");
    form.setValue(
      "collectionIds",
      currentIds.includes(collectionId)
        ? currentIds.filter((id) => id !== collectionId)
        : [...currentIds, collectionId],
    );
    setShowCollectionDropdown(false);
    setCollectionSearchValue("");
  };

  const handleRemoveCollectionId = (collectionId: string) => {
    const currentIds = form.getValues("collectionIds");
    form.setValue(
      "collectionIds",
      currentIds.filter((id) => id !== collectionId),
    );
  };

  const filteredCollections = availableCollections.filter((col) => {
    const selectedIds = form.getValues("collectionIds");
    if (selectedIds.includes(col._id)) return false;
    if (!collectionSearchValue.trim()) return true;
    return col.title
      .toLowerCase()
      .includes(collectionSearchValue.toLowerCase());
  });

  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle>
          {t("admin.productForm.sections.organization")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t("admin.productForm.fields.category")}{" "}
                *
              </FormLabel>
              <FormControl>
                <CategoryPicker
                  categories={categories}
                  value={field.value}
                  onChange={field.onChange}
                  labels={{
                    selectCategory: t(
                      "admin.productForm.placeholders.category",
                    ),
                    searchCategories: t(
                      "admin.productForm.placeholders.searchCategories",
                    ),
                    clear: t("common.clear"),
                    noCategories:
                      categoriesState === "loading"
                        ? t("admin.productForm.formOptions.loadingCategories")
                        : categoriesState === "unavailable"
                          ? t("admin.productForm.formOptions.categoriesUnavailable")
                          : t("admin.productForm.noCategories"),
                    noMatches: t(
                      "admin.productForm.noCategoryMatches",
                      {
                        query: "{query}",
                      },
                    ),
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="brand"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t("admin.productForm.fields.brand")}
              </FormLabel>
              <FormControl>
                <SearchableSelect
                  options={[
                    {
                      value: NO_BRAND,
                      label: t("admin.productForm.noBrand"),
                    },
                    ...brands.map((brand) => ({
                      value: brand._id,
                      label: brand.name,
                    })),
                  ]}
                  value={field.value || NO_BRAND}
                  onValueChange={(value) =>
                    field.onChange(value === NO_BRAND ? "" : value)
                  }
                  placeholder={t(
                    "admin.productForm.placeholders.brand",
                  )}
                  searchPlaceholder={t(
                    "admin.productForm.placeholders.searchBrands",
                  )}
                  emptyText={t("common.noResults")}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="productType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t("admin.productForm.fields.type")}
              </FormLabel>
              <FormControl>
                <Input
                  placeholder={t("admin.productForm.fields.type")}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="space-y-2">
          <FormLabel>
            {t("admin.productForm.fields.collections")}
          </FormLabel>
          <div
            className="relative"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) {
                setTimeout(() => setShowCollectionDropdown(false), 150);
              }
            }}
          >
            <Input
              placeholder={t(
                "admin.productForm.placeholders.searchCollections",
              )}
              value={collectionSearchValue}
              onChange={(e) => {
                setCollectionSearchValue(e.target.value);
                setShowCollectionDropdown(true);
              }}
              onFocus={() => setShowCollectionDropdown(true)}
            />
            {showCollectionDropdown &&
              filteredCollections.length > 0 && (
                <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
                  {filteredCollections.map((col) => (
                    <button
                      key={col._id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                      onClick={() => handleToggleCollectionId(col._id)}
                    >
                      {col.title}
                    </button>
                  ))}
                </div>
              )}
            {showCollectionDropdown &&
              filteredCollections.length === 0 && (
                <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    {availableCollections.length === 0
                      ? t("admin.productForm.noCollections")
                      : t("admin.productForm.noCollectionMatches")}
                  </div>
                </div>
              )}
          </div>
          {/* Selected collections */}
          <div className="flex flex-wrap gap-2 mt-2">
            {watchedCollectionIds.map((id) => {
              const col = availableCollections.find(
                (c) => c._id === id,
              );
              return (
                <Badge
                  key={id}
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => handleRemoveCollectionId(id)}
                >
                  {col?.title || id}
                  <X className="ml-1 h-3 w-3" />
                </Badge>
              );
            })}
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <FormLabel>
            {t("admin.productForm.fields.tags")}
          </FormLabel>
          <TagInput
            value={watchedTags}
            onValueChange={(tags) => form.setValue("tags", tags)}
            placeholder={t("admin.productForm.placeholders.addTag")}
            aria-label={t("admin.productForm.fields.tags")}
          />
        </div>
      </CardContent>
    </Card>
  );
}
