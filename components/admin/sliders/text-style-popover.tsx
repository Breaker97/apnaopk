"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { NativeSelect } from "@/components/ui/native-select";
import { UnitField } from "@/components/admin/unit-field";
import { cn } from "@/lib/utils";
import type { SlideTextStyle, SlideFontWeight } from "@/lib/sliders/types";
import { SLIDE_FONT_WEIGHTS } from "@/lib/sliders/types";
import { ColorPickerPanel } from "./color-picker";

/**
 * The per-text styling menu (the design's "T" popup): weight, style, size,
 * color. Values write straight into the slide's `styles[element]` — anything
 * left unset falls back to the element's built-in look.
 */

const WEIGHT_NAMES: Record<SlideFontWeight, string> = {
  "300": "Light",
  "400": "Normal",
  "500": "Medium",
  "600": "Semibold",
  "700": "Bold",
  "800": "Extrabold",
};

export function TextStylePopover({
  trigger,
  value,
  inherited,
  onChange,
  labels,
}: {
  trigger: React.ReactNode;
  /**
   * What THIS band stores — the override, not the result. Editing writes only
   * the property you touched, so a size set in portrait leaves the weight and
   * colour still inheriting from landscape.
   */
  value: SlideTextStyle;
  /** What the band renders with today, used to show inherited values. */
  inherited: Required<Pick<SlideTextStyle, "size" | "width">> & SlideTextStyle;
  onChange: (style: SlideTextStyle) => void;
  labels: {
    weight: string;
    style: string;
    size: string;
    color: string;
    width: string;
  };
}) {
  const [showColor, setShowColor] = useState(false);
  const size = value.size ?? inherited.size;
  const width = value.width ?? inherited.width;
  const weight = value.weight ?? inherited.weight ?? "700";
  const slant = value.style ?? inherited.style ?? "normal";
  const color = value.color ?? inherited.color ?? "#1f2937";

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        // Never over the copy being edited. The trigger sits BELOW the text
        // box, so opening downward moves the panel away from it — whereas
        // "right" cannot fit beside a full-width box (the box already spans
        // the canvas) and would flip back over the copy.
        align="center"
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        className="w-72 space-y-4 rounded-xl p-4 shadow-xl"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-semibold">{labels.weight}</span>
          <NativeSelect
            value={weight}
            onChange={(event) =>
              onChange({
                ...value,
                weight: event.target.value as SlideFontWeight,
              })
            }
            className="h-9 w-36"
          >
            {SLIDE_FONT_WEIGHTS.map((weight) => (
              <option key={weight} value={weight}>
                {WEIGHT_NAMES[weight]}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-semibold">{labels.style}</span>
          <NativeSelect
            value={slant}
            onChange={(event) =>
              onChange({
                ...value,
                style: event.target.value as "normal" | "italic",
              })
            }
            className="h-9 w-36"
          >
            <option value="normal">Normal</option>
            <option value="italic">Italic</option>
          </NativeSelect>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-semibold">{labels.size}</span>
          <UnitField
            ariaLabel={labels.size}
            value={size}
            unit="px"
            min={8}
            max={96}
            onChange={(next) => onChange({ ...value, size: next })}
            className="w-36"
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-semibold">{labels.width}</span>
          <UnitField
            // 0 is a real setting — "shrink to fit the text", which is what
            // a CTA button wants — so it reads "auto" instead of a unit.
            ariaLabel={labels.width}
            value={width}
            unit="%"
            zeroLabel="auto"
            min={0}
            max={100}
            onChange={(next) => onChange({ ...value, width: next })}
            className="w-36"
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-semibold">{labels.color}</span>
          <button
            type="button"
            onClick={() => setShowColor((open) => !open)}
            className={cn(
              "h-8 w-14 rounded-md border shadow-sm transition",
              showColor
                ? "border-primary ring-2 ring-primary/30"
                : "border-border",
            )}
            style={{ backgroundColor: color }}
            aria-label={labels.color}
          />
        </div>
        {showColor ? (
          <ColorPickerPanel
            value={color}
            onChange={(hex) => onChange({ ...value, color: hex })}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
