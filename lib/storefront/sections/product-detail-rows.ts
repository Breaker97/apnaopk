/**
 * The Minimal product page's row vocabulary — shared by the storefront
 * renderer (product-main's "minimal" design) and the admin "Order" editor,
 * so both always agree on what a row key means.
 *
 * Rows are arranged in GROUPS: the storefront draws a hairline between
 * groups (the Figma's divided info column), and the admin editor lets the
 * merchant drag rows between groups, toggle them, and add/remove groups.
 *
 * The configuration is stored as a JSON string in the section's `rows` text
 * setting — the field vocabulary has no structured type, and a text field
 * rides the existing normalize/write/migrate machinery untouched.
 *
 * This module must stay CLIENT-SAFE and pure (no server imports).
 */

export const PRODUCT_DETAIL_ROWS = [
  "breadcrumb",
  "brand",
  "title",
  "rating",
  "vendor",
  "price",
  "variants",
  "quantity-cart",
  "description",
  "details",
  "faq",
  "info-card",
  "share",
  "chat",
  // Layout rows: they carry no product data, only space or a rule, and
  // each can appear any number of times.
  "gap",
  "divider",
] as const;

export type ProductDetailRow = (typeof PRODUCT_DETAIL_ROWS)[number];

/**
 * Rows a page may use more than once. Every other row is a piece of the
 * product — its price, its title — and appears at most once; a gap or a line
 * is spacing, and a layout may want several.
 */
export const REPEATABLE_PRODUCT_DETAIL_ROWS: ReadonlySet<ProductDetailRow> =
  new Set<ProductDetailRow>(["gap", "divider"]);

/** English fallbacks; the admin overlays `admin.storeBuilder.productRows.<key>`. */
export const PRODUCT_DETAIL_ROW_LABELS: Record<ProductDetailRow, string> = {
  breadcrumb: "Breadcrumb",
  brand: "Brand",
  title: "Product Name",
  rating: "Rating",
  vendor: "Sold by",
  price: "Price",
  variants: "Variants",
  "quantity-cart": "Add to Cart",
  description: "Description",
  details: "Technical Details",
  faq: "FAQ",
  "info-card": "Delivery info",
  share: "Share",
  chat: "Chat",
  gap: "Gap",
  divider: "Horizontal line",
};

export interface ProductDetailRowItem {
  /**
   * Stable id for drag-and-drop identity. A once-only row's id IS its key,
   * so documents saved before rows had ids parse to exactly the same items.
   */
  id: string;
  key: ProductDetailRow;
  on: boolean;
  /** gap: the height, px. divider: the line's thickness, px. */
  size?: number;
  /** divider: the line's colour; "" = the theme's border colour. */
  color?: string;
  /** divider: the space above and below the line, px. */
  spacing?: number;
}

export interface ProductDetailRowGroup {
  /** Stable id for drag-and-drop identity; persisted with the config. */
  id: string;
  items: ProductDetailRowItem[];
}

/** The settings a freshly added layout row starts with, and their bounds. */
export const PRODUCT_DETAIL_ROW_SETTINGS = {
  gap: { size: { default: 24, min: 0, max: 200 } },
  divider: {
    size: { default: 1, min: 1, max: 8 },
    spacing: { default: 16, min: 0, max: 80 },
  },
} as const;

/** The Figma arrangement: heading block / price / variants / CTA / … */
export const DEFAULT_PRODUCT_DETAIL_GROUPS: ProductDetailRowGroup[] = [
  {
    id: "g1",
    items: [
      { id: "breadcrumb", key: "breadcrumb", on: true },
      { id: "brand", key: "brand", on: true },
      { id: "title", key: "title", on: true },
      { id: "rating", key: "rating", on: true },
      // Renders only in multi-vendor mode for third-party sellers, so a
      // single-vendor store showing the default arrangement loses nothing.
      { id: "vendor", key: "vendor", on: true },
    ],
  },
  { id: "g2", items: [{ id: "price", key: "price", on: true }] },
  { id: "g3", items: [{ id: "variants", key: "variants", on: true }] },
  { id: "g4", items: [{ id: "quantity-cart", key: "quantity-cart", on: true }] },
  {
    id: "g5",
    items: [
      { id: "description", key: "description", on: true },
      { id: "details", key: "details", on: true },
      { id: "faq", key: "faq", on: true },
    ],
  },
  {
    id: "g6",
    items: [
      { id: "info-card", key: "info-card", on: true },
      { id: "share", key: "share", on: true },
    ],
  },
];

