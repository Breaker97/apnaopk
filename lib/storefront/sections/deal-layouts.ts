/**
 * The arrangements a deals panel can lay its products out in.
 *
 * Layouts are data, not code, for the same reason the promotion grid's are:
 * a merchant picking "three deals" should get exactly that, and adding a
 * fourth shape should not mean a fourth component. Each layout names how
 * many slots it holds and which of them, if any, is the FEATURED slot — the
 * large mini-PDP card with gallery, swatches and an add-to-cart — while the
 * rest are compact cards.
 *
 * Products fill slots in pick order, so switching layouts keeps every pick;
 * the ones past the new slot count simply wait unused.
 */
export interface DealLayout {
  key: string;
  /** English fallback; the UI looks up `admin.storeBuilder.countdown.layouts.<key>`. */
  label: string;
  /** How many products the layout shows. */
  slots: number;
  /** Index of the featured (large) slot, or null when every card is compact. */
  hero: number | null;
  /**
   * Desktop grid: one named area per slot, in slot order. Rows are `1fr`
   * tracks, not `auto`: in a content-height grid they size to the cards
   * exactly as auto would, and when the panel is given more height than
   * its content needs they share it, so the cards grow with the panel
   * instead of leaving the field empty around them.
   */
  columns: string;
  rows: string;
  areas: string;
  slotAreas: string[];
}

export const DEAL_LAYOUTS: DealLayout[] = [
  {
    key: "featured-4",
    label: "Featured + 4",
    slots: 5,
    hero: 0,
    columns: "minmax(0,1fr) minmax(0,1.52fr) minmax(0,1fr)",
    rows: "minmax(0,1fr) minmax(0,1fr)",
    areas: '"b a d" "c a e"',
    slotAreas: ["a", "b", "c", "d", "e"],
  },
  {
    key: "featured-2",
    label: "Featured + 2",
    slots: 3,
    hero: 0,
    columns: "minmax(0,1.52fr) minmax(0,1fr)",
    rows: "minmax(0,1fr) minmax(0,1fr)",
    areas: '"a b" "a c"',
    slotAreas: ["a", "b", "c"],
  },
  {
    key: "featured-1",
    label: "Featured + 1",
    slots: 2,
    hero: 0,
    columns: "minmax(0,1.52fr) minmax(0,1fr)",
    rows: "minmax(0,1fr)",
    areas: '"a b"',
    slotAreas: ["a", "b"],
  },
  {
    key: "single",
    label: "One deal",
    slots: 1,
    hero: 0,
    columns: "minmax(0,1fr)",
    rows: "minmax(0,1fr)",
    areas: '"a"',
    slotAreas: ["a"],
  },
  {
    key: "pair",
    label: "Two deals",
    slots: 2,
    hero: null,
    columns: "repeat(2, minmax(0,1fr))",
    rows: "minmax(0,1fr)",
    areas: '"a b"',
    slotAreas: ["a", "b"],
  },
  {
    key: "row-3",
    label: "Three deals",
    slots: 3,
    hero: null,
    columns: "repeat(3, minmax(0,1fr))",
    rows: "minmax(0,1fr)",
    areas: '"a b c"',
    slotAreas: ["a", "b", "c"],
  },
  {
    key: "row-4",
    label: "Four deals",
    slots: 4,
    hero: null,
    columns: "repeat(4, minmax(0,1fr))",
    rows: "minmax(0,1fr)",
    areas: '"a b c d"',
    slotAreas: ["a", "b", "c", "d"],
  },
  {
    key: "row-5",
    label: "Five deals",
    slots: 5,
    hero: null,
    columns: "repeat(5, minmax(0,1fr))",
    rows: "minmax(0,1fr)",
    areas: '"a b c d e"',
    slotAreas: ["a", "b", "c", "d", "e"],
  },
];

/** The design's own arrangement, and what every stored panel renders. */
export const DEFAULT_DEAL_LAYOUT = "featured-4";

/** The most products any layout takes — the picker's cap. */
export const MAX_DEAL_SLOTS = Math.max(...DEAL_LAYOUTS.map((l) => l.slots));

export function getDealLayout(key: unknown): DealLayout {
  return (
    DEAL_LAYOUTS.find((layout) => layout.key === key) ??
    DEAL_LAYOUTS.find((layout) => layout.key === DEFAULT_DEAL_LAYOUT)!
  );
}
