"use client";

import { useId } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColorSwatchPicker } from "@/components/admin/color-swatch-picker";
import { Input } from "@/components/ui/input";
import { UnitField } from "@/components/admin/unit-field";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { NativeSelect } from "@/components/ui/native-select";
import { OptionCardGroup } from "@/components/admin/online-store/option-card-group";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import {
  contrastRatio,
  normalizeColorToHex,
  toColorInputValue,
} from "@/lib/site-config/appearance-colors";
import { FONT_CATALOG, fontFamilyStack } from "@/lib/storefront/fonts/catalog";
import type { TokenField } from "@/lib/storefront/themes/tokens";
import { cn } from "@/lib/utils";
import {
  PageWidthDiagram,
} from "./layout-diagrams";

/**
 * One control per token kind, generated from the schema — the editor never
 * hand-builds a field. What each kind renders:
 *
 * - color:     swatch + hex + a reset to the field's own default
 * - length:    number input with unit + inline slider, limits from the schema
 * - font:      a trigger that shows the face in itself; list with samples
 * - select:    native select (many options — weights)
 * - segmented: segmented control (2–4 options)
 * - picture:   option cards (only where the picture is the meaning)
 */

function FieldRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/* ---------------- color ---------------- */

export function ColorControl({
  field,
  value,
  onChange,
  /** The color this role currently resolves to (for the swatch when ""). */
  resolved,
  /** The color this one is read against, for the AA badge. */
  against,
  minimum = 4.5,
  tSafe,
}: {
  field: TokenField;
  value: string;
  onChange: (value: string) => void;
  resolved: string;
  against?: string;
  minimum?: number;
  tSafe: TSafe;
}) {
  const id = useId();
  const swatch = normalizeColorToHex(value) ?? resolved;
  const inherited = value === "";
  const label = tSafe(`admin.themeEditor.colorRoles.${field.key}.label`, field.label);
  const ratio =
    against && normalizeColorToHex(swatch) && normalizeColorToHex(against)
      ? contrastRatio(swatch, against)
      : null;

  return (
    <FieldRow label={label} hint={tSafe(`admin.themeEditor.colorRoles.${field.key}.hint`,field.hint ?? "")} htmlFor={id}>
      <p className="text-[10px] text-muted-foreground">{inherited ? tSafe("admin.themeEditor.sourceAuto","Theme default / derived") : tSafe("admin.themeEditor.sourceCustom","Custom color")}</p>
      <div className="flex items-center gap-1.5">
        <ColorSwatchPicker
          ariaLabel={`${label} picker`}
          value={toColorInputValue(swatch, "#888888")}
          onChange={onChange}
          alpha={false}
        >
          <button
            type="button"
            aria-label={`${label} picker`}
            className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border"
            style={{ backgroundColor: swatch || "transparent" }}
          />
        </ColorSwatchPicker>
        {inherited ? (
          <button
            type="button"
            onClick={() => onChange(toColorInputValue(swatch, "#888888"))}
            className="flex h-8 min-w-0 flex-1 items-center rounded-md border border-dashed border-border px-2 text-left text-xs text-muted-foreground hover:border-foreground/40"
            title={tSafe("admin.themeEditor.setCustom", "Set a custom color")}
          >
            <span className="truncate">{field.inherit}</span>
          </button>
        ) : (
          <Input
            id={id}
            value={value}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => onChange(event.target.value)}
            onBlur={(event) => {
              const hex = normalizeColorToHex(event.target.value);
              if (hex && hex !== event.target.value) onChange(hex);
            }}
            className="h-8 min-w-0 flex-1 text-xs"
          />
        )}
        {!inherited && field.inherit ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8 shrink-0 text-muted-foreground"
            aria-label={field.inherit}
            title={field.inherit}
            onClick={() => onChange("")}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {ratio !== null ? (
          <span
            className={cn(
              "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold",
              ratio >= minimum
                ? "border-emerald-600/50 text-emerald-700 dark:text-emerald-400"
                : ratio >= 3
                  ? "border-amber-600/50 text-amber-700 dark:text-amber-400"
                  : "border-red-600/50 text-red-700 dark:text-red-400",
            )}
            title={tSafe("admin.themeEditor.contrastHint", "Contrast against its surface")}
          >
            {`${ratio.toFixed(2)}:1 · ${ratio >= minimum ? tSafe("admin.themeEditor.contrastPass","Pass") : tSafe("admin.themeEditor.contrastLow","Low")} (${minimum}:1)`}
          </span>
        ) : null}
      </div>
      {!inherited && !normalizeColorToHex(value) ? <p className="text-xs text-destructive">{tSafe("admin.themeEditor.invalidColor","Enter a valid hex or RGB color. Preview keeps the last valid color.")}</p> : null}
    </FieldRow>
  );
}

