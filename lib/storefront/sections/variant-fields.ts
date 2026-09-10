import type { Field, SectionCatalogEntry } from "./types";
import { VARIANT_FIELD_KEY } from "./types";

/**
 * Which design a stored instance is showing — the same fallback the renderer
 * uses (unknown or unset resolves to the first variant), so the editor never
 * scopes fields against a design the storefront is not rendering.
 */
export function activeVariantKey(
  entry: Pick<SectionCatalogEntry, "variants">,
  settings: Record<string, unknown>,
): string | undefined {
  if (!entry.variants?.length) return undefined;
  const stored = settings[VARIANT_FIELD_KEY];
  return entry.variants.find((variant) => variant.key === stored)?.key
    ?? entry.variants[0]?.key;
}

/**
 * Drop the fields the ACTIVE design ignores.
 *
 * Editor-only: a hidden field's stored value is left exactly where it is, so
 * switching back to the design that reads it brings the old value with it.
 * That is the same promise variants already make about content.
 */
export function fieldsForVariant(fields: Field[], variant?: string): Field[] {
  return fields.filter(
    (field) =>
      !field.variants?.length ||
      (variant !== undefined && field.variants.includes(variant)),
  );
}
