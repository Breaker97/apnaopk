/**
 * Edits the property panel makes to one element, as pure functions of the
 * element (so the store can apply them to its latest copy, not the one the
 * panel last rendered). Each returns the same element when nothing changes.
 *
 * Optional values are kept out of the stored record when they are empty:
 * an empty "text before" is no `before` key, an element format that says
 * nothing is no `format` key. That keeps a saved template small and makes
 * "did anything change" a plain comparison.
 *
 * Pure and client-safe.
 */
import type { FieldKey } from "../field-keys";
import type { ElementBinding, ElementFormat, ElementStyle, TemplateElement } from "../types";

const BINDING_TEXT_KEYS = ["text", "before", "after", "fallback"] as const;

export function withStyle(element: TemplateElement, patch: Partial<ElementStyle>): TemplateElement {
  const keys = Object.keys(patch) as (keyof ElementStyle)[];
  if (keys.every((key) => element.style[key] === patch[key])) return element;
  const style: ElementStyle = { ...element.style, ...patch };
  // A font of "use the template's" is no fontFamily key at all.
  if (style.fontFamily === undefined) delete style.fontFamily;
  return { ...element, style } as TemplateElement;
}

/** The binding with these fields changed; empty text parts are dropped. */
export function withBinding(element: TemplateElement, patch: Partial<ElementBinding>): TemplateElement {
  const base: ElementBinding = element.binding ?? { mode: "fixed" };
  const next: ElementBinding = { ...base, ...patch };
  for (const key of BINDING_TEXT_KEYS) {
    // The fixed text may be emptied, and stays as ""; the parts around a field vanish when empty.
    if (key !== "text" && (next[key] === undefined || next[key] === "")) delete next[key];
  }
  if (next.field === undefined) delete next.field;
  if (element.binding && BINDING_KEYS.every((key) => element.binding![key] === next[key])) return element;
  return { ...element, binding: next } as TemplateElement;
}

const BINDING_KEYS = ["mode", "field", "text", "before", "after", "fallback"] as const satisfies readonly (keyof ElementBinding)[];

/**
 * Switches between fixed text and a data field. Whatever the other mode had
 * (the text, or the field and its before/after) stays on the binding, so
 * switching back restores it; going to "field" with none chosen picks
 * `defaultField`, because a field binding without a field can't be saved.
 */
export function withBindingMode(element: TemplateElement, mode: ElementBinding["mode"], defaultField: FieldKey): TemplateElement {
  const base: ElementBinding = element.binding ?? { mode };
  if (base.mode === mode && element.binding) return element;
  const patch: Partial<ElementBinding> = { mode };
  if (mode === "field" && !base.field) patch.field = defaultField;
  return withBinding(element, patch);
}

/**
 * The element's own format override with these keys changed. A key set to
 * `undefined` goes back to the template's value; with nothing left, the
 * element has no `format` at all.
 */
export function withElementFormat(element: TemplateElement, patch: { [K in keyof ElementFormat]: ElementFormat[K] | undefined }): TemplateElement {
  const next: ElementFormat = { ...(element.format ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete (next as Record<string, unknown>)[key];
    else (next as Record<string, unknown>)[key] = value;
  }
  const same = JSON.stringify(sorted(next)) === JSON.stringify(sorted(element.format ?? {}));
  if (same) return element;
  const { format: _old, ...rest } = element;
  return (Object.keys(next).length > 0 ? { ...rest, format: next } : rest) as TemplateElement;
}

function sorted(format: ElementFormat): [string, unknown][] {
  return Object.entries(format).sort(([a], [b]) => a.localeCompare(b));
}

/** Whether the element overrides any of the template's formats. */
export function hasFormatOverride(element: TemplateElement): boolean {
  return Boolean(element.format && Object.keys(element.format).length > 0);
}