const ROW_SET = new Set<string>(PRODUCT_DETAIL_ROWS);

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const number =
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/** A colour the storefront can paint inline; anything else is "" (the theme's). */
function readColor(value: unknown): string {
  if (typeof value !== "string") return "";
  const color = value.trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)
    ? color
    : "";
}

/** A layout row's settings, filled from the defaults and clamped to bounds. */
export function withProductDetailRowSettings(
  item: Pick<ProductDetailRowItem, "id" | "key" | "on"> &
    Partial<ProductDetailRowItem>,
): ProductDetailRowItem {
  const base: ProductDetailRowItem = { id: item.id, key: item.key, on: item.on };
  if (item.key === "gap") {
    const { size } = PRODUCT_DETAIL_ROW_SETTINGS.gap;
    return { ...base, size: clamp(item.size, size.default, size.min, size.max) };
  }
  if (item.key === "divider") {
    const { size, spacing } = PRODUCT_DETAIL_ROW_SETTINGS.divider;
    return {
      ...base,
      size: clamp(item.size, size.default, size.min, size.max),
      spacing: clamp(item.spacing, spacing.default, spacing.min, spacing.max),
      color: readColor(item.color),
    };
  }
  return base;
}

/**
 * Stored JSON → validated groups. Every failure mode (not JSON, wrong
 * shape, unknown or duplicate keys) falls back to the default arrangement
 * or drops just the bad entry, so a stale document can never blank the
 * whole buy box.
 */
export function parseProductDetailGroups(raw: unknown): ProductDetailRowGroup[] {
  if (typeof raw !== "string" || !raw.trim()) {
    return DEFAULT_PRODUCT_DETAIL_GROUPS;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PRODUCT_DETAIL_GROUPS;
  }
  if (!Array.isArray(parsed)) return DEFAULT_PRODUCT_DETAIL_GROUPS;

  const seenKeys = new Set<string>();
  const seenIds = new Set<string>();
  const groups: ProductDetailRowGroup[] = [];
  for (const [index, entry] of parsed.entries()) {
    if (typeof entry !== "object" || entry === null) continue;
    const rawItems = (entry as { items?: unknown }).items;
    if (!Array.isArray(rawItems)) continue;
    const items: ProductDetailRowItem[] = [];
    for (const [itemIndex, item] of rawItems.entries()) {
      if (typeof item !== "object" || item === null) continue;
      const source = item as Record<string, unknown>;
      const key = source.key;
      if (typeof key !== "string" || !ROW_SET.has(key)) continue;
      const row = key as ProductDetailRow;
      const repeatable = REPEATABLE_PRODUCT_DETAIL_ROWS.has(row);
      if (!repeatable && seenKeys.has(row)) continue;
      seenKeys.add(row);

      // A once-only row is identified by its key; a repeatable one needs an
      // id of its own, and gets a positional one if the document lacks it.
      let id = repeatable
        ? typeof source.id === "string" && source.id
          ? source.id
          : `${row}-${index + 1}-${itemIndex + 1}`
        : row;
      while (seenIds.has(id)) id = `${id}-dup`;
      seenIds.add(id);

      items.push(
        withProductDetailRowSettings({
          id,
          key: row,
          on: source.on !== false,
          size: source.size as number | undefined,
          spacing: source.spacing as number | undefined,
          color: source.color as string | undefined,
        }),
      );
    }
    const id = (entry as { id?: unknown }).id;
    groups.push({
      id: typeof id === "string" && id ? id : `g${index + 1}`,
      items,
    });
  }
  // An arrangement with no content rows at all is a corrupt document, not a
  // choice — a page of nothing but gaps and lines has no buy box either.
  return groups.some((group) =>
    group.items.some((item) => !REPEATABLE_PRODUCT_DETAIL_ROWS.has(item.key)),
  )
    ? groups
    : DEFAULT_PRODUCT_DETAIL_GROUPS;
}

export const DEFAULT_PRODUCT_DETAIL_ROWS_JSON = JSON.stringify(
  DEFAULT_PRODUCT_DETAIL_GROUPS,
);

/** Groups → the visible rows per group, empty groups dropped. */
export function visibleProductDetailGroups(
  groups: ProductDetailRowGroup[],
): ProductDetailRowItem[][] {
  return groups
    .map((group) => group.items.filter((item) => item.on))
    .filter((items) => items.length > 0);
}
