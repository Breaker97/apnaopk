"use client";

import { useState } from "react";
import { NativeSelect } from "@/components/ui/native-select";
import { UnitField } from "@/components/admin/unit-field";
import { cn } from "@/lib/utils";
import type {
  SlideHighlightStyle,
  SlideTextStyle,
  SlideFontWeight,
  SlideTextTransform,
} from "@/lib/sliders/types";
import {
  DEFAULT_LINE_HEIGHT,
  SLIDE_FONT_WEIGHTS,
  SLIDE_HIGHLIGHT_STYLES,
  SLIDE_TEXT_TRANSFORMS,
} from "@/lib/sliders/types";
import { ColorPickerPanel } from "./color-picker";

/**
 * The per-text styling menu (the design's "T" popup): weight, slant, size,
 * box width, tracking, line height, case, colour. Values write straight into
 * the slide's `styles[band][element]` — anything left unset falls back to
 * the element's built-in look, which for a heading and the button is the
 * theme's own.
 */

const WEIGHT_NAMES: Record<SlideFontWeight, string> = {
  "300": "Light",
  "400": "Normal",
  "500": "Medium",
  "600": "Semibold",
  "700": "Bold",
  "800": "Extrabold",
};

interface TextStyleLabels {
  weight: string;
  style: string;
  size: string;
  color: string;
  width: string;
  letterSpacing: string;
  lineHeight: string;
  transform: string;
  transformOptions: Record<"default" | SlideTextTransform, string>;
  /** A *highlighted* word's treatment; absent hides the rows (the button has none). */
  highlight?: string;
  highlightOptions?: Record<"none" | SlideHighlightStyle, string>;
  highlightColor?: string;
  highlightHint?: string;
}

