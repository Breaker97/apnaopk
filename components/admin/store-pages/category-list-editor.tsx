"use client";

import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { NativeSelect } from "@/components/ui/native-select";
import { CollectionCategorySelector } from "@/components/admin/collection-category-selector";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { HomeFeaturedCategoriesClient } from "@/components/store/home-featured-categories-client";
import { ElectronicsCategoryScroller } from "@/components/store/sections/themes/electronics-category-scroller";
import { ElectronicsSectionHeading } from "@/components/store/sections/themes/electronics-section-heading";
import { apiClient } from "@/lib/api/client";
import type { Locale } from "@/config/i18n.config";
import { cn } from "@/lib/utils";
import type {
  NumberField,
  SectionCatalogEntry,
  SelectField,
} from "@/lib/storefront/sections/types";
import { VARIANT_FIELD_KEY } from "@/lib/storefront/sections/types";
import { FieldLabel, humanize } from "./field-renderer";
import { localizedDisplayValue, setLocalizedValue } from "./localized-value";
import { SectionThumbnail } from "./section-thumbnails";

interface CategoryOption {
  _id: string;
  name: string;
  slug: string;
  image?: string;
  parentId?: string | null;
  featured?: boolean;
  isActive?: boolean;
}

/**
 * The Category List section's bespoke inspector: a Template button that opens
 * the design picker as a dialog (instead of the inline thumbnail row), a live
 * preview rendered by the REAL storefront components with the store's actual
 * categories, and the content fields as plain default-language controls — no
 * locale tab strip.
 */
