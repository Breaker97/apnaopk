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

/**
 * `getNiceMax` for a series of whole numbers, such as order counts: the ceiling
 * is a multiple of four, so all four steps are whole numbers too. A plain 1/2/5
 * ceiling put an axis of one order at 0, 0.25, 0.5… and one of 48 at 12.5 and
 * 37.5 — fractions of an order.
 */
export function getNiceCountMax(value: number) {
  if (!Number.isFinite(value) || value <= 4) return 4;

  const step = Math.ceil(value / 4);
  // Steps of any whole number read fine while small; past ten, round them up to
  // a multiple of 5, 50, 500… so the ticks stay round.
  const unit = step < 10 ? 1 : 5 * 10 ** (Math.floor(Math.log10(step)) - 1);
  return Math.ceil(step / unit) * unit * 4;
}

export function getChartTicks(maxValue: number) {
  return Array.from({ length: 5 }, (_, index) => (maxValue / 4) * index);
}
