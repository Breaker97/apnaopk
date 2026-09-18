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
import { PanelGroup, PanelRow } from "./editor-shell";
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

/**
 * A control that fits a narrow property panel beside a preview, the way
 * the slider editor keeps its numbers, switches and swatches beside the
 * canvas: the short ones, and a one-line text or link, which stacks under
 * its name. Only what grows — a paragraph, a picture, a list of picks —
 * goes under the preview, unless the schema asked for the whole row.
 */
const PANEL_TYPES = new Set<Field["type"]>([
  "number",
  "select",
  "toggle",
  "color",
  "background",
  "datetime",
  "text",
  "url",
  "slider",
  "collection",
  "coupon",
]);
/**
 * Whether a field shows right now: fields gated on a sibling's value
 * (`showWhen`) drop out while that value says so. The renderer and the
 * editors deciding whether a group has anything to show read the same rule,
 * so a group is never drawn around fields that are all hidden.
 */
export function isFieldShown(field: Field, settings: Record<string, unknown>): boolean {
  if (!field.showWhen) return true;
  return field.showWhen.values.includes(
    settings[field.showWhen.key] as string | boolean,
  );
}

export function isCompactField(field: Field): boolean {
  // The grid width is a hint for the wide area's rows; only "full" says
  // a control wants the whole row wherever it goes.
  if (field.width === "full") return false;
  return PANEL_TYPES.has(field.type);
}

/**
 * The panel's groups, in order: how the block is laid out, how it is
 * painted, what it shows or hides. Read off the field's type and key — the
 * schemas name their fields plainly (`cardRadius`, `titleSize`,
 * `showBadge`), so the key says which group a control belongs in.
 */
type PanelGroupKey = "content" | "layout" | "style" | "visibility";
/**
 * Fields named alike — `coverWidth`, `coverText`, `coverHeight`… — are
 * one thing's settings, and read as one group named for it, wherever their
 * types would otherwise have sent them. Three or more make a group; fewer
 * fall to the type groups. Switches keep to Show & hide.
 */
function keyPrefix(key: string): string {
  const match = key.match(/^[a-z]+/);
  return match ? match[0] : key;
}
function prefixGroups(fields: Field[]): Map<string, Field[]> {
  const byPrefix = new Map<string, Field[]>();
  for (const field of fields) {
    if (field.type === "toggle") continue;
    const prefix = keyPrefix(field.key);
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), field]);
  }
  for (const [prefix, list] of byPrefix) {
    if (list.length < 3) byPrefix.delete(prefix);
  }
  return byPrefix;
}
const STYLE_KEY =
  /radius|corner|colou?r|shadow|border|background|fill|font|weight|case|size|overlay|darken|tint|opacity|shape|style|corners/i;
/**
 * Keys that decide WHAT a section shows rather than how it looks: where its
 * products come from, how many, in what order. A merchant reads those as
 * the section's content, and they are what gets reached for first; filed
 * under Layout as the dropdowns and numbers they are, they sat in a folded
 * group while the Content group opened on a title.
 */
const CONTENT_KEY = /^(source|limit|sort|sortBy|count|max)$|(Source|Limit|Ids?)$/;

function panelGroupOf(field: Field): PanelGroupKey {
  if (
    field.type === "text" ||
    field.type === "url" ||
    field.type === "slider" ||
    field.type === "collection" ||
    field.type === "coupon" ||
    CONTENT_KEY.test(field.key)
  ) {
    return "content";
  }
  if (field.type === "toggle") return "visibility";
  if (field.type === "color" || field.type === "background") return "style";
  if (STYLE_KEY.test(field.key)) return "style";
  return "layout";
}
/** The short controls that sit beside their name on one line. */
function inlineInPanel(field: Field): boolean {
  return (
    field.type === "select" ||
    field.type === "number" ||
    field.type === "toggle" ||
    field.type === "color"
  );
}

interface FieldRendererProps {
  fields: Field[];
  settings: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  /**
   * "grid" packs runs of same-width fields abreast; "panel" stacks every
   * field in one column, for a narrow property panel beside a preview.
   */
  layout?: "grid" | "panel";
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
  layout = "grid",
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
    if (!isFieldShown(field, settings)) continue;
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
        if (layout === "panel") {
          const inline = inlineInPanel(field);
          return (
            <PanelRow key={field.key} label={label} hint={hint ?? undefined} stacked={!inline}>
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
                compact={inline}
              />
            </PanelRow>
          );
        }
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

  if (layout === "panel") {
    // Grouped, and folded past the first group once there is a lot: the
    // merchant meets the layout first and opens the paint when they want it.
    const visible = runs.flatMap((run) => run.fields);
    const named = prefixGroups(visible);
    const namedFields = new Set([...named.values()].flat());
    const GROUP_NAMES: Record<PanelGroupKey, string> = {
      content: tSafe("admin.storeBuilder.panelGroups.content", "Content"),
      layout: tSafe("admin.storeBuilder.panelGroups.layout", "Layout"),
      style: tSafe("admin.storeBuilder.panelGroups.style", "Style"),
      visibility: tSafe("admin.storeBuilder.panelGroups.visibility", "Show & hide"),
    };
    const typed = (key: PanelGroupKey) => ({
      key,
      title: GROUP_NAMES[key],
      folds: key === "style" || key === "visibility",
      fields: visible.filter((field) => !namedFields.has(field) && panelGroupOf(field) === key),
    });
    // Words and layout first, then each named thing, then paint and switches.
    const groups = [
      typed("content"),
      typed("layout"),
      ...[...named].map(([prefix, fields]) => ({
        key: `prefix:${prefix}`,
        title: tSafe(`admin.storeBuilder.panelGroups.${prefix}`, humanize(prefix)),
        folds: false,
        fields,
      })),
      typed("style"),
      typed("visibility"),
    ].filter((group) => group.fields.length > 0);
    return (
      <>
        {groups.map((group) => (
          <PanelGroup
            key={group.key}
            title={group.title}
            defaultOpen={!group.folds || visible.length <= 6}
          >
            {group.fields.map(renderField)}
          </PanelGroup>
        ))}
      </>
    );
  }

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
  compact = false,
}: {
  field: Field;
  label: string;
  /** Sized to sit beside its name in a panel row. */
  compact?: boolean;
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
          className={compact ? "h-8 w-36 text-xs" : "w-full"}
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
          className={compact ? "h-8 w-24 text-xs" : undefined}
        />
      );
    case "toggle":
      // In a panel row the name is already on the left; the switch alone.
      if (compact) {
        return (
          <Switch
            checked={Boolean(value)}
            onCheckedChange={(checked) => onChange(checked)}
            aria-label={label}
          />
        );
      }
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
          compact={compact}
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
          // A video only where the section actually plays one.
          modes={
            field.video
              ? (["solid", "gradient", "image", "video"] as const)
              : undefined
          }
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
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  noneLabel: string;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value || "#000000"}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "cursor-pointer rounded-md border border-border bg-card p-1",
          compact ? "h-8 w-9" : "h-9 w-12",
        )}
        aria-label="Color"
      />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="#000000"
        className={cn("font-mono text-xs", compact ? "h-8 w-24" : "w-28")}
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
  className,
}: {
  value: number;
  min: number;
  max: number;
  fallback: number;
  onChange: (value: number) => void;
  className?: string;
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
      className={className}
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
