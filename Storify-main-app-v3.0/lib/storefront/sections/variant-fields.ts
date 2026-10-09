import type { Field, SectionCatalogEntry } from "./types";
import { VARIANT_FIELD_KEY } from "./types";

/**
 * Which design a stored instance is showing — the same resolution the
 * renderer uses (a stored design wins; "theme", unset or unknown follow the
 * active template when the section does, else the first design), so the
 * editor never scopes fields against a design the storefront is not
 * rendering.
 */
export function activeVariantKey(
  entry: Pick<SectionCatalogEntry, "variants" | "designFollowsTheme" | "themeVariant">,
  settings: Record<string, unknown>,
): string | undefined {
  if (!entry.variants?.length) return undefined;
  const stored = settings[VARIANT_FIELD_KEY];
  const pinned = entry.variants.find((variant) => variant.key === stored)?.key;
  if (pinned) return pinned;
  if (entry.designFollowsTheme && entry.themeVariant) return entry.themeVariant;
  return entry.variants[0]?.key;
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
