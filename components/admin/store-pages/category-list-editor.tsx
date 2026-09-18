"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { CollectionCategorySelector } from "@/components/admin/collection-category-selector";
import { EditorShell, PanelGroup } from "./editor-shell";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { CategoryTiles } from "@/components/store/sections/category-tiles";
import { apiClient } from "@/lib/api/client";
import type { Locale } from "@/config/i18n.config";
import {
  CATEGORY_ARROW_POSITIONS,
  CATEGORY_ARROW_STYLES,
  CATEGORY_HOVERS,
  CATEGORY_IMAGE_FITS,
  CATEGORY_LAYOUTS,
  CATEGORY_LINK_TARGETS,
  CATEGORY_MOBILE_LAYOUTS,
  CATEGORY_PLACEHOLDERS,
  CATEGORY_ROW_ALIGNS,
  CATEGORY_SHAPES,
  CATEGORY_STYLE_LIMITS,
  CATEGORY_TEXT_ALIGNS,
  CATEGORY_TEXT_CASES,
  CATEGORY_TEXT_POSITIONS,
  CATEGORY_TEXT_VERTICALS,
  CATEGORY_TEXT_WEIGHTS,
  CATEGORY_TITLE_ALIGNS,
  CATEGORY_TITLE_STYLES,
  categoryRowScrolls,
  hasCategoryListStyleOverrides,
  readCategoryListStyle,
  serializeCategoryListStyle,
  type CategoryListStyle,
} from "@/lib/storefront/sections/category-list-style";
import { cn } from "@/lib/utils";
import type {
  NumberField,
  SectionCatalogEntry,
  SelectField,
} from "@/lib/storefront/sections/types";
import { VARIANT_FIELD_KEY } from "@/lib/storefront/sections/types";
import { FieldLabel, humanize } from "./field-renderer";
import { localizedDisplayValue, setLocalizedValue } from "./localized-value";
import { ColorRow, SliderRow } from "./product-main-editor";
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

/** Theme tokens a tile or text colour may bind to instead of a fixed hex. */
const COLOR_TOKENS = [
  { key: "muted", label: "Muted", value: "var(--muted)" },
  { key: "card", label: "Card", value: "var(--card)" },
  { key: "primary", label: "Theme primary", value: "var(--primary)" },
  { key: "foreground", label: "Text", value: "var(--foreground)" },
] as const;

