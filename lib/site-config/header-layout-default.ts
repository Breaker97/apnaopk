/**
 * The header design a store gets before anyone opens the studio, and the
 * builders every preset is assembled from.
 *
 * Split from the layout model on purpose: the storefront header normalizes
 * a stored layout and falls back to THIS design, so it must not import the
 * studio's whole gallery (header-layout-presets.ts) to do so.
 */

import {
  createHeaderColumn,
  createHeaderItem,
  createHeaderRow,
  defaultTextStyle,
  glyphIcon,
  newId,
  normalizeHeaderLayout,
  solidBackground,
  type HeaderCategoriesItem,
  type HeaderIconsItem,
  type HeaderLayout,
  type HeaderLayoutColumn,
  type HeaderLayoutItem,
  type HeaderNavItem,
  type HeaderNavLink,
  type HeaderSearchIconItem,
  type HeaderUserItem,
} from "@/lib/site-config/header-layout";

export function itemWith<T extends HeaderLayoutItem>(
  type: T["type"],
  overrides: Partial<T> = {},
): T {
  return { ...(createHeaderItem(type) as T), ...overrides };
}

export function column(
  items: HeaderLayoutItem[],
  overrides: Partial<Omit<HeaderLayoutColumn, "id" | "items">> = {},
) {
  return createHeaderColumn({ ...overrides, items });
}

type PresetLink = [label: string, url: string, icon?: string];

export const PRESET_NAV_LABELS: PresetLink[] = [
  ["Collections", "/collections"],
  ["Phone", "/products?category=phone"],
  ["Camera", "/products?category=camera"],
  ["Shoe", "/products?category=shoe"],
  ["Bags", "/products?category=bags"],
  ["Cosmetics", "/products?category=cosmetics"],
];

/** The trending strip: what shoppers are looking for this week. */
const PRESET_TAG_LINKS: PresetLink[] = [
  ["Mobile Phones", "/products?category=mobile-phones"],
  ["Accessories", "/products?category=accessories"],
  ["Gaming", "/products?category=gaming"],
  ["Cameras & Smart Home", "/products?category=cameras"],
  ["Appliances", "/products?category=appliances"],
];

/** The links a store keeps at hand but out of the way. */
const PRESET_UTILITY_LINKS: PresetLink[] = [
  ["Track Order", "/track-order", glyphIcon("package")],
  ["Blog", "/blog", glyphIcon("rss")],
  ["Contact Us", "/contact"],
  ["Become a Vendor", "/become-vendor"],
];

export function presetLinks(
  labels: PresetLink[] = PRESET_NAV_LABELS,
): HeaderNavLink[] {
  const child = (
    childLabel: string,
    childUrl: string,
  ): HeaderNavLink => ({
    id: newId(),
    label: childLabel,
    url: childUrl,
    icon: "",
    description: "",
    menu: "list",
    megaMenu: "",
    children: [],
  });
  return labels.map(([label, url, icon]) => ({
    id: newId(),
    label,
    url,
    icon: icon ?? "",
    description: "",
    // Collections is the showcase menu out of the box: its entries carry
    // artwork, so the grid is the design that shows it.
    menu: label === "Collections" ? "grid" : "list",
    megaMenu: "",
    // "Collections" drops a menu in every design; the two entries give the
    // preview its chevron and the merchant a shape to fill in.
    children:
      label === "Collections"
        ? [
            child("New arrivals", "/collections/new"),
            child("Best sellers", "/collections/best"),
          ]
        : [],
  }));
}

export function navItem(overrides: Partial<HeaderNavItem> = {}) {
  return itemWith<HeaderNavItem>("nav", {
    links: presetLinks(),
    ...overrides,
  });
}

/** The compact capsule search the one-row designs use in place of a bar. */
export function searchPill() {
  return itemWith<HeaderSearchIconItem>("searchIcon", {
    style: "pill",
    size: 16,
    roundness: 10,
    background: solidBackground("#3a3a3a"),
    foreground: solidBackground("#ffffff"),
  });
}

/** The account glyph with no greeting beside it. */
export function userIcon() {
  return itemWith<HeaderUserItem>("user", { showLabel: false });
}

export function cart() {
  return itemWith<HeaderIconsItem>("icons", { keys: ["cart"], size: 22 });
}

export function categories(overrides: Partial<HeaderCategoriesItem> = {}) {
  return itemWith<HeaderCategoriesItem>("categories", overrides);
}

/**
 * The strip under a store's header: trending tags at the start, the
 * utility links — order tracking, blog, contact, vendor sign-up — at the
 * end, in a quieter type than the nav above it. It used to be a pinned row
 * of its own kind; it is two Nav Links items in an ordinary row now, so a
 * merchant can restyle, reorder or drop it like anything else.
 */
export function utilityRow() {
  const quiet = defaultTextStyle({
    fontSize: 13,
    fontWeight: 500,
    fill: solidBackground("#6b7280"),
  });
  return createHeaderRow(
    2,
    { height: 40, gap: 24, background: solidBackground("#fafafa") },
    [
      column(
        [navItem({ gap: 24, textStyle: quiet, links: presetLinks(PRESET_TAG_LINKS) })],
        { width: 1 },
      ),
      column(
        [
          navItem({
            justify: "end",
            gap: 28,
            textStyle: quiet,
            links: presetLinks(PRESET_UTILITY_LINKS),
          }),
        ],
        { width: 1, justify: "end" },
      ),
    ],
  );
}

/** "Menu first" — the electronics storefront's own header. */
export function buildMenuFirstLayout(): HeaderLayout {
  return {
    rows: [
      createHeaderRow(3, { height: 72 }, [
        column([itemWith("brand")], { width: 1 }),
        column([navItem({ justify: "center", gap: 32 })], {
          width: 2.6,
          justify: "center",
        }),
        column([userIcon(), cart()], { width: 1, justify: "end", gap: 20 }),
      ]),
      createHeaderRow(2, { height: 64, gap: 16 }, [
        column([categories({ width: 250 })], { width: 1 }),
        column([itemWith("searchBar")], { width: 3.2 }),
      ]),
      utilityRow(),
    ],
  };
}

export const DEFAULT_HEADER_LAYOUT_PRESET = "nav-top";

export function getDefaultHeaderLayout(): HeaderLayout {
  return buildMenuFirstLayout();
}

/**
 * A stored layout, normalized, or the default design when the document has
 * no rows — an empty tree would render a header with nothing in it.
 */
export function resolveHeaderLayout(value: unknown): HeaderLayout {
  const layout = normalizeHeaderLayout(value);
  return layout.rows.length ? layout : getDefaultHeaderLayout();
}
