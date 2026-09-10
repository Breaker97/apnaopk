"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UnitField } from "@/components/admin/unit-field";
import {
  SLIDE_CTA_VARIANTS,
  type SlideCtaVariant,
  type SlideTextStyle,
} from "@/lib/sliders/types";

export interface CtaSettingsLabels {
  title: string;
  link: string;
  style: string;
  paddingX: string;
  paddingY: string;
  height: string;
  hint: string;
  variants: Record<SlideCtaVariant, string>;
}

/**
 * The CTA button's own properties — link, plate style, padding, height —
 * behind one gear, the way the Header Studio hangs a property panel off
 * each control. Rendered beside the button on the canvas AND in the chip
 * row, so it is found from either place; both edit the same slide values.
 * The box values are per shape band like every text style, so a phone
 * banner can run a tighter button.
 */
export function CtaSettingsPopover({
  trigger,
  link,
  variant,
  ownStyle,
  labels,
  onLinkChange,
  onVariantChange,
  onStyleChange,
  align = "start",
}: {
  trigger: ReactNode;
  link: string;
  variant: SlideCtaVariant;
  /** The CTA style as STORED for the current band (what the fields edit). */
  ownStyle: SlideTextStyle;
  labels: CtaSettingsLabels;
  onLinkChange: (link: string) => void;
  onVariantChange: (variant: SlideCtaVariant) => void;
  onStyleChange: (style: SlideTextStyle) => void;
  align?: "start" | "end";
}) {
  /** 0 clears the property, so the em-based default takes over again. */
  const patchBox = (
    prop: "paddingX" | "paddingY" | "height",
    value: number,
  ) => {
    const next: SlideTextStyle = { ...ownStyle };
    if (value > 0) next[prop] = value;
    else delete next[prop];
    onStyleChange(next);
  };

  const unitRow = (
    label: string,
    prop: "paddingX" | "paddingY" | "height",
    max: number,
  ) => (
    <>
      <span className="text-xs font-medium">{label}</span>
      <UnitField
        ariaLabel={label}
        value={ownStyle[prop] ?? 0}
        unit="px"
        zeroLabel="auto"
        min={0}
        max={max}
        onChange={(next) => patchBox(prop, next)}
        className="w-28"
      />
    </>
  );

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="w-80 space-y-3 p-4">
        <p className="text-xs font-semibold text-muted-foreground">
          {labels.title}
        </p>
        <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3">
          <span className="text-xs font-medium">{labels.link}</span>
          <Input
            value={link}
            onChange={(event) => onLinkChange(event.target.value)}
            placeholder="/products or https://…"
            className="h-8 text-xs"
          />
          <span className="text-xs font-medium">{labels.style}</span>
          <NativeSelect
            value={variant}
            onChange={(event) =>
              onVariantChange(event.target.value as SlideCtaVariant)
            }
            className="h-8 text-xs"
          >
            {SLIDE_CTA_VARIANTS.map((entry) => (
              <option key={entry} value={entry}>
                {labels.variants[entry]}
              </option>
            ))}
          </NativeSelect>
          {unitRow(labels.paddingX, "paddingX", 120)}
          {unitRow(labels.paddingY, "paddingY", 120)}
          {unitRow(labels.height, "height", 160)}
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {labels.hint}
        </p>
      </PopoverContent>
    </Popover>
  );
}