export function TextStyleFields({
  value,
  inherited,
  defaults,
  onChange,
  labels,
}: {
  /**
   * What THIS band stores — the override, not the result. Editing writes only
   * the property you touched, so a size set in portrait leaves the weight and
   * colour still inheriting from landscape.
   */
  value: SlideTextStyle;
  /** What the band renders with today, used to show inherited values. */
  inherited: Required<Pick<SlideTextStyle, "size" | "width">> & SlideTextStyle;
  /** The element's built-in look, for the fields that have no stored value. */
  defaults: { letterSpacing: number };
  onChange: (style: SlideTextStyle) => void;
  labels: TextStyleLabels;
}) {
  const [showColor, setShowColor] = useState(false);
  const [showHighlightColor, setShowHighlightColor] = useState(false);
  const highlight = value.highlight ?? inherited.highlight;
  const size = value.size ?? inherited.size;
  const width = value.width ?? inherited.width;
  const weight = value.weight ?? inherited.weight ?? "700";
  const slant = value.style ?? inherited.style ?? "normal";
  const color = value.color ?? inherited.color ?? "#1f2937";
  const letterSpacing =
    value.letterSpacing ?? inherited.letterSpacing ?? defaults.letterSpacing;
  const lineHeight =
    value.lineHeight ?? inherited.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const transform = value.transform ?? inherited.transform ?? "default";

  // Name on the left, control on the right — the inspector's own row, so
  // these read as part of the sidebar rather than as a transplanted dialog.
  const row = (label: string, control: React.ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <span className="text-xs font-medium">{label}</span>
      {control}
    </div>
  );

  return (
    <div className="space-y-3">
        {row(
          labels.weight,
          <NativeSelect
            value={weight}
            onChange={(event) =>
              onChange({
                ...value,
                weight: event.target.value as SlideFontWeight,
              })
            }
            className="h-8 w-36 text-xs"
          >
            {SLIDE_FONT_WEIGHTS.map((weight) => (
              <option key={weight} value={weight}>
                {WEIGHT_NAMES[weight]}
              </option>
            ))}
          </NativeSelect>,
        )}

        {row(
          labels.style,
          <NativeSelect
            value={slant}
            onChange={(event) =>
              onChange({
                ...value,
                style: event.target.value as "normal" | "italic",
              })
            }
            className="h-8 w-36 text-xs"
          >
            <option value="normal">Normal</option>
            <option value="italic">Italic</option>
          </NativeSelect>,
        )}

        {row(
          labels.size,
          <UnitField
            ariaLabel={labels.size}
            value={size}
            unit="px"
            min={8}
            max={120}
            onChange={(next) => onChange({ ...value, size: next })}
            className="w-32"
          />,
        )}

        {row(
          labels.width,
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
            className="w-32"
          />,
        )}

        {row(
          labels.letterSpacing,
          <UnitField
            // A percent of the size, so it holds as the type scales.
            ariaLabel={labels.letterSpacing}
            value={letterSpacing}
            unit="%"
            min={-10}
            max={50}
            onChange={(next) => onChange({ ...value, letterSpacing: next })}
            className="w-32"
          />,
        )}

        {row(
          labels.lineHeight,
          <UnitField
            ariaLabel={labels.lineHeight}
            value={lineHeight}
            unit="%"
            min={80}
            max={200}
            step={5}
            onChange={(next) => onChange({ ...value, lineHeight: next })}
            className="w-32"
          />,
        )}

        {row(
          labels.transform,
          <NativeSelect
            value={transform}
            onChange={(event) => {
              // "Default" clears the property: the element's own case comes
              // back (the theme's, for a heading or the button).
              const next: SlideTextStyle = { ...value };
              if (event.target.value === "default") delete next.transform;
              else next.transform = event.target.value as SlideTextTransform;
              onChange(next);
            }}
            className="h-8 w-36 text-xs"
          >
            <option value="default">{labels.transformOptions.default}</option>
            {SLIDE_TEXT_TRANSFORMS.map((option) => (
              <option key={option} value={option}>
                {labels.transformOptions[option]}
              </option>
            ))}
          </NativeSelect>,
        )}

        {row(
          labels.color,
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
          />,
        )}
        {showColor ? (
          <ColorPickerPanel
            value={color}
            onChange={(hex) => onChange({ ...value, color: hex })}
          />
        ) : null}

        {/* A word wrapped in *asterisks* in the text, set apart. */}
        {labels.highlight && labels.highlightOptions ? (
          <>
            {row(
              labels.highlight,
              <NativeSelect
                value={highlight?.style ?? "none"}
                onChange={(event) => {
                  const next: SlideTextStyle = { ...value };
                  if (event.target.value === "none") delete next.highlight;
                  else {
                    next.highlight = {
                      ...(next.highlight ?? {}),
                      style: event.target.value as SlideHighlightStyle,
                    };
                  }
                  onChange(next);
                }}
                className="h-8 w-36 text-xs"
              >
                <option value="none">{labels.highlightOptions.none}</option>
                {SLIDE_HIGHLIGHT_STYLES.map((option) => (
                  <option key={option} value={option}>
                    {labels.highlightOptions?.[option]}
                  </option>
                ))}
              </NativeSelect>,
            )}
            {highlight && labels.highlightColor
              ? row(
                  labels.highlightColor,
                  <button
                    type="button"
                    onClick={() => setShowHighlightColor((open) => !open)}
                    className={cn(
                      "h-8 w-14 rounded-md border shadow-sm transition",
                      showHighlightColor
                        ? "border-primary ring-2 ring-primary/30"
                        : "border-border",
                      !highlight.color && "bg-[linear-gradient(135deg,var(--primary)_50%,transparent_50%)]",
                    )}
                    style={highlight.color ? { backgroundColor: highlight.color } : undefined}
                    aria-label={labels.highlightColor}
                    title={highlight.color ? undefined : labels.highlightHint}
                  />,
                )
              : null}
            {highlight && showHighlightColor ? (
              <ColorPickerPanel
                value={highlight.color ?? "#e11d48"}
                onChange={(hex) =>
                  onChange({ ...value, highlight: { ...highlight, color: hex } })
                }
              />
            ) : null}
            {labels.highlightHint ? (
              <p className="text-[11px] leading-snug text-muted-foreground">{labels.highlightHint}</p>
            ) : null}
          </>
        ) : null}
    </div>
  );
}
