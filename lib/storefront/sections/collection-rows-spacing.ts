/**
 * The Featured Collection rows' geometry: the space between the feature
 * panel and the shelf of cards, the panel's own size, and its corners.
 * Defaults are the row as it shipped — the product grids' spacing, a 3:2
 * panel that follows the cards' height, 16px corners — so an untouched
 * section is unchanged. The space BETWEEN cards is never set here: the
 * shelf reads the product card's grid spacing like every other grid.
 * Pure, so the editor reads it too.
 */

export const COLLECTION_ROW_GAP_MODES = ["followCards", "custom"] as const;
export const COLLECTION_ROW_CORNERS = ["custom", "theme"] as const;

export const COLLECTION_ROW_LIMITS = {
  gap: { default: 16, min: 0, max: 48 },
  /** Percent of the row; 0 = the shipped 3fr against 2fr per card. */
  panelWidth: { default: 0, min: 0, max: 60 },
  /** px from lg; 0 = as tall as the cards beside it. */
  panelHeight: { default: 0, min: 0, max: 800 },
  panelRadius: { default: 16, min: 0, max: 48 },
} as const;

export interface CollectionRowsSpacing {
  /** px between the panel and the shelf of cards; null = the product grids' own spacing. */
  gap: number | null;
  panelWidth: number;
  panelHeight: number;
  /** A CSS length. */
  radius: string;
}

export function readCollectionRowsSpacing(
  settings: Record<string, unknown>,
): CollectionRowsSpacing {
  const num = (value: unknown, spec: { default: number; min: number; max: number }) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(spec.max, Math.max(spec.min, Math.round(value)))
      : spec.default;
  const radius = num(settings.panelRadius, COLLECTION_ROW_LIMITS.panelRadius);
  return {
    gap: settings.gapMode === "custom" ? num(settings.gap, COLLECTION_ROW_LIMITS.gap) : null,
    panelWidth: num(settings.panelWidth, COLLECTION_ROW_LIMITS.panelWidth),
    panelHeight: num(settings.panelHeight, COLLECTION_ROW_LIMITS.panelHeight),
    radius:
      settings.corners === "theme"
        ? `var(--store-radius-card, ${COLLECTION_ROW_LIMITS.panelRadius.default}px)`
        : `${radius}px`,
  };
}