export function CategoryListEditor({
  entry,
  settings,
  onSettingChange,
  locale,
  defaultLanguage,
}: {
  entry: SectionCatalogEntry;
  settings: Record<string, unknown>;
  onSettingChange: (key: string, value: unknown) => void;
  locale: string;
  defaultLanguage: string;
}) {
  const t = useTranslations();
  const tSafe = createTSafe(t);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [categories, setCategories] = useState<CategoryOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      // Flat list, storefront sort order (order, name) — the same rows the
      // section's own query reads, so the preview selection mirrors it.
      .get<{ data?: CategoryOption[] } | CategoryOption[]>(
        "/api/categories?flat=true",
      )
      .then((payload) => {
        if (cancelled) return;
        setCategories(Array.isArray(payload) ? payload : (payload?.data ?? []));
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const variants = entry.variants ?? [];
  const storedVariant = settings[VARIANT_FIELD_KEY];
  const activeVariant = variants.some((v) => v.key === storedVariant)
    ? (storedVariant as string)
    : variants[0]?.key;
  const activeVariantName = variants.find((v) => v.key === activeVariant)?.name;

  const sourceField = entry.fields.find(
    (field): field is SelectField =>
      field.key === "source" && field.type === "select",
  );
  const limitField = entry.fields.find(
    (field): field is NumberField =>
      field.key === "limit" && field.type === "number",
  );

  const source = typeof settings.source === "string" ? settings.source : "featured";
  const limit =
    typeof settings.limit === "number" ? settings.limit : (limitField?.default ?? 8);
  const rawCategoryIds = settings.categoryIds;
  const categoryIds = useMemo(
    () => (Array.isArray(rawCategoryIds) ? (rawCategoryIds as string[]) : []),
    [rawCategoryIds],
  );
  const title = localizedDisplayValue(
    settings.title,
    defaultLanguage,
    defaultLanguage,
  );

  // Mirrors fetchFeaturedCategories' selection so the preview shows exactly
  // what the storefront will: manual keeps pick order, featured falls back
  // to top-level so the section is never empty, and only active categories
  // count (the admin API returns inactive ones too).
  const preview = useMemo(() => {
    if (!categories) return null;
    const active = categories.filter((category) => category.isActive !== false);
    let picked: CategoryOption[];
    if (source === "manual") {
      const byId = new Map(active.map((category) => [category._id, category]));
      picked = categoryIds
        .map((id) => byId.get(id))
        .filter((category): category is CategoryOption => Boolean(category));
    } else {
      const topLevel = active.filter((category) => !category.parentId);
      if (source === "topLevel") {
        picked = topLevel.slice(0, limit);
      } else {
        const featured = active.filter((category) => category.featured);
        picked = (featured.length > 0 ? featured : topLevel).slice(0, limit);
      }
    }
    return picked.map((category) => ({
      id: category._id,
      name: category.name,
      slug: category.slug,
      image: category.image,
    }));
  }, [categories, source, limit, categoryIds]);

  const label = (text: string) => <FieldLabel>{text}</FieldLabel>;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => setTemplateOpen(true)}
          className="rounded-full px-5 font-semibold"
        >
          {tSafe("admin.storeBuilder.sectionEditor.template", "Template")}
        </Button>
        {activeVariantName ? (
          <span className="truncate text-sm text-muted-foreground">
            {tSafe(
              `admin.storeBuilder.sections.${entry.type}.variants.${activeVariant}`,
              activeVariantName,
            )}
          </span>
        ) : null}
      </div>

      <div className="space-y-1.5">
        {label(tSafe("admin.storeBuilder.sectionEditor.preview", "Preview"))}
        {preview === null ? (
          <div className="h-40 animate-pulse rounded-md bg-black/[0.06] dark:bg-white/[0.08]" aria-hidden />
        ) : preview.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            {tSafe(
              "admin.storeBuilder.sectionEditor.noCategories",
              "No categories to show yet — publish some, mark them featured, or pick them by hand.",
            )}
          </div>
        ) : (
          /* The real storefront components with the store's real categories.
             Clicks are swallowed (their links lead to the storefront), but
             the rows still scroll and the arrows still work.
             `store-surface` re-scopes --background to the storefront's main
             background (pure white in light mode) so the preview sits on the
             same color the section will actually render over — the admin's
             own bg-background is a gray shell tone. */
          <div
            className="store-surface overflow-hidden rounded-md border border-border bg-background"
            onClickCapture={(event) => event.preventDefault()}
          >
            {activeVariant === "circles" ? (
              <div className="px-4 py-5">
                <ElectronicsSectionHeading title={title} className="mb-6" />
                <ElectronicsCategoryScroller
                  locale={locale as Locale}
                  categories={preview}
                />
              </div>
            ) : (
              <HomeFeaturedCategoriesClient
                locale={locale as Locale}
                title={title}
                categories={preview}
              />
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div className="space-y-1.5">
        {label(tSafe("admin.storeBuilder.fields.title", "Title"))}
        <Input
          value={title}
          onChange={(event) =>
            onSettingChange(
              "title",
              setLocalizedValue(
                settings.title,
                defaultLanguage,
                defaultLanguage,
                event.target.value,
              ),
            )
          }
        />
      </div>

      {sourceField ? (
        <div className="space-y-1.5">
          {label(tSafe("admin.storeBuilder.fields.source", "Source"))}
          <NativeSelect
            value={source}
            onChange={(event) => onSettingChange("source", event.target.value)}
            className="w-full"
          >
            {sourceField.options.map((option) => (
              <option key={option} value={option}>
                {tSafe(`admin.storeBuilder.options.${option}`, humanize(option))}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}

      {/* Hand-picked mode ignores the limit, and the other modes ignore the
          picks — each control shows only when it does something. */}
      {source !== "manual" && limitField ? (
        <div className="space-y-1.5">
          {label(tSafe("admin.storeBuilder.fields.limit", "Limit"))}
          <NumberInput
            min={limitField.min}
            max={limitField.max}
            step={1}
            value={limit}
            whenEmpty="keep"
            normalize={Math.trunc}
            onValueChange={(next) => {
              if (next !== undefined) onSettingChange("limit", next);
            }}
          />
        </div>
      ) : null}
      </div>

      {source === "manual" ? (
        <CollectionCategorySelector
          selectedCategories={categoryIds}
          onChange={(ids) => onSettingChange("categoryIds", ids)}
          title={tSafe("admin.storeBuilder.fields.categoryIds", "Categories")}
        />
      ) : null}

      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {tSafe("admin.storeBuilder.sectionEditor.template", "Template")}
            </DialogTitle>
          </DialogHeader>
          <div
            role="radiogroup"
            aria-label={tSafe(
              "admin.storeBuilder.sectionEditor.template",
              "Template",
            )}
            className="grid grid-cols-2 gap-3"
          >
            {variants.map((variant) => {
              const selected = variant.key === activeVariant;
              return (
                <button
                  key={variant.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    onSettingChange(VARIANT_FIELD_KEY, variant.key);
                    setTemplateOpen(false);
                  }}
                  className={cn(
                    "group relative overflow-hidden rounded-md border p-1.5 text-left transition-colors",
                    selected
                      ? "border-primary ring-1 ring-primary"
                      : "border-border hover:border-primary/50",
                  )}
                >
                  <span className="block overflow-hidden rounded-sm">
                    <SectionThumbnail type={`${entry.type}:${variant.key}`} />
                  </span>
                  <span className="mt-1.5 flex items-center gap-1 px-0.5">
                    {selected ? (
                      <Check className="h-3 w-3 shrink-0 text-primary" />
                    ) : null}
                    <span className="truncate text-xs font-medium">
                      {tSafe(
                        `admin.storeBuilder.sections.${entry.type}.variants.${variant.key}`,
                        variant.name,
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
