"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { Plus, X } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
}

export function OrganizationCard({
  form,
  categories,
  brands,
  availableCollections,
}: OrganizationCardProps) {
  const t = useTranslations();
  const [tagInput, setTagInput] = useState("");
  const [collectionSearchValue, setCollectionSearchValue] = useState("");
  const [showCollectionDropdown, setShowCollectionDropdown] = useState(false);

  const watchedCollectionIds =
    useWatch({ control: form.control, name: "collectionIds" }) || [];
  const watchedTags = useWatch({ control: form.control, name: "tags" }) || [];

  const handleAddTag = () => {
    const next = tagInput.trim();
    if (!next) return;
    const current = form.getValues("tags");
    if (!current.includes(next)) form.setValue("tags", [...current, next]);
    setTagInput("");
  };

  const handleRemoveTag = (tag: string) => {
    const current = form.getValues("tags");
    form.setValue(
      "tags",
      current.filter((t) => t !== tag),
    );
  };

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
                    noCategories: t(
                      "admin.productForm.noCategories",
                    ),
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
          <div className="flex gap-2">
            <Input
              placeholder={t(
                "admin.productForm.placeholders.addTag",
              )}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleAddTag}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {watchedTags.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="cursor-pointer"
                onClick={() => handleRemoveTag(tag)}
              >
                {tag}
                <X className="ml-1 h-3 w-3" />
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
