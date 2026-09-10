// Desktop column classes for the product-browser grids ("Product Grid"
// section). Static strings so Tailwind's scanner picks them up; phones and
// tablets keep their fixed 2/3-column tiers and only the lg tier is
// admin-configurable, matching the carousel sections.
export const PRODUCT_GRID_DESKTOP_COLUMN_CLASSES: Record<number, string> = {
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
};

export function clampDesktopColumns(value: number | undefined): number {
  const normalized = Number.isFinite(value) ? Math.floor(value as number) : 4;
  return Math.min(6, Math.max(2, normalized));
}
