"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { CollectionProductSelector } from "@/components/admin/collection-product-selector";
import { CollectionCategorySelector } from "@/components/admin/collection-category-selector";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { cn } from "@/lib/utils";
import type { Field } from "@/lib/storefront/sections/types";
import {
  localizedDisplayValue,
  setLocalizedValue,
} from "./localized-value";
import {
  SectionImageField,
  type ImageFieldContext,
} from "./section-image-field";
import { CollectionSelect } from "./collection-select";
import { CouponSelect } from "./coupon-select";
import { ProductSelect } from "./product-select";
import { SliderSelect } from "./slider-select";
import {
  BackgroundSwatchField,
  editorBackground,
} from "@/components/admin/sliders/background-swatch";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

/** TipTap drags its whole toolchain in — load it when a richtext field opens. */
const RichTextEditor = dynamic(
  () =>
    import("@/components/ui/rich-text-editor").then(
      (mod) => mod.RichTextEditor,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-32 animate-pulse rounded-md bg-black/[0.06] dark:bg-white/[0.08]" aria-hidden />
    ),
  },
);

export function humanize(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The caption over a control. Sentence case in the foreground colour — the
 * tracked small-caps it replaces read as decoration and vanished against a
 * muted panel, which is the same call the Header Studio's panel made.
 */
export function FieldLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("text-xs font-semibold text-foreground", className)}>
      {children}
    </p>
  );
}

/**
 * How much of a row a control needs. Short controls — a number, a switch, a
 * dropdown, a swatch — share a row three abreast; a one-line text or a
 * picker takes half; anything that grows (copy, an image, a product list)
 * takes the whole row. Consecutive fields of one width form a grid, so the
 * inspector packs without ever putting a rich-text editor beside a toggle.
 */
type FieldWidth = "third" | "half" | "full";

function fieldWidth(field: Field): FieldWidth {
  if (field.width) return field.width;
  switch (field.type) {
    case "number":
    case "select":
    case "toggle":
    case "color":
    case "background":
    case "datetime":
      return "third";
    case "text":
    case "url":
    case "collection":
    case "product":
    case "slider":
    case "coupon":
      return "half";
    default:
      return "full";
  }
}

const WIDTH_GRID: Record<FieldWidth, string> = {
  third: "grid gap-4 sm:grid-cols-2 lg:grid-cols-3",
  half: "grid gap-4 sm:grid-cols-2",
  full: "grid gap-4",
};

interface FieldRendererProps {
  fields: Field[];
  settings: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  /** Storefront languages: locale tabs appear when there is more than one. */
  languages: string[];
  defaultLanguage: string;
  imageContext: ImageFieldContext;
}

/**
 * The generated inspector: renders every field of a section (or block)
 * schema with the matching control. This is the piece that replaces the
 * legacy builder's hand-written per-section editors.
 */
export function FieldRenderer({
  fields,
  settings,
  onChange,
  languages,
  defaultLanguage,
  imageContext,
}: FieldRendererProps) {
  const t = useTranslations();
  const tSafe = createTSafe(t);
  // AI image results carry alt text; it is only writable when this schema
  // actually declares an alt field — otherwise the write gate would drop
  // the key silently and the "generated alt" would be a lie.
  const hasAltField = fields.some((field) => field.key === "alt");

  // Group runs of same-width fields so each run lays out as one grid. A
  // field gated on a sibling's value drops out of the runs entirely, so the
  // grid closes up around it instead of leaving a hole.
  const runs: { width: FieldWidth; fields: Field[] }[] = [];
  for (const field of fields) {
    if (
      field.showWhen &&
      !field.showWhen.values.includes(
        settings[field.showWhen.key] as string | boolean,
      )
    ) {
      continue;
    }
    const width = fieldWidth(field);
    const last = runs[runs.length - 1];
    if (last && last.width === width) last.fields.push(field);
    else runs.push({ width, fields: [field] });
  }

  const renderField = (field: Field) => {
        const label = tSafe(
          `admin.storeBuilder.fields.${field.key}`,
          humanize(field.key),
        );
        // A hint only exists where the label cannot carry the meaning on its
        // own — which slot a pick lands in, say — so it is opt-in per field.
        // Scoped by section because the same field key carries a different
        // hint per section (`productIds` describes a different slot order in
        // each one), which a flat key would collapse into one wrong string.
        const hint = field.hint
          ? tSafe(
              `admin.storeBuilder.fieldHints.${imageContext.sectionType}.${field.key}`,
              field.hint,
            )
          : null;
        // Toggles carry their label inline; the list pickers draw their own
        // titled header, so a label above them would print the name twice.
        const ownsLabel =
          field.type === "toggle" ||
          field.type === "productList" ||
          field.type === "categoryList";
        return (
          <div
            key={field.key}
            className={cn(
              "min-w-0 space-y-1.5",
              // A toggle carries its label inline, so its cell has no label
              // line above it and would float to the top of the row. Pushing
              // it down lands it on the same line as the inputs beside it.
              field.type === "toggle" && "flex h-full flex-col justify-end",
            )}
          >
            {!ownsLabel ? <FieldLabel>{label}</FieldLabel> : null}
            {/* A labelled input keeps its hint UNDER the control: the
                label and the input then sit on the same lines as the fields
                beside them, and the hint reads as a footnote to what was
                typed. A picker draws its own header over a tall list, so
                its hint stays above, where it will be seen before the
                list is scrolled. */}
            {hint && ownsLabel ? (
              <p className="text-xs leading-snug text-muted-foreground">
                {hint}
              </p>
            ) : null}
            <FieldControl
              field={field}
              label={label}
              value={settings[field.key]}
              onChange={(value) => onChange(field.key, value)}
              onSiblingChange={onChange}
              hasAltField={hasAltField}
              languages={languages}
              defaultLanguage={defaultLanguage}
              imageContext={imageContext}
              tSafe={tSafe}
            />
            {hint && !ownsLabel ? (
              <p className="text-xs leading-snug text-muted-foreground">
                {hint}
              </p>
            ) : null}
          </div>
        );
  };

  return (
    <div className="space-y-4">
      {runs.map((run, index) => (
        <div key={index} className={WIDTH_GRID[run.width]}>
          {run.fields.map(renderField)}
        </div>
      ))}
    </div>
  );
}

