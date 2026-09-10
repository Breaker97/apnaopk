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
] as const;

export type ProductDetailRow = (typeof PRODUCT_DETAIL_ROWS)[number];

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
};

interface ProductDetailRowItem {
  key: ProductDetailRow;
  on: boolean;
}

export interface ProductDetailRowGroup {
  /** Stable id for drag-and-drop identity; persisted with the config. */
  id: string;
  items: ProductDetailRowItem[];
}

/** The Figma arrangement: heading block / price / variants / CTA / … */
export const DEFAULT_PRODUCT_DETAIL_GROUPS: ProductDetailRowGroup[] = [
  {
    id: "g1",
    items: [
      { key: "breadcrumb", on: true },
      { key: "brand", on: true },
      { key: "title", on: true },
      { key: "rating", on: true },
      // Renders only in multi-vendor mode for third-party sellers, so a
      // single-vendor store showing the default arrangement loses nothing.
      { key: "vendor", on: true },
    ],
  },
  { id: "g2", items: [{ key: "price", on: true }] },
  { id: "g3", items: [{ key: "variants", on: true }] },
  { id: "g4", items: [{ key: "quantity-cart", on: true }] },
  {
    id: "g5",
    items: [
      { key: "description", on: true },
      { key: "details", on: true },
      { key: "faq", on: true },
    ],
  },
  {
    id: "g6",
    items: [
      { key: "info-card", on: true },
      { key: "share", on: true },
    ],
  },
];

const ROW_SET = new Set<string>(PRODUCT_DETAIL_ROWS);

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

  const seen = new Set<string>();
  const groups: ProductDetailRowGroup[] = [];
  for (const [index, entry] of parsed.entries()) {
    if (typeof entry !== "object" || entry === null) continue;
    const rawItems = (entry as { items?: unknown }).items;
    if (!Array.isArray(rawItems)) continue;
    const items: ProductDetailRowItem[] = [];
    for (const item of rawItems) {
      if (typeof item !== "object" || item === null) continue;
      const key = (item as { key?: unknown }).key;
      if (typeof key !== "string" || !ROW_SET.has(key) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      items.push({
        key: key as ProductDetailRow,
        on: (item as { on?: unknown }).on !== false,
      });
    }
    const id = (entry as { id?: unknown }).id;
    groups.push({
      id: typeof id === "string" && id ? id : `g${index + 1}`,
      items,
    });
  }
  // An arrangement with no rows at all is a corrupt document, not a choice.
  return groups.some((group) => group.items.length > 0)
    ? groups
    : DEFAULT_PRODUCT_DETAIL_GROUPS;
}

export const DEFAULT_PRODUCT_DETAIL_ROWS_JSON = JSON.stringify(
  DEFAULT_PRODUCT_DETAIL_GROUPS,
);

/** Groups → the visible row keys per group, empty groups dropped. */
export function visibleProductDetailGroups(
  groups: ProductDetailRowGroup[],
): ProductDetailRow[][] {
  return groups
    .map((group) =>
      group.items.filter((item) => item.on).map((item) => item.key),
    )
    .filter((keys) => keys.length > 0);
}
