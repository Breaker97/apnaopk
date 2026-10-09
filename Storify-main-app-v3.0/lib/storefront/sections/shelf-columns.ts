/**
 * Cards across one desktop row of a product shelf or grid, clamped to the
 * 2–6 tiers the shelf classes exist for. The sections' loaders size a shelf
 * from it (rows × columns) and the components lay it out with it, so the two
 * never disagree about how many cards a row holds.
 */
export function clampDesktopColumns(value: number | undefined): number {
  const normalized = Number.isFinite(value) ? Math.floor(value as number) : 4;
  return Math.min(6, Math.max(2, normalized));
}
