"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UnitField } from "@/components/admin/unit-field";
import { cn } from "@/lib/utils";
import {
  DEFAULT_CTA_FILL,
  SLIDE_CTA_VARIANTS,
  type SlideCtaVariant,
  type SlideTextStyle,
} from "@/lib/sliders/types";
import { ColorPickerPanel } from "./color-picker";
import { panelSide, type PanelSide } from "./panel-side";

export interface CtaSettingsLabels {
  title: string;
  link: string;
  style: string;
  fill: string;
  paddingX: string;
  paddingY: string;
  height: string;
  radius: string;
  border: string;
  hint: string;
  variants: Record<SlideCtaVariant, string>;
}

/**
 * The CTA button's own properties — link, plate style and its fill, padding,
 * height, corners, ring — behind one gear, the way the Header Studio hangs a
 * property panel off each control. Rendered beside the button on the canvas
 * AND in the chip row, so it is found from either place; both edit the same
 * slide values. The box values are per shape band like every text style, so
 * a phone banner can run a tighter button.
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
  anchor,
}: {
  trigger: ReactNode;
  /** Given, the panel hangs off this box (the artboard's) rather than the trigger. */
  anchor?: HTMLElement | null;
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
  const [showFill, setShowFill] = useState(false);
  const [side, setSide] = useState<PanelSide>("bottom");
  const fill = ownStyle.fill ?? DEFAULT_CTA_FILL;

  /** 0 clears the property, so the default takes over again. */
  const patchBox = (
    prop: "paddingX" | "paddingY" | "height" | "radius",
    value: number,
  ) => {
    const next: SlideTextStyle = { ...ownStyle };
    if (value > 0) next[prop] = value;
    else delete next[prop];
    onStyleChange(next);
  };

  const unitRow = (
    label: string,
    prop: "paddingX" | "paddingY" | "height" | "radius",
    max: number,
    zeroLabel: string,
  ) => (
    <>
      <span className="text-xs font-medium">{label}</span>
      <UnitField
        ariaLabel={label}
        value={ownStyle[prop] ?? 0}
        unit="px"
        zeroLabel={zeroLabel}
        min={0}
        max={max}
        onChange={(next) => patchBox(prop, next)}
        className="w-28"
      />
    </>
  );

  return (
    <Popover
      onOpenChange={(open) => {
        if (open && anchor) setSide(panelSide(anchor, 320));
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {/* A real box portaled INTO the artboard's, after the trigger: the last
          anchor registered wins, and a real element registers itself on
          every mount — a virtual one did not under React's dev double-mount,
          and the panel hung off a stale trigger. */}
      {anchor
        ? createPortal(
            <PopoverAnchor asChild>
              <span aria-hidden className="pointer-events-none absolute inset-0" />
            </PopoverAnchor>,
            anchor,
          )
        : null}
      <PopoverContent
        align={anchor ? (side === "bottom" ? "end" : "start") : align}
        side={anchor ? side : "bottom"}
        sideOffset={anchor ? 12 : 4}
        collisionPadding={12}
        className="max-h-(--radix-popover-content-available-height) w-80 space-y-3 overflow-y-auto p-4"
      >
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
          {/* A custom plate is the one style with a colour of its own. */}
          {variant === "custom" ? (
            <>
              <span className="text-xs font-medium">{labels.fill}</span>
              <button
                type="button"
                onClick={() => setShowFill((open) => !open)}
                className={cn(
                  "h-8 w-14 rounded-md border shadow-sm transition",
                  showFill
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border",
                )}
                style={{ backgroundColor: fill }}
                aria-label={labels.fill}
              />
            </>
          ) : null}
          {unitRow(labels.paddingX, "paddingX", 120, "auto")}
          {unitRow(labels.paddingY, "paddingY", 120, "auto")}
          {unitRow(labels.height, "height", 160, "auto")}
          {/* Corners follow the theme's button radius until a number is set. */}
          {unitRow(labels.radius, "radius", 60, "theme")}
          {/* The ring is the outline style's stroke; the others have none. */}
          {variant === "outline" ? (
            <>
              <span className="text-xs font-medium">{labels.border}</span>
              <UnitField
                ariaLabel={labels.border}
                value={ownStyle.borderWidth ?? 1}
                unit="px"
                min={1}
                max={4}
                onChange={(next) =>
                  onStyleChange({ ...ownStyle, borderWidth: next })
                }
                className="w-28"
              />
            </>
          ) : null}
        </div>
        {variant === "custom" && showFill ? (
          <ColorPickerPanel
            value={fill}
            onChange={(hex) => onStyleChange({ ...ownStyle, fill: hex })}
          />
        ) : null}
        <p className="text-[11px] leading-snug text-muted-foreground">
          {labels.hint}
        </p>
      </PopoverContent>
    </Popover>
  );
}
