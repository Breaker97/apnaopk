/**
 * The editor's Reset dialog (docs/INVOICE_TEMPLATE_BUILDER.md §5.2): three
 * ways back, each one undo step and none of them saved until Save.
 *
 * - **Discard unsaved changes:** the last saved design and name.
 * - **Restore preset layout:** the preset the template was made from, in the
 *   template's language (only for a template made from a preset).
 * - **Reset styles only:** every element's look (`style`) goes back to where
 *   it started: the preset's element of the same id and type, else the type's
 *   defaults. Content, binding, config, format, geometry, order, lock and
 *   visibility stay; the canvas stays too.
 *
 * Pure and client-safe.
 */
import { buildPresetDesign, isPresetKey, type PresetKey } from "../presets";
import { defaultElement, type ElementStyle, type TemplateDesign, type TemplateElement } from "../types";
import { deepEqual } from "./operations";

export const RESET_KINDS = ["discard", "preset", "styles"] as const;
export type ResetKind = (typeof RESET_KINDS)[number];

/** The preset a template can go back to, or null (a blank template, an unknown key). */
export function resetPresetKey(presetKey: string | null | undefined): PresetKey | null {
  return isPresetKey(presetKey) ? presetKey : null;
}

/** The preset's design in the template's language. */
export function presetLayout(presetKey: PresetKey, design: Pick<TemplateDesign, "locale">): TemplateDesign {
  return buildPresetDesign(presetKey, design.locale);
}

/** The style an element of this type starts with, when no preset says otherwise. */
export function defaultStyleFor(type: TemplateElement["type"]): ElementStyle {
  return defaultElement(type, { id: "x", name: "x" }).style;
}

/**
 * Every element's style back to its starting look. `reference` is the design
 * the template came from (its preset), matched by element id and type.
 * Elements whose style is already that keep their identity, and so does the
 * design when nothing changes.
 */
export function resetStyles(design: TemplateDesign, reference?: TemplateDesign | null): TemplateDesign {
  const byId = new Map((reference?.elements ?? []).map((element) => [element.id, element]));
  let changed = false;
  const elements = design.elements.map((element) => {
    const source = byId.get(element.id);
    const style = source && source.type === element.type ? source.style : defaultStyleFor(element.type);
    if (deepEqual(style, element.style)) return element;
    changed = true;
    return { ...element, style: { ...style } } as TemplateElement;
  });
  return changed ? { ...design, elements } : design;
}

/** The design a reset of this kind leads to (the same object when there is nowhere to go). */
export function resetDesign(
  kind: ResetKind,
  input: { design: TemplateDesign; baseline: TemplateDesign; presetKey: string | null | undefined },
): TemplateDesign {
  const preset = resetPresetKey(input.presetKey);
  switch (kind) {
    case "discard":
      return input.baseline;
    case "preset":
      return preset ? presetLayout(preset, input.design) : input.design;
    case "styles":
      return resetStyles(input.design, preset ? presetLayout(preset, input.design) : null);
    default:
      return input.design;
  }
}
