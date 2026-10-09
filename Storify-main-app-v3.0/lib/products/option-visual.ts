import { isColorOptionName } from "@/lib/products/color-swatch";

/**
 * The visuals a merchant can pick for a variant/option, and how they render on
 * the storefront. "image" was intentionally dropped — per-value image swatches
 * were orphaned, and each variant already swaps the product image via its own
 * media on selection, so an Image visual would be redundant.
 */
const OPTION_VISUALS = [
  "rectangle",
  "dropdown",
  "circle",
  "color",
  "color_label",
  "radio",
] as const;

export type OptionVisual = (typeof OPTION_VISUALS)[number];

const DEFAULT_OPTION_VISUAL: OptionVisual = "rectangle";

export function isOptionVisual(value: unknown): value is OptionVisual {
  return (
    typeof value === "string" &&
    (OPTION_VISUALS as readonly string[]).includes(value)
  );
}

/**
 * The visual to actually render with. An explicit, still-supported choice wins;
 * anything missing or legacy (e.g. the removed "image") falls back to the
 * historical name-based rule so old products keep rendering as before: an option
 * named "Color"/"Colour" shows swatches, everything else shows pills.
 */
export function resolveOptionVisual(option: {
  name: string;
  visual?: string | null;
}): OptionVisual {
  if (isOptionVisual(option.visual)) return option.visual;
  return isColorOptionName(option.name) ? "color" : DEFAULT_OPTION_VISUAL;
}

/** Visuals that render each value as a colour swatch. */
export function isSwatchVisual(visual: OptionVisual): boolean {
  return visual === "color" || visual === "color_label";
}