function FieldControl({
  field,
  label,
  value,
  onChange,
  onSiblingChange,
  hasAltField,
  defaultLanguage,
  imageContext,
  tSafe,
}: {
  field: Field;
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  onSiblingChange: (key: string, value: unknown) => void;
  hasAltField: boolean;
  languages: string[];
  defaultLanguage: string;
  imageContext: ImageFieldContext;
  tSafe: ReturnType<typeof createTSafe>;
}) {
  switch (field.type) {
    case "text":
    case "textarea":
    case "richtext":
      return (
        <LocalizedTextControl
          kind={field.type}
          value={value}
          onChange={onChange}
          // Language tabs are hidden for now: every text field edits the
          // default language only. Stored translations stay untouched.
          languages={[defaultLanguage]}
          defaultLanguage={defaultLanguage}
        />
      );
    case "select":
      return (
        <NativeSelect
          value={String(value ?? field.default)}
          onChange={(event) => onChange(event.target.value)}
          className="w-full"
        >
          {field.options.map((option) => (
            <option key={option} value={option}>
              {tSafe(
                `admin.storeBuilder.options.${option}`,
                humanize(option),
              )}
            </option>
          ))}
        </NativeSelect>
      );
    case "number":
      return (
        <NumberControl
          value={typeof value === "number" ? value : field.default}
          min={field.min}
          max={field.max}
          fallback={field.default}
          onChange={onChange}
        />
      );
    case "toggle":
      return (
        <label className="flex h-9 items-center justify-between gap-4 rounded-md border border-border bg-card px-3">
          <span className="truncate text-xs font-semibold">{label}</span>
          <Switch
            checked={Boolean(value)}
            onCheckedChange={(checked) => onChange(checked)}
          />
        </label>
      );
    case "datetime":
      return (
        <DatetimeControl
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
        />
      );
    case "url":
      return (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder={tSafe(
            "admin.storeBuilder.linkPlaceholder",
            "/products or https://…",
          )}
        />
      );
    case "image":
      return (
        <SectionImageField
          value={typeof value === "string" ? value : ""}
          onChange={(url) => onChange(url)}
          onAltChange={
            hasAltField ? (alt) => onSiblingChange("alt", alt) : undefined
          }
          context={imageContext}
          uploadTitle={tSafe(
            "admin.storeBuilder.imageUploadTitle",
            "Drag and drop an image, or click to browse",
          )}
        />
      );
    case "collection":
      return (
        <CollectionSelect
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          placeholder={tSafe(
            "admin.storeBuilder.selectCollection",
            "Select a collection…",
          )}
        />
      );
    case "product":
      return (
        <ProductSelect
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          searchPlaceholder={tSafe(
            "admin.storeBuilder.searchProducts",
            "Search products…",
          )}
          clearLabel={tSafe("admin.storeBuilder.clearProduct", "Remove product")}
        />
      );
    case "color":
      return (
        <ColorControl
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          noneLabel={tSafe("admin.storeBuilder.noColor", "None")}
        />
      );
    case "productList":
      return (
        <CollectionProductSelector
          selectedProducts={Array.isArray(value) ? (value as string[]) : []}
          onChange={(ids) => onChange(ids)}
          title={label}
          max={field.max}
        />
      );
    case "categoryList":
      return (
        <CollectionCategorySelector
          selectedCategories={Array.isArray(value) ? (value as string[]) : []}
          onChange={(ids) => onChange(ids)}
          title={label}
        />
      );
    case "coupon":
      return (
        <CouponSelect
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          placeholder={tSafe(
            "admin.storeBuilder.selectCoupon",
            "Select a discount…",
          )}
          emptyLabel={tSafe(
            "admin.storeBuilder.noCoupons",
            "No active discounts yet",
          )}
        />
      );
    case "slider":
      return (
        <SliderSelect
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          locale={imageContext.locale}
          noneLabel={tSafe("admin.storeBuilder.noSlider", "No slider")}
          manageLabel={tSafe(
            "admin.storeBuilder.manageSliders",
            "Manage sliders",
          )}
        />
      );
    // Inline slides have no generic control — a bespoke studio (the
    // promotional-banner editor) owns them.
    case "slides":
      return null;
    case "background":
      return (
        <BackgroundSwatchField
          value={editorBackground(value)}
          onChange={onChange}
          label={label}
          clearLabel={tSafe("admin.storeBuilder.noColor", "None")}
          tSafe={tSafe}
          variant="button"
          className="w-44"
        />
      );
  }
}

