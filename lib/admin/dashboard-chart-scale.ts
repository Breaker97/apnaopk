/**
 * Axis scaling shared by the dashboard's orders and visitors charts: round the
 * largest series value up to a 1/2/5 × 10ⁿ ceiling, then cut it into four even
 * ticks so both charts read on the same grid.
 */
export function getNiceMax(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 4;

  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const normalized = value / magnitude;

  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

export function getChartTicks(maxValue: number) {
  return Array.from({ length: 5 }, (_, index) => (maxValue / 4) * index);
}
