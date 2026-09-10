/**
 * Dependency-free string helpers shared by route handlers, lib modules and
 * client components alike. Nothing here may import from `lib/` or `components/`
 * so it stays safe to pull into any bundle.
 */

/**
 * URL-safe slug from free text: lower-case ASCII letters and digits, any run
 * of other characters collapsed to a single "-", no leading or trailing dash.
 * `slugify("Summer Sale 2026!")` → `"summer-sale-2026"`.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Escape `value` so it matches itself literally inside a `RegExp`. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
