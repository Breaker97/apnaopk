/**
 * The picture shapes the Looks row offers, as width and height. The row draws
 * them as CSS ratios and the shopper app's home sends them as numbers, so the
 * two always crop a Look the same way.
 */
const LOOK_SHAPES = {
  portrait: [4, 5],
  square: [1, 1],
  tall: [2, 3],
  landscape: [4, 3],
} as const satisfies Record<string, readonly [number, number]>;

export type LooksShape = keyof typeof LOOK_SHAPES;

/** A stored shape's width and height; portrait for anything unknown. */
export function lookShape(shape: unknown): readonly [number, number] {
  return LOOK_SHAPES[shape as LooksShape] ?? LOOK_SHAPES.portrait;
}
