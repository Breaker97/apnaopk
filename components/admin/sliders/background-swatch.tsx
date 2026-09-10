"use client";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import {
  backgroundCss,
  hasBackground,
  normalizeBackground,
  type SlideBackground,
} from "@/lib/sliders/types";
import { cn } from "@/lib/utils";
import { BackgroundPicker } from "./background-picker";
import { CHECKERBOARD } from "./color-picker";

/**
 * The plate's paint. A solid colour sits on a chequerboard so a
 * translucent one shows AS translucent — on a plain plate, 30% black and
 * light grey are the same square.
 */
function swatchCss(value: SlideBackground): React.CSSProperties {
  if (value.type === "solid" && value.color) {
    return {
      background: `linear-gradient(${value.color}, ${value.color}), ${CHECKERBOARD}`,
    };
  }
  return backgroundCss(value);
}

/**
 * A background control that opens the slider's Solid | Gradient | Image
 * picker. Shared by the header studio's property panel and the section
 * editor's "background" field, so every background in the admin is edited
 * the same way.
 *
 * Two shapes, because the two surfaces are shaped differently. The property
 * panel's rows are a label beside a control, so a `swatch` — a small plate
 * painted with whatever is set, slashed when nothing is — fits its column.
 * The section inspector lays fields out in half-width cells, where a plate
 * stretched across one reads as an image dropped into the form rather than a
 * control; there the `button` names the fill instead and keeps its size.
 */
export function BackgroundSwatchField({
  value,
  onChange,
  label,
  clearLabel,
  tSafe,
  className,
  modes,
  variant = "swatch",
}: {
  value: SlideBackground;
  onChange: (value: SlideBackground) => void;
  label: string;
  /** The reset action — "Reset to inherit", "None", … */
  clearLabel: string;
  tSafe: TSafe;
  className?: string;
  /** Narrow the picker's tabs — a foreground drops "image". */
  modes?: readonly SlideBackground["type"][];
  variant?: "swatch" | "button";
}) {
  const isSet = hasBackground(value);
  const labels = backgroundPickerLabels(tSafe);
  /** What is in the slot, named — the button says this, the swatch shows it. */
  const fill = !isSet
    ? tSafe("admin.storeBuilder.noColor", "None")
    : value.type === "image"
      ? labels.image
      : value.type === "gradient"
        ? labels.gradient
        : labels.solid;

  return (
    <Popover>
      <PopoverTrigger asChild>
        {variant === "button" ? (
          <Button
            type="button"
            variant="outline"
            aria-label={label}
            className={cn("h-9 justify-start gap-2 px-2.5", className)}
          >
            <span
              className={cn(
                "h-4 w-4 shrink-0 rounded-[3px] border",
                !isSet &&
                  "bg-[linear-gradient(45deg,transparent_42%,var(--border)_42%,var(--border)_58%,transparent_58%)]",
              )}
              style={isSet ? swatchCss(value) : undefined}
            />
            <span className="truncate text-xs font-normal">{fill}</span>
          </Button>
        ) : (
          <button
            type="button"
            aria-label={label}
            className={cn(
              "h-8 w-full rounded-[4px] border shadow-xs",
              !isSet &&
                "bg-[linear-gradient(45deg,transparent_46%,var(--border)_46%,var(--border)_54%,transparent_54%)]",
              className,
            )}
            style={isSet ? swatchCss(value) : undefined}
          />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto space-y-3 p-3">
        <BackgroundPicker
          value={value}
          onChange={onChange}
          labels={labels}
          modes={modes}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-full text-xs"
          onClick={() => onChange({ type: "solid" })}
        >
          {clearLabel}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** The picker's copy, from the slider strings every locale already carries. */
function backgroundPickerLabels(tSafe: TSafe) {
  return {
    solid: tSafe("admin.sliders.bg.solid", "Solid"),
    gradient: tSafe("admin.sliders.bg.gradient", "Gradient"),
    image: tSafe("admin.sliders.bg.image", "Image"),
    upload: tSafe("admin.sliders.bg.upload", "Upload Image"),
    direction: tSafe("admin.sliders.bg.direction", "Direction"),
  };
}

/**
 * A stored background, read for EDITING rather than for painting.
 *
 * `normalizeBackground` downgrades a mode with nothing in it to solid, so the
 * storefront never paints a hole. Applying that to the editor's own value
 * makes the picker unusable the moment a slot is emptied: delete the image and
 * the value comes back as solid, which throws the merchant out of the Image
 * tab and back to Solid every time they click it. The chosen MODE is UI state
 * and is kept as-is; the write path still normalizes, so an empty mode never
 * reaches a shopper.
 */
export function editorBackground(value: unknown): SlideBackground {
  const normalized = normalizeBackground(value);
  const type = (value as { type?: unknown } | null)?.type;
  return type === "solid" || type === "gradient" || type === "image"
    ? { ...normalized, type }
    : normalized;
}
