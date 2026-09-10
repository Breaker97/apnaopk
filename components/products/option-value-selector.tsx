"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSwatchColor } from "@/lib/products/color-swatch";
import { resolveOptionVisual } from "@/lib/products/option-visual";

interface OptionValueLite {
  _id: string;
  value: string;
  colorCode?: string;
}

interface OptionLite {
  name: string;
  visual?: string | null;
  values?: OptionValueLite[];
}

const LIGHT_SWATCHES = new Set(["#ffffff", "#fffdd0", "#fef3c7", "#fbbf24", "#eab308"]);

/**
 * Renders a single product option's value chooser according to its `visual`
 * (falling back to name-based detection for legacy options). Shared by the
 * product detail page and quick-view surfaces so every storefront place picks
 * variants the same way.
 *
 * Only the value controls are rendered — callers own the option label/header.
 */
export function OptionValueSelector({
  option,
  selectedValue,
  onSelect,
  size = "md",
  resolveColor,
  colorSwatchesOnly = false,
}: {
  option: OptionLite;
  selectedValue?: string;
  onSelect: (value: string) => void;
  size?: "xs" | "sm" | "md";
  /** Optional custom colour resolver (e.g. PDP's variant-media fallback). */
  resolveColor?: (value: OptionValueLite) => string | null;
  /**
   * Render colour options as bare swatches even when the option's visual is
   * "color with label". Compact surfaces (the mobile quick-view sheet) opt in
   * and show the selected name in their own caption instead — the option
   * itself is untouched, so the product page keeps its labelled pills.
   */
  colorSwatchesOnly?: boolean;
}) {
  const visual = resolveOptionVisual(option);
  const values = option.values ?? [];
  const colorOf = (v: OptionValueLite) =>
    resolveColor ? resolveColor(v) : getSwatchColor(v.value, v.colorCode);

  const swatchSize =
    size === "xs" ? "h-7 w-7" : size === "sm" ? "h-8 w-8" : "h-9 w-9";
  const textBtn =
    size === "xs"
      ? "h-8 px-2.5 text-xs"
      : size === "sm"
        ? "h-9 px-3 text-sm"
        : "px-4 py-2 text-sm";

  // ── Dropdown ──────────────────────────────────────────────────────
  if (visual === "dropdown") {
    return (
      <select
        value={selectedValue ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className="h-11 w-full max-w-xs rounded-md border border-border bg-background px-3 text-sm text-foreground focus:border-foreground focus:outline-none"
        aria-label={option.name}
      >
        <option value="" disabled>
          Select {option.name}
        </option>
        {values.map((v) => (
          <option key={v._id} value={v.value}>
            {v.value}
          </option>
        ))}
      </select>
    );
  }

  // ── Radio list ────────────────────────────────────────────────────
  if (visual === "radio") {
    return (
      <div className="flex flex-col gap-2">
        {values.map((v) => {
          const isSelected = selectedValue === v.value;
          return (
            <label
              key={v._id}
              className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
            >
              <span
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full border transition",
                  isSelected ? "border-foreground" : "border-muted-foreground/50",
                )}
              >
                {isSelected && <span className="h-2 w-2 rounded-full bg-foreground" />}
              </span>
              <input
                type="radio"
                name={option.name}
                value={v.value}
                checked={isSelected}
                onChange={() => onSelect(v.value)}
                className="sr-only"
              />
              {v.value}
            </label>
          );
        })}
      </div>
    );
  }

  // ── Colour swatches (color / color_label) ─────────────────────────
  if (visual === "color" || visual === "color_label") {
    const withLabel = visual === "color_label" && !colorSwatchesOnly;
    return (
      <div className="flex flex-wrap gap-2.5">
        {values.map((v) => {
          const isSelected = selectedValue === v.value;
          const color = colorOf(v);
          const isLight = color ? LIGHT_SWATCHES.has(color.toLowerCase()) : false;

          if (withLabel) {
            return (
              <button
                key={v._id}
                type="button"
                onClick={() => onSelect(v.value)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition",
                  isSelected
                    ? "border-foreground ring-1 ring-foreground"
                    : "border-border hover:border-foreground/50",
                )}
                aria-pressed={isSelected}
              >
                <span
                  aria-hidden
                  className="h-4 w-4 rounded-full border border-black/10"
                  style={{ backgroundColor: color || "#e5e7eb" }}
                />
                {v.value}
              </button>
            );
          }

          return (
            <button
              key={v._id}
              type="button"
              onClick={() => onSelect(v.value)}
              className={cn(
                "relative flex items-center justify-center rounded-full border transition",
                swatchSize,
                isSelected
                  ? "border-foreground ring-2 ring-foreground/20"
                  : "border-transparent hover:border-border",
                isLight && "border-muted-foreground/20",
              )}
              style={{ backgroundColor: color || "#e5e7eb" }}
              title={v.value}
              aria-label={v.value}
              aria-pressed={isSelected}
            >
              {isSelected && (
                <Check
                  className={cn(
                    size === "xs" ? "h-3.5 w-3.5" : "h-4 w-4",
                    isLight ? "text-zinc-900" : "text-white",
                  )}
                  strokeWidth={3}
                />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  // ── Circle / Rectangle text buttons ───────────────────────────────
  const rounded = visual === "circle" ? "rounded-full" : "rounded-md";
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((v) => {
        const isSelected = selectedValue === v.value;
        return (
          <button
            key={v._id}
            type="button"
            onClick={() => onSelect(v.value)}
            className={cn(
              "border font-medium transition",
              rounded,
              textBtn,
              visual === "circle" &&
                (size === "xs" ? "min-w-9 text-center" : "min-w-[2.75rem] text-center"),
              isSelected
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-foreground/80 hover:border-foreground/50",
            )}
            aria-pressed={isSelected}
          >
            {v.value}
          </button>
        );
      })}
    </div>
  );
}
