"use client";

import { useId, type ReactNode } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Type,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { BackgroundSwatchField } from "@/components/admin/sliders/background-swatch";
import {
  NumberInput,
  ScrubHandle,
  UnitField,
} from "@/components/admin/unit-field";
import {
  HEADER_ALIGNMENTS,
  HEADER_TEXT_TRANSFORMS,
  type HeaderAlign,
  type HeaderAlignment,
  type HeaderFill,
  type HeaderPadding,
  type HeaderTextStyle,
} from "@/lib/site-config/header-layout";
import { STUDIO_CONTROL_RADIUS } from "@/components/admin/online-store/header-studio/layout-style";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import { cn } from "@/lib/utils";

/**
 * The property-panel widgets, one per Figma control. They are deliberately
 * dumb: every one takes a value and reports a new one, so the studio's
 * reducer stays the only place layout state changes.
 */

export function PanelRow({
  label,
  children,
  align = "center",
}: {
  label: string;
  children: ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(72px,1fr)_minmax(0,1.6fr)] gap-3",
        align === "center" ? "items-center" : "items-start",
      )}
    >
      <span className="text-xs font-medium text-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// The numeric control lives in components/admin/unit-field.tsx now, shared
// with every other builder; re-exported so the property panel keeps its
// import.
export { UnitField };

/** Matches the layout normalizer's padding ceiling. */
const MAX_PADDING = 120;

const PADDING_SIDES: { key: keyof HeaderPadding; icon: LucideIcon }[] = [
  { key: "top", icon: PanelTop },
  { key: "right", icon: PanelRight },
  { key: "bottom", icon: PanelBottom },
  { key: "left", icon: PanelLeft },
];

export function PaddingField({
  value,
  onChange,
  labels,
}: {
  value: HeaderPadding;
  onChange: (value: HeaderPadding) => void;
  labels: Record<keyof HeaderPadding, string>;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {PADDING_SIDES.map(({ key, icon: Icon }) => (
        <div
          key={key}
          className="flex h-8 items-center gap-1 rounded-[4px] border bg-background pl-2 pr-0.5 focus-within:ring-[3px] focus-within:ring-ring/50"
        >
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <NumberInput
            ariaLabel={labels[key]}
            value={value[key]}
            min={0}
            max={MAX_PADDING}
            step={1}
            onChange={(next) => onChange({ ...value, [key]: next })}
            className="px-0"
          />
          <ScrubHandle
            value={value[key]}
            min={0}
            max={MAX_PADDING}
            step={1}
            onChange={(next) => onChange({ ...value, [key]: next })}
            label={labels[key]}
          >
            px
          </ScrubHandle>
        </div>
      ))}
    </div>
  );
}

/**
 * Box alignment, not text alignment: these three seat a child against the
 * left/centre/right of its track, which is what the setting does. The
 * paragraph icons (AlignLeft…) read as "ragged-right text" and had merchants
 * expecting the copy inside an item to move.
 */
const HORIZONTAL_ICONS: Record<HeaderAlign, LucideIcon> = {
  start: AlignStartVertical,
  center: AlignCenterVertical,
  end: AlignEndVertical,
};

const VERTICAL_ICONS: Record<HeaderAlign, LucideIcon> = {
  start: AlignStartHorizontal,
  center: AlignCenterHorizontal,
  end: AlignEndHorizontal,
};

/**
 * The Figma 3 × 2 alignment matrix: the first row picks the horizontal
 * alignment, the second the vertical one.
 */
export function AlignmentField({
  value,
  onChange,
  labels,
}: {
  value: HeaderAlignment;
  onChange: (value: HeaderAlignment) => void;
  labels: { horizontal: string; vertical: string };
}) {
  return (
    <div className="space-y-1.5">
      <SegmentedIcons
        ariaLabel={labels.horizontal}
        options={HEADER_ALIGNMENTS.map((align) => ({
          value: align,
          icon: HORIZONTAL_ICONS[align],
        }))}
        value={value.horizontal}
        onChange={(horizontal) => onChange({ ...value, horizontal })}
      />
      <SegmentedIcons
        ariaLabel={labels.vertical}
        options={HEADER_ALIGNMENTS.map((align) => ({
          value: align,
          icon: VERTICAL_ICONS[align],
        }))}
        value={value.vertical}
        onChange={(vertical) => onChange({ ...value, vertical })}
      />
    </div>
  );
}