/**
 * The Category List section's bespoke inspector: a Template button that opens
 * the design picker as a dialog (instead of the inline thumbnail row), a live
 * preview rendered by the REAL storefront renderer with the store's actual
 * categories, the content fields as plain default-language controls — no
 * locale tab strip — and a Style panel that adjusts any part of the design
 * the template started from.
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

  const style = useMemo(
    () => readCategoryListStyle(settings.style, activeVariant),
    [settings.style, activeVariant],
  );
  const customized = hasCategoryListStyleOverrides(settings.style);
  const patchStyle = (patch: Partial<CategoryListStyle>) =>
    onSettingChange(
      "style",
      serializeCategoryListStyle({ ...style, ...patch }, activeVariant),
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
  const ts = (key: string, fallback: string) =>
    tSafe(`admin.storeBuilder.categoryStyle.${key}`, fallback);
  const optionLabel = (option: string) =>
    tSafe(`admin.storeBuilder.categoryStyle.options.${option}`, humanize(option));
  const choices = <T extends string>(options: readonly T[]) =>
    options.map((option) => ({ key: option, label: optionLabel(option) }));

  const scrolls = categoryRowScrolls(style, preview?.length ?? style.columns + 1);
  const over = style.textPosition === "over";
  const limits = CATEGORY_STYLE_LIMITS;

  return (
    <div className="space-y-5">
      <EditorShell
        preview={
          <div className="space-y-3">
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
          /* The real storefront renderer with the store's real categories
             and the style being edited, so every control shows its effect.
             Clicks are swallowed (their links lead to the storefront), but
             the rows still scroll and the arrows still work.
             `store-surface` re-scopes --background to the storefront's main
             background (pure white in light mode) so the preview sits on the
             same color the section will actually render over — the admin's
             own bg-background is a gray shell tone. */
          <div
            className="store-surface overflow-hidden rounded-md border border-border bg-background px-4 py-5"
            onClickCapture={(event) => event.preventDefault()}
          >
            <CategoryTiles
              locale={locale as Locale}
              categories={preview}
              style={style}
              title={title}
            />
          </div>
        )}
      </div>

          </div>
        }
        panel={
          <>
      {/* Style: the template's design, control by control. Only what the
          merchant changes is stored, so the template stays the baseline. */}
      <div className="space-y-2">
        <div className="flex h-7 items-center justify-between gap-3 px-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{ts("title", "Style")}</h3>
          {customized ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => onSettingChange("style", "")}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {ts("reset", "Reset to template")}
            </Button>
          ) : null}
        </div>

        <StyleGroup title={ts("layout", "Layout")}>
            <SelectRow
              label={ts("rowLayout", "Row")}
              value={style.layout}
              options={choices(CATEGORY_LAYOUTS)}
              onChange={(layout) => patchStyle({ layout })}
            />
            <SliderRow
              label={ts("columns", "Tiles per row")}
              value={style.columns}
              min={limits.columns.min}
              max={limits.columns.max}
              unit=""
              onChange={(columns) => patchStyle({ columns })}
            />
            <SliderRow
              label={ts("tabletColumns", "Tiles per row (tablet)")}
              value={style.tabletColumns}
              min={limits.tabletColumns.min}
              max={limits.tabletColumns.max}
              unit=""
              onChange={(tabletColumns) => patchStyle({ tabletColumns })}
            />
            <SelectRow
              label={ts("rowAlign", "Row alignment")}
              value={style.align}
              options={choices(CATEGORY_ROW_ALIGNS)}
              onChange={(align) => patchStyle({ align })}
            />
            <SelectRow
              label={ts("mobileLayout", "Phones")}
              value={style.mobileLayout}
              options={choices(CATEGORY_MOBILE_LAYOUTS)}
              onChange={(mobileLayout) => patchStyle({ mobileLayout })}
            />
            <SliderRow
              label={ts("mobileColumns", "Tiles across (phone)")}
              value={style.mobileColumns}
              min={limits.mobileColumns.min}
              max={limits.mobileColumns.max}
              unit=""
              onChange={(mobileColumns) => patchStyle({ mobileColumns })}
            />
            <SliderRow
              label={ts("gap", "Gap between tiles")}
              value={style.gap}
              max={limits.gap.max}
              onChange={(gap) => patchStyle({ gap })}
            />
            <SliderRow
              label={ts("mobileGap", "Gap (phone)")}
              value={style.mobileGap}
              max={limits.mobileGap.max}
              onChange={(mobileGap) => patchStyle({ mobileGap })}
            />
          </StyleGroup>

          <StyleGroup title={ts("tile", "Tile")}>
            <SelectRow
              label={ts("shape", "Shape")}
              value={style.shape}
              options={choices(CATEGORY_SHAPES)}
              onChange={(shape) => patchStyle({ shape })}
            />
            {style.shape !== "circle" ? (
              <SliderRow
                label={ts("roundness", "Corner radius")}
                value={style.roundness}
                max={limits.roundness.max}
                onChange={(roundness) => patchStyle({ roundness })}
              />
            ) : null}
            {scrolls ? (
              <SliderRow
                label={ts("tileWidth", "Tile width")}
                value={style.tileWidth}
                max={limits.tileWidth.max}
                zeroLabel={ts("auto", "Auto")}
                onChange={(tileWidth) => patchStyle({ tileWidth })}
              />
            ) : null}
            <SliderRow
              label={ts("tileHeight", "Tile height")}
              value={style.tileHeight}
              max={limits.tileHeight.max}
              zeroLabel={ts("fromShape", "Shape")}
              onChange={(tileHeight) => patchStyle({ tileHeight })}
            />
            <ColorRow
              label={ts("tileBackground", "Background")}
              value={style.tileBackground}
              tokens={COLOR_TOKENS}
              onChange={(tileBackground) => patchStyle({ tileBackground })}
            />
            <ColorRow
              label={ts("tileBorder", "Border")}
              value={style.tileBorder}
              tokens={COLOR_TOKENS}
              onChange={(tileBorder) => patchStyle({ tileBorder })}
            />
            {style.tileBorder ? (
              <SliderRow
                label={ts("tileBorderWidth", "Border thickness")}
                value={style.tileBorderWidth}
                max={limits.tileBorderWidth.max}
                onChange={(tileBorderWidth) => patchStyle({ tileBorderWidth })}
              />
            ) : null}
            <SliderRow
              label={ts("tileShadow", "Shadow")}
              value={style.tileShadow}
              max={limits.tileShadow.max}
              zeroLabel={ts("none", "None")}
              onChange={(tileShadow) => patchStyle({ tileShadow })}
            />
          </StyleGroup>

          <StyleGroup title={ts("image", "Image")} defaultOpen={false}>
            <SelectRow
              label={ts("imageFit", "Fit")}
              value={style.imageFit}
              options={choices(CATEGORY_IMAGE_FITS)}
              onChange={(imageFit) => patchStyle({ imageFit })}
            />
            {style.imageFit === "contain" ? (
              <SliderRow
                label={ts("imagePadding", "Padding")}
                value={style.imagePadding}
                max={limits.imagePadding.max}
                onChange={(imagePadding) => patchStyle({ imagePadding })}
              />
            ) : null}
            <SelectRow
              label={ts("placeholder", "No image")}
              value={style.placeholder}
              options={choices(CATEGORY_PLACEHOLDERS)}
              onChange={(placeholder) => patchStyle({ placeholder })}
            />
            <SelectRow
              label={ts("hover", "Hover effect")}
              value={style.hover}
              options={choices(CATEGORY_HOVERS)}
              onChange={(hover) => patchStyle({ hover })}
            />
            <SelectRow
              label={ts("linkTo", "Tile opens")}
              value={style.linkTo}
              options={choices(CATEGORY_LINK_TARGETS)}
              onChange={(linkTo) => patchStyle({ linkTo })}
            />
          </StyleGroup>

          <StyleGroup title={ts("text", "Text")} defaultOpen={false}>
            <ToggleRow
              label={ts("showText", "Show name")}
              checked={style.showText}
              onChange={(showText) => patchStyle({ showText })}
            />
            {style.showText ? (
              <>
                <SelectRow
                  label={ts("textPosition", "Position")}
                  value={style.textPosition}
                  options={choices(CATEGORY_TEXT_POSITIONS)}
                  onChange={(textPosition) => patchStyle({ textPosition })}
                />
                <SelectRow
                  label={ts("textAlign", "Align")}
                  value={style.textAlign}
                  options={choices(CATEGORY_TEXT_ALIGNS)}
                  onChange={(textAlign) => patchStyle({ textAlign })}
                />
                {over ? (
                  <SelectRow
                    label={ts("textVertical", "Vertical position")}
                    value={style.textVertical}
                    options={choices(CATEGORY_TEXT_VERTICALS)}
                    onChange={(textVertical) => patchStyle({ textVertical })}
                  />
                ) : null}
                <SliderRow
                  label={ts("textSize", "Size")}
                  value={style.textSize}
                  min={limits.textSize.min}
                  max={limits.textSize.max}
                  onChange={(textSize) => patchStyle({ textSize })}
                />
                <SelectRow
                  label={ts("textWeight", "Weight")}
                  value={style.textWeight}
                  options={choices(CATEGORY_TEXT_WEIGHTS)}
                  onChange={(textWeight) => patchStyle({ textWeight })}
                />
                <SelectRow
                  label={ts("textCase", "Case")}
                  value={style.textCase}
                  options={choices(CATEGORY_TEXT_CASES)}
                  onChange={(textCase) => patchStyle({ textCase })}
                />
                <ColorRow
                  label={ts("textColor", "Colour")}
                  value={style.textColor}
                  fallback={over ? "#ffffff" : undefined}
                  tokens={COLOR_TOKENS}
                  onChange={(textColor) => patchStyle({ textColor })}
                />
                <SliderRow
                  label={over ? ts("textInset", "Inset") : ts("textGap", "Space from tile")}
                  value={style.textGap}
                  max={limits.textGap.max}
                  onChange={(textGap) => patchStyle({ textGap })}
                />
                {over ? (
                  <SliderRow
                    label={ts("overlay", "Darken picture")}
                    value={style.overlay}
                    max={limits.overlay.max}
                    unit="%"
                    onChange={(overlay) => patchStyle({ overlay })}
                  />
                ) : null}
              </>
            ) : null}
          </StyleGroup>

          <StyleGroup title={ts("heading", "Heading")} defaultOpen={false}>
            <SelectRow
              label={ts("titleStyle", "Style")}
              value={style.titleStyle}
              options={choices(CATEGORY_TITLE_STYLES)}
              onChange={(titleStyle) => patchStyle({ titleStyle })}
            />
            <SelectRow
              label={ts("titleAlign", "Align")}
              value={style.titleAlign}
              options={choices(CATEGORY_TITLE_ALIGNS)}
              onChange={(titleAlign) => patchStyle({ titleAlign })}
            />
          </StyleGroup>

          <StyleGroup
            defaultOpen={false}
            title={ts("arrows", "Arrows")}
            hint={scrolls ? undefined : ts("arrowsHint", "Shown when the row scrolls.")}
          >
            <SelectRow
              label={ts("arrowStyle", "Style")}
              value={style.arrows}
              options={choices(CATEGORY_ARROW_STYLES)}
              onChange={(arrows) => patchStyle({ arrows })}
            />
            {style.arrows !== "hidden" ? (
              <>
                <SelectRow
                  label={ts("arrowPosition", "Position")}
                  value={style.arrowPosition}
                  options={choices(CATEGORY_ARROW_POSITIONS)}
                  onChange={(arrowPosition) => patchStyle({ arrowPosition })}
                />
                <SliderRow
                  label={ts("arrowSize", "Size")}
                  value={style.arrowSize}
                  min={limits.arrowSize.min}
                  max={limits.arrowSize.max}
                  onChange={(arrowSize) => patchStyle({ arrowSize })}
                />
              </>
            ) : null}
          </StyleGroup>
      </div>

          </>
        }
      >
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

      </EditorShell>

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
                    // A template is a whole design: switching to one starts
                    // from it, not from the last design's adjustments.
                    onSettingChange("style", "");
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

function StyleGroup({
  title,
  hint,
  defaultOpen = true,
  children,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <PanelGroup title={title} hint={hint} defaultOpen={defaultOpen}>
      {children}
    </PanelGroup>
  );
}

function SelectRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { key: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <NativeSelect
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-8 w-40 shrink-0 text-xs"
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <span className="text-sm text-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}