/* ---------------- length ---------------- */

export function LengthControl({
  field,
  value,
  onChange,
}: {
  field: TokenField;
  value: number | "";
  onChange: (value: number | "") => void;
}) {
  const id = useId();
  const inherited = value === "";
  const min = field.min ?? 0;
  const max = field.max ?? 100;
  const step = field.step ?? 1;

  return (
    <FieldRow label={field.label} hint={field.hint} htmlFor={id}>
      <div className="flex items-center gap-2">
        {inherited ? (
          <button
            type="button"
            onClick={() => onChange(min)}
            className="flex h-8 flex-1 items-center rounded-md border border-dashed border-border px-2 text-left text-xs text-muted-foreground hover:border-foreground/40"
          >
            {field.inherit}
          </button>
        ) : (
          <UnitField
            id={id}
            ariaLabel={field.label}
            value={Number(value)}
            unit={field.unit ?? ""}
            min={min}
            max={max}
            step={step}
            onChange={onChange}
            className="w-28"
          />
        )}
        {field.inherit && !inherited ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onChange("")}
            aria-label={field.inherit}
            title={field.inherit}
            className="shrink-0 text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    </FieldRow>
  );
}

/* ---------------- font ---------------- */

export function FontControl({
  field,
  value,
  onChange,
  tSafe,
}: {
  field: TokenField;
  value: string;
  onChange: (value: string) => void;
  tSafe: TSafe;
}) {
  const current = FONT_CATALOG.find((face) => face.id === value);
  return (
    <FieldRow label={field.label} hint={field.hint}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-background px-3 text-left text-sm hover:border-foreground/40"
            style={{ fontFamily: fontFamilyStack(value) }}
          >
            <span className={cn(!current && "text-muted-foreground")}>
              {current ? current.name : field.inherit}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-80 w-72 overflow-y-auto p-1">
          <button
            type="button"
            onClick={() => onChange("")}
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
          >
            {field.inherit}
            {value === "" ? <Check className="ml-auto h-3.5 w-3.5" /> : null}
          </button>
          {FONT_CATALOG.map((face) => (
            <button
              key={face.id}
              type="button"
              onClick={() => onChange(face.id)}
              className="flex w-full flex-col rounded-sm px-2 py-1.5 text-left hover:bg-muted"
            >
              <span className="flex items-center text-base leading-tight" style={{ fontFamily: fontFamilyStack(face.id) }}>
                {face.name}
                {value === face.id ? <Check className="ml-auto h-3.5 w-3.5" /> : null}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {tSafe(`admin.themeEditor.fonts.${face.id}`, face.note)}
              </span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </FieldRow>
  );
}

/* ---------------- select / segmented / picture ---------------- */

export function SelectControl({
  field,
  value,
  onChange,
}: {
  field: TokenField;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <FieldRow label={field.label} hint={field.hint} htmlFor={id}>
      <NativeSelect
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 text-xs"
      >
        {field.options?.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </FieldRow>
  );
}

export function SegmentedControl({
  field,
  value,
  onChange,
}: {
  field: TokenField;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FieldRow label={field.label} hint={field.hint}>
      <div role="radiogroup" className="flex rounded-md border border-border p-0.5">
        {field.options?.map((option) => {
          const selected = option.key === value;
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.key)}
              className={cn(
                "flex-1 rounded-sm px-2 py-1 text-xs transition-colors",
                selected
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </FieldRow>
  );
}

export function PictureControl({
  field,
  value,
  onChange,
}: {
  field: TokenField;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <OptionCardGroup
      label={field.label}
      hint={field.hint}
      value={value}
      onChange={onChange}
      columns="grid-cols-2 sm:grid-cols-3"
      options={(field.options ?? []).map((option) => ({
        key: option.key,
        label: option.label,
        diagram: <PageWidthDiagram kind={option.key} />,
      }))}
    />
  );
}