function SegmentedIcons<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; icon: LucideIcon }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="grid grid-cols-3 overflow-hidden rounded-[4px] border"
    >
      {options.map(({ value: option, icon: Icon }) => (
        <button
          key={option}
          type="button"
          aria-label={`${ariaLabel}: ${option}`}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "flex h-8 items-center justify-center border-r last:border-r-0 transition-colors",
            value === option
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:bg-muted",
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}

export function SelectField<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  accent,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  /** The Figma "3 Column" dropdown paints itself in the accent colour. */
  accent?: boolean;
}) {
  return (
    <NativeSelect
      aria-label={ariaLabel}
      size="sm"
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className={cn(
        "w-full text-xs",
        accent &&
          "border-primary bg-primary font-medium text-primary-foreground",
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </NativeSelect>
  );
}

/**
 * A colour swatch that opens the picker. "" means "inherit from the row",
 * which the swatch shows as a diagonal slash — a merchant needs to be able
 * to tell "white" from "not set".
 */
export function ColorField({
  value,
  onChange,
  label,
  inheritLabel,
  clearLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  inheritLabel: string;
  clearLabel: string;
}) {
  const inputId = useId();
  const isInherit = !value;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="h-8 w-full rounded-[4px] border bg-[linear-gradient(45deg,transparent_46%,var(--border)_46%,var(--border)_54%,transparent_54%)] shadow-xs"
          style={isInherit ? undefined : { background: value }}
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className={cn("w-56 space-y-3 p-3", STUDIO_CONTROL_RADIUS)}
      >
        <div className="flex items-center gap-2">
          <input
            id={inputId}
            type="color"
            aria-label={label}
            value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"}
            onChange={(event) => onChange(event.target.value)}
            className="h-8 w-10 cursor-pointer rounded border bg-transparent p-0.5"
          />
          <Input
            value={value}
            placeholder={inheritLabel}
            onChange={(event) => onChange(event.target.value.trim())}
            className="h-8 text-xs"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-full text-xs"
          onClick={() => onChange("")}
        >
          {clearLabel}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The weights the editor offers, named the way a designer says them. The
 * model stores the number, so a theme's CSS takes it directly.
 */
const FONT_WEIGHTS = [300, 400, 500, 600, 700, 800] as const;

interface TextStyleLabels {
  trigger: string;
  size: string;
  weight: string;
  weights: Record<number, string>;
  spacing: string;
  transform: string;
  transforms: Record<HeaderTextStyle["transform"], string>;
  /** The slant dropdown and its two readings. */
  slant: string;
  normal: string;
  italic: string;
  underline: string;
  color: string;
  clearColor: string;
}

/**
 * The "T" button and the type editor behind it — the same widget the slider
 * editor uses, so a merchant who has styled a slide already knows this one:
 * weight and slant as named dropdowns, size and spacing as unit fields, and the
 * colour at the bottom.
 *
 * The COLOUR lives here rather than in a "Foreground" row of its own. Every
 * panel that styles text opens this editor, and two controls for one colour
 * only invited the two to disagree.
 */
export function TextStyleField({
  value,
  onChange,
  labels,
  tSafe,
}: {
  value: HeaderTextStyle;
  onChange: (value: HeaderTextStyle) => void;
  labels: TextStyleLabels;
  tSafe: TSafe;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={labels.trigger}
          className="flex h-8 w-full items-center justify-center rounded-[4px] border bg-background text-destructive shadow-xs hover:bg-muted"
        >
          <Type className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className={cn("w-72 space-y-4 p-4", STUDIO_CONTROL_RADIUS)}
      >
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-semibold">{labels.weight}</span>
          <NativeSelect
            aria-label={labels.weight}
            value={String(value.fontWeight)}
            onChange={(event) =>
              onChange({ ...value, fontWeight: Number(event.target.value) })
            }
            className="h-9 w-36"
          >
            {FONT_WEIGHTS.map((weight) => (
              <option key={weight} value={weight}>
                {labels.weights[weight] ?? String(weight)}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-semibold">{labels.slant}</span>
          <NativeSelect
            aria-label={labels.slant}
            value={value.italic ? "italic" : "normal"}
            onChange={(event) =>
              onChange({ ...value, italic: event.target.value === "italic" })
            }
            className="h-9 w-36"
          >
            <option value="normal">{labels.normal}</option>
            <option value="italic">{labels.italic}</option>
          </NativeSelect>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-semibold">{labels.size}</span>
          <UnitField
            ariaLabel={labels.size}
            value={value.fontSize}
            unit="px"
            min={8}
            max={72}
            onChange={(fontSize) => onChange({ ...value, fontSize })}
            className="w-36"
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-semibold">{labels.spacing}</span>
          <UnitField
            ariaLabel={labels.spacing}
            value={value.letterSpacing}
            unit="px"
            min={-5}
            max={20}
            step={0.5}
            onChange={(letterSpacing) => onChange({ ...value, letterSpacing })}
            className="w-36"
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-semibold">{labels.transform}</span>
          <NativeSelect
            aria-label={labels.transform}
            value={value.transform}
            onChange={(event) =>
              onChange({
                ...value,
                transform: event.target
                  .value as HeaderTextStyle["transform"],
              })
            }
            className="h-9 w-36"
          >
            {HEADER_TEXT_TRANSFORMS.map((transform) => (
              <option key={transform} value={transform}>
                {labels.transforms[transform]}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-semibold">{labels.underline}</span>
          <Switch
            checked={value.underline}
            onCheckedChange={(underline) => onChange({ ...value, underline })}
            aria-label={labels.underline}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-semibold">{labels.color}</span>
          <FillField
            value={value.fill}
            onChange={(fill) => onChange({ ...value, fill })}
            label={labels.color}
            clearLabel={labels.clearColor}
            tSafe={tSafe}
            className="w-14"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A foreground paints a colour or a gradient — never a photo. */
const FILL_MODES = ["solid", "gradient"] as const;

/**
 * The swatch behind every "Foreground" and every text colour: the slider's
 * own Solid | Gradient picker, so one contract edits every fill in the
 * admin. Unset reads as a diagonal slash — "white" and "inherit" must not
 * look alike.
 */
export function FillField({
  value,
  onChange,
  label,
  clearLabel,
  tSafe,
  className,
}: {
  value: HeaderFill;
  onChange: (value: HeaderFill) => void;
  label: string;
  clearLabel: string;
  tSafe: TSafe;
  className?: string;
}) {
  return (
    <BackgroundSwatchField
      value={value}
      onChange={onChange}
      label={label}
      clearLabel={clearLabel}
      tSafe={tSafe}
      modes={FILL_MODES}
      className={className}
    />
  );
}

export function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}