/** Exported for the slider studio, which composes its own inspector. */
function LocalizedTextControl({
  kind,
  value,
  onChange,
  languages,
  defaultLanguage,
}: {
  kind: "text" | "textarea" | "richtext";
  value: unknown;
  onChange: (value: unknown) => void;
  languages: string[];
  defaultLanguage: string;
}) {
  const [activeLocale, setActiveLocale] = useState(defaultLanguage);
  const locale = languages.includes(activeLocale)
    ? activeLocale
    : defaultLanguage;
  const display = localizedDisplayValue(value, locale, defaultLanguage);
  const commit = (next: string) =>
    onChange(setLocalizedValue(value, locale, defaultLanguage, next));

  return (
    <div className="space-y-1.5">
      {languages.length > 1 ? (
        <div className="flex flex-wrap gap-1">
          {languages.map((language) => (
            <button
              key={language}
              type="button"
              onClick={() => setActiveLocale(language)}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase transition-colors",
                language === locale
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {language}
            </button>
          ))}
        </div>
      ) : null}

      {kind === "text" ? (
        <Input value={display} onChange={(e) => commit(e.target.value)} />
      ) : kind === "textarea" ? (
        <Textarea
          value={display}
          onChange={(e) => commit(e.target.value)}
          rows={3}
        />
      ) : (
        <RichTextEditor key={locale} value={display} onChange={commit} />
      )}
    </div>
  );
}

function ColorControl({
  value,
  onChange,
  noneLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  noneLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value || "#000000"}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-12 cursor-pointer rounded-md border border-border bg-card p-1"
        aria-label="Color"
      />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="#000000"
        className="w-28 font-mono text-xs"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {noneLabel}
        </button>
      ) : null}
    </div>
  );
}

function NumberControl({
  value,
  min,
  max,
  fallback,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  fallback: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useApplyOnChange([value], () => setDraft(String(value)));

  const commit = () => {
    const parsed = Number(draft);
    const next = Number.isFinite(parsed)
      ? Math.min(max, Math.max(min, Math.floor(parsed)))
      : fallback;
    setDraft(String(next));
    onChange(next);
  };

  return (
    <Input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

/** <input type=datetime-local> speaks local wall time; storage is ISO UTC.
 * Exported for the slider studio's countdown input. */
function DatetimeControl({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const toLocalInput = (iso: string) => {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  return (
    <Input
      type="datetime-local"
      value={toLocalInput(value)}
      onChange={(event) => {
        const raw = event.target.value;
        if (!raw) {
          onChange("");
          return;
        }
        const date = new Date(raw);
        onChange(Number.isNaN(date.getTime()) ? "" : date.toISOString());
      }}
    />
  );
}

/**
 * One captioned block of a section's inspector — "Settings", "Tabs (2)" —
 * so the fields and the block list read as two things rather than one
 * long form. The caption row is the only chrome: the content keeps its own
 * layout.
 */
export function EditorGroup({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count?: number;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 border-b pb-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {title}
          {count !== undefined ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {count}
            </span>
          ) : null}
        </h3>
        {hint ? (
          <span className="text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}
