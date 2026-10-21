/**
 * Element style presets (§5.6): Minimal, Bold COD, Premium, Compact, Courier
 * Label. A preset changes **visual properties only** (the element's `style`);
 * its content, binding, config, format, geometry, order, lock and visibility,
 * and every other element, stay as they are. Applying one is one undo step.
 *
 * A preset only writes the properties its element type has a control for
 * (capabilities.ts), so choosing "Premium" on a barcode can't set a font it
 * never prints with, and it leaves out what it doesn't characterise (Minimal
 * keeps the size you chose).
 *
 * "Reset to default style" puts the element's `style` back to where it
 * started (the preset layout's element of the same id and type, else the
 * type's defaults) and touches nothing else.
 *
 * Pure and client-safe.
 */
import { capabilitiesFor, hasSection, type BorderControl, type ColourControl, type TypographyControl } from "./capabilities";
import { defaultStyleFor } from "./reset";
import type { ElementStyle, TemplateElement } from "../types";

export const STYLE_PRESET_KEYS = ["minimal", "boldCod", "premium", "compact", "courierLabel"] as const;
export type StylePresetKey = (typeof STYLE_PRESET_KEYS)[number];

export function isStylePresetKey(value: unknown): value is StylePresetKey {
  return typeof value === "string" && (STYLE_PRESET_KEYS as readonly string[]).includes(value);
}

const NONE = { borderWidthPx: 0, borderStyle: "none", radiusPx: 0 } as const;

/** What each preset sets, before it is cut down to the element's controls. */
const PRESETS: Record<StylePresetKey, Partial<ElementStyle>> = {
  // Clean and light: regular weight, dark grey, no frame, no fill.
  minimal: {
    fontFamily: "clean-sans",
    fontWeight: 400,
    fontStyle: "normal",
    lineHeight: 1.35,
    color: "#1f2937",
    background: "transparent",
    ...NONE,
    paddingMm: 0,
    gapMm: 1,
  },
  // Loud on purpose: heavy black type in a thick frame, for the cash to collect.
  boldCod: {
    fontFamily: "clean-sans",
    fontWeight: 700,
    fontStyle: "normal",
    fontSizePx: 16,
    lineHeight: 1.2,
    color: "#000000",
    background: "transparent",
    borderWidthPx: 2,
    borderStyle: "solid",
    borderColor: "#000000",
    radiusPx: 4,
    paddingMm: 2,
  },
  // A serif face on a warm fill, a fine gold frame.
  premium: {
    fontFamily: "elegant-serif",
    fontWeight: 400,
    fontStyle: "normal",
    lineHeight: 1.4,
    color: "#1f2937",
    background: "#faf6ee",
    borderWidthPx: 1,
    borderStyle: "solid",
    borderColor: "#c8a96a",
    radiusPx: 6,
    paddingMm: 3,
    gapMm: 1.5,
  },
  // Dense: small type, tight lines, no frame.
  compact: {
    fontFamily: "clean-sans",
    fontWeight: 400,
    fontStyle: "normal",
    fontSizePx: 10,
    lineHeight: 1.15,
    color: "#111111",
    background: "transparent",
    ...NONE,
    paddingMm: 0.5,
    gapMm: 0.5,
  },
  // Thermal-printer look: monospace, bold black, a dashed frame.
  courierLabel: {
    fontFamily: "compact-thermal",
    fontWeight: 700,
    fontStyle: "normal",
    fontSizePx: 12,
    lineHeight: 1.25,
    color: "#000000",
    background: "transparent",
    borderWidthPx: 1,
    borderStyle: "dashed",
    borderColor: "#000000",
    radiusPx: 0,
    paddingMm: 1.5,
  },
};

/** Which `ElementStyle` keys each control group writes. */
const TYPOGRAPHY_KEYS: Record<TypographyControl, keyof ElementStyle> = {
  fontFamily: "fontFamily",
  fontSizePx: "fontSizePx",
  fontWeight: "fontWeight",
  fontStyle: "fontStyle",
  textAlign: "textAlign",
  lineHeight: "lineHeight",
  verticalAlign: "verticalAlign",
  shrinkToFit: "shrinkToFit",
};
const COLOUR_KEYS: Record<ColourControl, keyof ElementStyle> = { color: "color", background: "background" };
const BORDER_KEYS: Record<BorderControl, keyof ElementStyle> = {
  borderWidthPx: "borderWidthPx",
  borderStyle: "borderStyle",
  borderColor: "borderColor",
  radiusPx: "radiusPx",
  paddingMm: "paddingMm",
  gapMm: "gapMm",
};

/** The style keys a type has controls for. */
export function styleKeysFor(type: TemplateElement["type"]): Set<keyof ElementStyle> {
  const capabilities = capabilitiesFor(type);
  return new Set<keyof ElementStyle>([
    ...capabilities.typography.map((control) => TYPOGRAPHY_KEYS[control]),
    ...capabilities.colours.map((control) => COLOUR_KEYS[control]),
    ...capabilities.border.map((control) => BORDER_KEYS[control]),
  ]);
}

/** Whether the type offers style presets at all. */
export function acceptsStylePreset(type: TemplateElement["type"]): boolean {
  return hasSection(type, "stylePreset");
}

/** The properties a preset would write on an element of this type. */
export function stylePresetPatch(key: StylePresetKey, type: TemplateElement["type"]): Partial<ElementStyle> {
  if (!acceptsStylePreset(type)) return {};
  const allowed = styleKeysFor(type);
  const patch: Partial<ElementStyle> = {};
  for (const [name, value] of Object.entries(PRESETS[key])) {
    if (allowed.has(name as keyof ElementStyle)) (patch as Record<string, unknown>)[name] = value;
  }
  return patch;
}

/**
 * The element with a preset's look. Everything but `style` is the same
 * object it was; when the preset changes nothing, the element itself.
 */
export function applyStylePreset(element: TemplateElement, key: StylePresetKey): TemplateElement {
  const patch = stylePresetPatch(key, element.type);
  const style = { ...element.style, ...patch };
  const changed = (Object.keys(patch) as (keyof ElementStyle)[]).some((name) => style[name] !== element.style[name]);
  return changed ? ({ ...element, style } as TemplateElement) : element;
}

/**
 * The element with its style back to where it started. `reference` is the
 * preset layout's element of the same id (matched by type too); without one,
 * the type's defaults. Only `style` changes.
 */
export function resetElementStyle(element: TemplateElement, reference?: TemplateElement | null): TemplateElement {
  const source = reference && reference.id === element.id && reference.type === element.type ? reference.style : defaultStyleFor(element.type);
  const same = (Object.keys({ ...source, ...element.style }) as (keyof ElementStyle)[]).every((name) => source[name] === element.style[name]);
  return same ? element : ({ ...element, style: { ...source } } as TemplateElement);
}
