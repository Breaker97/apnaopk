/**
 * Millimetres are the truth (D-15): templates store mm at 0.1 mm precision
 * and font sizes in CSS px. The page is laid out at 96 dpi, where one CSS px
 * is 1/96 in, so 1 mm = 96 / 25.4 px. Zoom is a CSS transform over that
 * layout and never enters these numbers.
 */

export const PX_PER_MM = 96 / 25.4;
export const PT_PER_MM = 72 / 25.4;

/** Round to the 0.1 mm a template stores. */
export function roundMm(mm: number): number {
  return Math.round(mm * 10) / 10;
}

export function mmToPx(mm: number): number {
  return mm * PX_PER_MM;
}

export function pxToMm(px: number): number {
  return px / PX_PER_MM;
}

export function mmToPt(mm: number): number {
  return mm * PT_PER_MM;
}

/**
 * A pointer movement on screen, in mm on the page: screen px at zoom `zoom`
 * (1 = 100 %), rounded to what a template stores (§4.4).
 */
export function screenDeltaToMm(screenPx: number, zoom: number): number {
  if (!(zoom > 0)) return 0;
  return roundMm(screenPx / (PX_PER_MM * zoom));
}
