/**
 * The Header Studio layout tree — the Figma "row / column / item" model.
 *
 * The header used to be one of six fixed templates plus a bag of toggles.
 * This is the free-form model behind the new studio: a stack of rows, each
 * row split into up to three columns, each column holding the header's
 * pieces (brand, nav, search, icons…) in order. A template is now just a
 * preset of this tree — see HEADER_LAYOUT_PRESETS — so picking one is an
 * ordinary edit the merchant can then take apart.
 *
 * Kept in `lib/site-config` next to header-config.ts because both the admin
 * studio and the storefront read it. The preset designs are in
 * header-layout-presets.ts and the one default in header-layout-default.ts.
 */

import { nanoid } from "nanoid";
import {
  readBoolean,
  readNumber,
  readOneOf,
  readString,
} from "@/lib/site-config/normalize-primitives";
import {
  normalizeBackground,
  type SlideBackground,
} from "@/lib/sliders/types";
import { isRecord } from "@/lib/utils";

/**
 * A row's or an item's background: a solid colour, a gradient, or an
 * uploaded image. The slider's contract, reused verbatim so the same picker
 * edits both. `{ type: "solid" }` with no colour means "inherit" — the
 * surface keeps whatever paint sits behind it.
 */
export type HeaderBackground = SlideBackground;

function inheritBackground(): HeaderBackground {
  return { type: "solid" };
}

export function solidBackground(color: string): HeaderBackground {
  return { type: "solid", color };
}

/**
 * A FOREGROUND fill: the same solid-or-gradient contract as a background,
 * minus the image mode the picker hides. Text paints a gradient by clipping
 * it to the glyphs (see fillTextCss); a glyph or a container that cannot
 * clip takes the gradient's first stop instead, the way an outlined button
 * already borrows its border colour.
 */
export type HeaderFill = HeaderBackground;

export function inheritFill(): HeaderFill {
  return { type: "solid" };
}

const HEADER_ITEM_TYPES = [
  "brand",
  "nav",
  "categories",
  "collections",
  "searchBar",
  "searchIcon",
  "buttons",
  "text",
  "icons",
  "user",
  "menuButton",
  "location",
] as const;
export type HeaderItemType = (typeof HEADER_ITEM_TYPES)[number];

export const HEADER_ALIGNMENTS = ["start", "center", "end"] as const;
export type HeaderAlign = (typeof HEADER_ALIGNMENTS)[number];

export const HEADER_JUSTIFY_VALUES = [
  "start",
  "center",
  "end",
  "between",
  "around",
  "evenly",
] as const;
export type HeaderJustify = (typeof HEADER_JUSTIFY_VALUES)[number];

export const HEADER_COLUMN_COUNTS = [1, 2, 3] as const;
export type HeaderColumnCount = (typeof HEADER_COLUMN_COUNTS)[number];

export const HEADER_TEXT_TRANSFORMS = [
  "none",
  "uppercase",
  "capitalize",
] as const;
type HeaderTextTransform = (typeof HEADER_TEXT_TRANSFORMS)[number];

export const HEADER_BRAND_THEMES = ["auto", "light", "dark"] as const;
type HeaderBrandTheme = (typeof HEADER_BRAND_THEMES)[number];

export const HEADER_BUTTON_VARIANTS = ["solid", "outline", "ghost"] as const;
type HeaderButtonVariant = (typeof HEADER_BUTTON_VARIANTS)[number];

/** The glyph on the All Categories button — the legacy trigger's three. */
export const HEADER_CATEGORIES_ICONS = ["menu", "grid", "list"] as const;
export type HeaderCategoriesIcon = (typeof HEADER_CATEGORIES_ICONS)[number];

/**
 * When the category panel shows. "always" keeps it dropped open under the
 * button — the marketplace sidebar — instead of waiting for the pointer.
 */
export const HEADER_CATEGORIES_OPEN_MODES = ["hover", "click", "always"] as const;
export type HeaderCategoriesOpenMode =
  (typeof HEADER_CATEGORIES_OPEN_MODES)[number];

/**
 * A search icon is either the bare glyph or a "pill": the glyph on a filled
 * button, set inside an outlined capsule the width of a short input — the
 * shorthand for a search bar on a header with no room for one.
 */
export const HEADER_SEARCH_ICON_STYLES = ["plain", "pill"] as const;
export type HeaderSearchIconStyle = (typeof HEADER_SEARCH_ICON_STYLES)[number];

/**
 * The utility glyphs an "Icons" item can show. The list is closed because
 * each key maps onto storefront behaviour the header already has — a
 * merchant picks from what can actually be wired up.
 */
export const HEADER_ICON_KEYS = [
  "theme",
  "wishlist",
  "cart",
  "compare",
  "contact",
  "language",
  "currency",
] as const;
export type HeaderIconKey = (typeof HEADER_ICON_KEYS)[number];

export interface HeaderTextStyle {
  fontSize: number;
  /** 100–900 in 100 steps; a number so CSS can take it directly. */
  fontWeight: number;
  letterSpacing: number;
  transform: HeaderTextTransform;
  italic: boolean;
  underline: boolean;
  /**
   * The type's own colour. It lives here rather than beside the background
   * because every panel that styles text already opens this editor — a
   * separate "Foreground" row for the same colour only invited the two to
   * disagree. `{ type: "solid" }` alone inherits.
   */
  fill: HeaderFill;
}

export interface HeaderPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface HeaderAlignment {
  horizontal: HeaderAlign;
  vertical: HeaderAlign;
}

/**
 * The built-in glyphs a link can carry instead of an uploaded image — the
 * ones utility links are drawn with everywhere: an order box, a feed, a
 * phone. Stored on the link as `glyph:<key>` so the one `icon` field holds
 * either kind and a document never needs to say which.
 */
export const HEADER_LINK_GLYPHS = [
  "package",
  "rss",
  "phone",
  "mail",
  "store",
  "help",
  "truck",
  "gift",
  "tag",
  "map-pin",
] as const;
export type HeaderLinkGlyph = (typeof HEADER_LINK_GLYPHS)[number];

const GLYPH_PREFIX = "glyph:";

export function glyphIcon(glyph: HeaderLinkGlyph): string {
  return `${GLYPH_PREFIX}${glyph}`;
}

/** The built-in glyph an icon value names, or null when it is an image. */
export function linkGlyph(icon: string): HeaderLinkGlyph | null {
  if (!icon.startsWith(GLYPH_PREFIX)) return null;
  const key = icon.slice(GLYPH_PREFIX.length);
  return HEADER_LINK_GLYPHS.includes(key as HeaderLinkGlyph)
    ? (key as HeaderLinkGlyph)
    : null;
}

/**
 * A nav link. One level of nesting is what the storefront renders as a
 * dropdown; a deeper tree is flattened by the normalizer rather than
 * rejected, so a paste from the full menu editor still lands.
 */
/**
 * How a link's sub-links are drawn when the dropdown opens. "list" is the
 * plain column of labels; "grid" is the showcase — every child as a tile
 * with its artwork and a line of copy, for a Collections or Shop menu where
 * the pictures ARE the navigation. A grid of unlabelled rows would be worse
 * than the list, so the tiles fall back to the label alone.
 */
export const HEADER_NAV_MENUS = ["list", "grid"] as const;
export type HeaderNavMenu = (typeof HEADER_NAV_MENUS)[number];

export interface HeaderNavLink {
  id: string;
  label: string;
  url: string;
  /** An uploaded image URL, or a built-in `glyph:<key>` — see linkGlyph. */
  icon: string;
  /** One line under the label in the grid design; ignored by the list. */
  description: string;
  /** The design this link's own dropdown uses. Meaningless without children. */
  menu: HeaderNavMenu;
  children: HeaderNavLink[];
}

interface HeaderNavButton {
  id: string;
  label: string;
  url: string;
}

interface HeaderItemBase {
  id: string;
  padding: HeaderPadding;
}

export interface HeaderBrandItem extends HeaderItemBase {
  type: "brand";
  /** Logo width in px — the same axis as header.brand.desktopLogoWidth. */
  size: number;
  /**
   * The width the logo shrinks to once the page has scrolled, animated;
   * 0 keeps it at `size`. The row it sits in compacts by the same ratio.
   */
  scrollSize: number;
  theme: HeaderBrandTheme;
}

export interface HeaderNavItem extends HeaderItemBase {
  type: "nav";
  justify: HeaderJustify;
  align: HeaderAlignment;
  gap: number;
  /** Link colour included — see HeaderTextStyle.fill. */
  textStyle: HeaderTextStyle;
  background: HeaderBackground;
  links: HeaderNavLink[];
}

export interface HeaderSearchBarItem extends HeaderItemBase {
  type: "searchBar";
  placeholder: string;
  roundness: number;
  borderThickness: number;
  height: number;
  /** Placeholder type, its colour included. */
  textStyle: HeaderTextStyle;
  background: HeaderBackground;
  border: string;
  /** Icon and affordance fill — the text's own colour is on textStyle. */
  foreground: HeaderFill;
  showCategoryFilter: boolean;
}

export interface HeaderSearchIconItem extends HeaderItemBase {
  type: "searchIcon";
  style: HeaderSearchIconStyle;
  size: number;
  /** The button's corners; in pill style the capsule has its own. */
  roundness: number;
  background: HeaderBackground;
  foreground: HeaderFill;
  /** Pill only: the capsule around the button. */
  width: number;
  pillRoundness: number;
  pillBackground: HeaderBackground;
  border: string;
  borderThickness: number;
}

/**
 * The dropped-open list under the All Categories button. Styled apart from
 * the button because the two are read at different moments: the button is
 * part of the header, the panel is a surface over the page.
 */
export interface HeaderCategoriesPanel {
  background: HeaderBackground;
  /** Entry text and glyphs; inherit takes the button's own label colour. */
  foreground: HeaderFill;
  /** 0 matches the button's width — the two read as one card. */
  width: number;
  /** Corners of the highlighted entry. */
  itemRoundness: number;
  showIcons: boolean;
  /** The plate under the hovered (or first) entry. */
  highlight: HeaderBackground;
}

/**
 * The "All Categories" trigger. Its contents are not configured here: it
 * opens the store's mega menu, the full category tree the menu builder
 * already maintains. What the item owns is the button and how the panel
 * appears.
 */
export interface HeaderCategoriesItem extends HeaderItemBase {
  type: "categories";
  label: string;
  showIcon: boolean;
  icon: HeaderCategoriesIcon;
  showChevron: boolean;
  openOn: HeaderCategoriesOpenMode;
  /** 0 fills the column the item sits in. */
  width: number;
  height: number;
  roundness: number;
  borderThickness: number;
  border: string;
  /** Label type, its colour included. */
  textStyle: HeaderTextStyle;
  background: HeaderBackground;
  /** Glyph and chevron fill; inherit takes the label colour. */
  foreground: HeaderFill;
  panel: HeaderCategoriesPanel;
}

/**
 * The Collections menu: a trigger that drops the store's OWN collections as
 * a thumbnail grid. Unlike a nav link's dropdown, nothing here is typed by
 * hand — the list is the catalogue, so a new collection appears in the
 * header the moment it is published.
 */
export interface HeaderCollectionsItem extends HeaderItemBase {
  type: "collections";
  label: string;
  showChevron: boolean;
  /** How many collections the panel shows, newest position first. */
  limit: number;
  /** Tiles per row in the panel. */
  columns: number;
  /** Draw each collection's description under its title. */
  showDescription: boolean;
  /** A "View all" row under the grid, linking to the collections page. */
  showViewAll: boolean;
  /** Label type, its colour included. */
  textStyle: HeaderTextStyle;
}

/** The hamburger: opens the storefront's full menu drawer. */
export interface HeaderMenuButtonItem extends HeaderItemBase {
  type: "menuButton";
  size: number;
  roundness: number;
  background: HeaderBackground;
  foreground: HeaderFill;
  showLabel: boolean;
  label: string;
}

/**
 * The shopper's "Deliver to" control, placed by hand.
 *
 * Optional: with no item in the tree the storefront still hangs the control
 * beside the search bar once shopper location is switched on (see
 * `headerLocationSlot`). Placing one moves it — and only one is honoured,
 * the first in reading order. It renders nothing while the store's shopper
 * location switch is off; the studio flips that switch on when the item is
 * added, so a dropped chip is never silently inert.
 */
export interface HeaderLocationItem extends HeaderItemBase {
  type: "location";
  /** Pin glyph size, px. */
  size: number;
  foreground: HeaderFill;
  /** The small line over the place ("Deliver to"). */
  showCaption: boolean;
  /** Custom caption; empty falls back to the translated "Deliver to". */
  caption: string;
}

export interface HeaderButtonsItem extends HeaderItemBase {
  type: "buttons";
  variant: HeaderButtonVariant;
  roundness: number;
  gap: number;
  /** Label type, its colour included. */
  textStyle: HeaderTextStyle;
  background: HeaderBackground;
  buttons: HeaderNavButton[];
}

export interface HeaderTextItem extends HeaderItemBase {
  type: "text";
  content: string;
  textStyle: HeaderTextStyle;
  background: HeaderBackground;
}

export interface HeaderIconsItem extends HeaderItemBase {
  type: "icons";
  keys: HeaderIconKey[];
  size: number;
  gap: number;
  foreground: HeaderFill;
  showLabels: boolean;
}

export interface HeaderUserItem extends HeaderItemBase {
  type: "user";
  size: number;
  foreground: HeaderFill;
  showLabel: boolean;
  /** The small line above the account name — "Welcome". */
  greeting: string;
  /** What a signed-out shopper reads — "Login / Register". */
  label: string;
}

export type HeaderLayoutItem =
  | HeaderBrandItem
  | HeaderNavItem
  | HeaderCategoriesItem
  | HeaderCollectionsItem
  | HeaderSearchBarItem
  | HeaderSearchIconItem
  | HeaderButtonsItem
  | HeaderTextItem
  | HeaderIconsItem
  | HeaderUserItem
  | HeaderMenuButtonItem
  | HeaderLocationItem;

export interface HeaderLayoutColumn {
  id: string;
  /** Track share, in `fr` units, of the row width. */
  width: number;
  /** 0 lets the column size to its content. */
  height: number;
  justify: HeaderJustify;
  align: HeaderAlignment;
  gap: number;
  items: HeaderLayoutItem[];
}

export interface HeaderLayoutRow {
  id: string;
  columnCount: HeaderColumnCount;
  align: HeaderAlignment;
  background: HeaderBackground;
  foreground: HeaderFill;
  /** 0 lets the row size to its tallest column. */
  height: number;
  /** Space between the row's columns, px. */
  gap: number;
  /**
   * A rule along the row's bottom edge, px; 0 for none. This is both the
   * divider between two rows and the line under the last one — a row owns
   * the edge beneath it, so one setting covers every place a line can go.
   */
  borderBottom: number;
  borderColor: string;
  /**
   * Blur what scrolls beneath the row, px; 0 for none. Shows through a
   * translucent (or unset) background — the frosted-glass header.
   */
  blur: number;
  /**
   * Tuck the row away once the page has scrolled, and bring it back at the
   * top: the utility strip a shopper needs on arrival but not while reading.
   */
  hideOnScroll: boolean;
  columns: HeaderLayoutColumn[];
}

export interface HeaderLayout {
  rows: HeaderLayoutRow[];
}

export const MAX_HEADER_ROWS = 6;
/**
 * The closest two columns may sit, px. A column can be floored at its
 * content's width (see rowGridStyle), where a smaller gap would let a search
 * bar filling its column run straight into the next column's icons.
 */
export const MIN_HEADER_ROW_GAP = 12;
const DEFAULT_HEADER_ROW_GAP = 24;
export const MAX_HEADER_ITEMS_PER_COLUMN = 6;
export const MAX_HEADER_NAV_LINKS = 24;
export const MAX_HEADER_BUTTONS = 4;

/**
 * Hidden columns are kept by the normalizer (see normalizeRow) but not
 * without bound — three shown is the whole space a row can render.
 */
const MAX_COLUMNS_KEPT = 3;
const MAX_PADDING = 120;
const MAX_DIMENSION = 400;

export function newId(): string {
  // nanoid, not crypto.randomUUID(): the latter is undefined outside a
  // secure context, and an admin opened over plain http (a buyer's LAN, a
  // fresh install before TLS) would throw on every "add item".
  return nanoid();
}

/**
 * A colour, or "" for "inherit from the row". Anything that is not a hex
 * literal, an rgb() call, or a keyword we recognise falls back rather than
 * reaching the storefront as an arbitrary CSS string.
 */
function color(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  if (/^(transparent|currentcolor|inherit)$/i.test(trimmed)) return trimmed;
  if (/^rgba?\(\s*[\d.,\s%/]+\)$/i.test(trimmed)) return trimmed;
  return fallback;
}

/**
 * A background, accepting the shape saved before backgrounds could be
 * gradients or images: a bare colour string (or "" for inherit). Anything
 * the slider contract would refuse falls back rather than reaching the
 * storefront.
 */
function normalizeBackgroundValue(
  value: unknown,
  fallback: HeaderBackground,
): HeaderBackground {
  if (typeof value === "string") {
    if (!value.trim()) return inheritBackground();
    const solid = color(value, "");
    return solid ? solidBackground(solid) : fallback;
  }
  if (isRecord(value)) return normalizeBackground(value);
  return fallback;
}

export function defaultTextStyle(
  overrides: Partial<HeaderTextStyle> = {},
): HeaderTextStyle {
  return {
    fontSize: 14,
    fontWeight: 500,
    letterSpacing: 0,
    transform: "none",
    italic: false,
    underline: false,
    fill: inheritFill(),
    ...overrides,
  };
}

function padding(
  top = 0,
  right = top,
  bottom = top,
  left = right,
): HeaderPadding {
  return { top, right, bottom, left };
}

function alignment(
  horizontal: HeaderAlign = "start",
  vertical: HeaderAlign = "center",
): HeaderAlignment {
  return { horizontal, vertical };
}

/**
 * `legacyFill` is the item's old `foreground` (or the search bar's old
 * `text`) colour: before the colour moved into the text editor those keys
 * were what painted the type, so a document saved then keeps its colour
 * instead of silently reverting to "inherit".
 */
function normalizeTextStyle(
  value: unknown,
  legacyFill: HeaderFill = inheritFill(),
): HeaderTextStyle {
  const source = isRecord(value) ? value : {};
  const base = defaultTextStyle();
  return {
    fontSize: readNumber(source.fontSize, base.fontSize, 8, 72, 2),
    fontWeight: readNumber(source.fontWeight, base.fontWeight, 100, 900, 2),
    letterSpacing: readNumber(source.letterSpacing, base.letterSpacing, -5, 20, 2),
    transform: readOneOf(source.transform, HEADER_TEXT_TRANSFORMS, base.transform),
    italic: readBoolean(source.italic, base.italic),
    underline: readBoolean(source.underline, base.underline),
    fill: normalizeBackgroundValue(source.fill, legacyFill),
  };
}

function normalizePadding(value: unknown, fallback = padding()): HeaderPadding {
  const source = isRecord(value) ? value : {};
  return {
    top: readNumber(source.top, fallback.top, 0, MAX_PADDING, 2),
    right: readNumber(source.right, fallback.right, 0, MAX_PADDING, 2),
    bottom: readNumber(source.bottom, fallback.bottom, 0, MAX_PADDING, 2),
    left: readNumber(source.left, fallback.left, 0, MAX_PADDING, 2),
  };
}

function normalizeAlignment(
  value: unknown,
  fallback = alignment(),
): HeaderAlignment {
  const source = isRecord(value) ? value : {};
  return {
    horizontal: readOneOf(
      source.horizontal,
      HEADER_ALIGNMENTS,
      fallback.horizontal,
    ),
    vertical: readOneOf(source.vertical, HEADER_ALIGNMENTS, fallback.vertical),
  };
}

function normalizeNavLinks(value: unknown, depth = 0): HeaderNavLink[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_HEADER_NAV_LINKS).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    return [
      {
        id: readString(entry.id, "") || newId(),
        label: readString(entry.label, "").slice(0, 120),
        url: readString(entry.url, "").slice(0, 500),
        icon: readString(entry.icon, "").slice(0, 1000),
        description: readString(entry.description, "").slice(0, 160),
        menu: readOneOf(entry.menu, HEADER_NAV_MENUS, "list"),
        // One level only: a grandchild renders nowhere, so it is dropped
        // here instead of riding along as dead data.
        children: depth === 0 ? normalizeNavLinks(entry.children, 1) : [],
      },
    ];
  });
}

function normalizeButtons(value: unknown): HeaderNavButton[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_HEADER_BUTTONS).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    return [
      {
        id: readString(entry.id, "") || newId(),
        label: readString(entry.label, "").slice(0, 120),
        url: readString(entry.url, "").slice(0, 500),
      },
    ];
  });
}

function normalizeIconKeys(value: unknown): HeaderIconKey[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<HeaderIconKey>();
  value.forEach((entry) => {
    if (HEADER_ICON_KEYS.includes(entry as HeaderIconKey)) {
      seen.add(entry as HeaderIconKey);
    }
  });
  return HEADER_ICON_KEYS.filter((key) => seen.has(key));
}

/** A fresh item of `type`, with the defaults the drawer drops in. */
export function createHeaderItem(type: HeaderItemType): HeaderLayoutItem {
  const id = newId();
  switch (type) {
    case "brand":
      return {
        id,
        type,
        padding: padding(0),
        size: 144,
        scrollSize: 0,
        theme: "auto",
      };
    case "nav":
      return {
        id,
        type,
        padding: padding(0),
        justify: "start",
        align: alignment("start", "center"),
        gap: 24,
        textStyle: defaultTextStyle(),
        background: inheritBackground(),
        links: [],
      };
    case "searchBar":
      return {
        id,
        type,
        padding: padding(0),
        placeholder: "Search products...",
        roundness: 999,
        borderThickness: 1,
        height: 40,
        textStyle: defaultTextStyle({ fontWeight: 400 }),
        background: solidBackground("#ffffff"),
        border: "#dddddd",
        foreground: inheritFill(),
        showCategoryFilter: true,
      };
    case "categories":
      return {
        id,
        type,
        padding: padding(0),
        label: "All Categories",
        showIcon: true,
        icon: "menu",
        showChevron: false,
        openOn: "hover",
        width: 0,
        height: 44,
        roundness: 6,
        borderThickness: 0,
        border: "",
        textStyle: defaultTextStyle({
          fontSize: 15,
          fontWeight: 600,
          fill: solidBackground("#ffffff"),
        }),
        background: solidBackground("#3b6ff5"),
        foreground: inheritFill(),
        panel: {
          background: solidBackground("#ffffff"),
          foreground: solidBackground("#111827"),
          width: 0,
          itemRoundness: 999,
          showIcons: true,
          highlight: solidBackground("#f1f1f1"),
        },
      };
    case "searchIcon":
      return {
        id,
        type,
        padding: padding(0),
        style: "plain",
        size: 20,
        roundness: 999,
        background: inheritBackground(),
        foreground: inheritFill(),
        width: 110,
        pillRoundness: 14,
        pillBackground: solidBackground("#ffffff"),
        border: "#c8c8c8",
        borderThickness: 1,
      };
    case "buttons":
      return {
        id,
        type,
        padding: padding(0),
        variant: "solid",
        roundness: 8,
        gap: 8,
        textStyle: defaultTextStyle({ fontWeight: 600 }),
        background: inheritBackground(),
        buttons: [{ id: newId(), label: "Become a Vendor", url: "/become-vendor" }],
      };
    case "text":
      return {
        id,
        type,
        padding: padding(0),
        content: "Free shipping on orders over $50",
        textStyle: defaultTextStyle(),
        background: inheritBackground(),
      };
    case "icons":
      return {
        id,
        type,
        padding: padding(0),
        keys: ["theme", "wishlist", "cart"],
        size: 20,
        gap: 16,
        foreground: inheritFill(),
        showLabels: false,
      };
    case "user":
      return {
        id,
        type,
        padding: padding(0),
        size: 20,
        foreground: inheritFill(),
        // The storefront's account control reads "Welcome / Login /
        // Register" — the greeting is the point of it, so it ships on.
        showLabel: true,
        greeting: "Welcome",
        label: "Login / Register",
      };
    case "collections":
      return {
        id,
        type,
        padding: padding(0),
        label: "Collections",
        showChevron: true,
        limit: 8,
        columns: 3,
        showDescription: true,
        showViewAll: true,
        textStyle: defaultTextStyle(),
      };
    case "menuButton":
      return {
        id,
        type,
        padding: padding(0),
        size: 22,
        roundness: 6,
        background: inheritBackground(),
        foreground: inheritFill(),
        showLabel: false,
        label: "Menu",
      };
    case "location":
      return {
        id,
        type,
        padding: padding(0),
        size: 18,
        foreground: inheritFill(),
        showCaption: true,
        caption: "",
      };
  }
}

function normalizeCategoriesPanel(
  value: unknown,
  base: HeaderCategoriesPanel,
): HeaderCategoriesPanel {
  const source = isRecord(value) ? value : {};
  return {
    background: normalizeBackgroundValue(source.background, base.background),
    foreground: normalizeBackgroundValue(source.foreground, base.foreground),
    width: readNumber(source.width, base.width, 0, 600, 2),
    itemRoundness: readNumber(source.itemRoundness, base.itemRoundness, 0, 999, 2),
    showIcons: readBoolean(source.showIcons, base.showIcons),
    highlight: normalizeBackgroundValue(source.highlight, base.highlight),
  };
}

function normalizeItem(value: unknown): HeaderLayoutItem | null {
  if (!isRecord(value)) return null;
  if (!HEADER_ITEM_TYPES.includes(value.type as HeaderItemType)) return null;

  const base = createHeaderItem(value.type as HeaderItemType);
  const id = readString(value.id, "") || base.id;
  const pad = normalizePadding(value.padding, base.padding);

  switch (base.type) {
    case "brand":
      return {
        id,
        type: "brand",
        padding: pad,
        size: readNumber(value.size, base.size, 16, MAX_DIMENSION, 2),
        scrollSize: readNumber(value.scrollSize, base.scrollSize, 0, MAX_DIMENSION, 2),
        theme: readOneOf(value.theme, HEADER_BRAND_THEMES, base.theme),
      };
    case "nav":
      return {
        id,
        type: "nav",
        padding: pad,
        justify: readOneOf(value.justify, HEADER_JUSTIFY_VALUES, base.justify),
        align: normalizeAlignment(value.align, base.align),
        gap: readNumber(value.gap, base.gap, 0, 80, 2),
        textStyle: normalizeTextStyle(
          value.textStyle,
          normalizeBackgroundValue(value.foreground, inheritFill()),
        ),
        background: normalizeBackgroundValue(value.background, base.background),
        links: normalizeNavLinks(value.links),
      };
    case "searchBar":
      return {
        id,
        type: "searchBar",
        padding: pad,
        placeholder: readString(value.placeholder, base.placeholder).slice(0, 120),
        roundness: readNumber(value.roundness, base.roundness, 0, 999, 2),
        borderThickness: readNumber(value.borderThickness, base.borderThickness, 0, 8, 2),
        height: readNumber(value.height, base.height, 24, 96, 2),
        textStyle: normalizeTextStyle(
          value.textStyle,
          normalizeBackgroundValue(value.text, inheritFill()),
        ),
        background: normalizeBackgroundValue(value.background, base.background),
        border: color(value.border, base.border),
        foreground: normalizeBackgroundValue(value.foreground, base.foreground),
        showCategoryFilter: readBoolean(
          value.showCategoryFilter,
          base.showCategoryFilter,
        ),
      };
    case "categories":
      return {
        id,
        type: "categories",
        padding: pad,
        label: readString(value.label, base.label).slice(0, 60),
        showIcon: readBoolean(value.showIcon, base.showIcon),
        icon: readOneOf(value.icon, HEADER_CATEGORIES_ICONS, base.icon),
        showChevron: readBoolean(value.showChevron, base.showChevron),
        openOn: readOneOf(value.openOn, HEADER_CATEGORIES_OPEN_MODES, base.openOn),
        width: readNumber(value.width, base.width, 0, 600, 2),
        height: readNumber(value.height, base.height, 0, 120, 2),
        roundness: readNumber(value.roundness, base.roundness, 0, 999, 2),
        borderThickness: readNumber(value.borderThickness, base.borderThickness, 0, 8, 2),
        border: color(value.border, base.border),
        textStyle: normalizeTextStyle(value.textStyle, base.textStyle.fill),
        background: normalizeBackgroundValue(value.background, base.background),
        foreground: normalizeBackgroundValue(value.foreground, base.foreground),
        panel: normalizeCategoriesPanel(value.panel, base.panel),
      };
    case "searchIcon":
      return {
        id,
        type: "searchIcon",
        padding: pad,
        style: readOneOf(value.style, HEADER_SEARCH_ICON_STYLES, base.style),
        size: readNumber(value.size, base.size, 12, 64, 2),
        roundness: readNumber(value.roundness, base.roundness, 0, 999, 2),
        background: normalizeBackgroundValue(value.background, base.background),
        foreground: normalizeBackgroundValue(value.foreground, base.foreground),
        width: readNumber(value.width, base.width, 40, 400, 2),
        pillRoundness: readNumber(value.pillRoundness, base.pillRoundness, 0, 999, 2),
        pillBackground: normalizeBackgroundValue(
          value.pillBackground,
          base.pillBackground,
        ),
        border: color(value.border, base.border),
        borderThickness: readNumber(value.borderThickness, base.borderThickness, 0, 8, 2),
      };
    case "buttons":
      return {
        id,
        type: "buttons",
        padding: pad,
        variant: readOneOf(value.variant, HEADER_BUTTON_VARIANTS, base.variant),
        roundness: readNumber(value.roundness, base.roundness, 0, 999, 2),
        gap: readNumber(value.gap, base.gap, 0, 40, 2),
        textStyle: normalizeTextStyle(
          value.textStyle,
          normalizeBackgroundValue(value.foreground, inheritFill()),
        ),
        background: normalizeBackgroundValue(value.background, base.background),
        buttons: normalizeButtons(value.buttons),
      };
    case "text":
      return {
        id,
        type: "text",
        padding: pad,
        content: readString(value.content, base.content).slice(0, 300),
        textStyle: normalizeTextStyle(
          value.textStyle,
          normalizeBackgroundValue(value.foreground, inheritFill()),
        ),
        background: normalizeBackgroundValue(value.background, base.background),
      };
    case "icons": {
      const keys = normalizeIconKeys(value.keys);
      return {
        id,
        type: "icons",
        padding: pad,
        // An empty pick would render nothing at all, which reads as a bug
        // rather than a choice — fall back to the default trio.
        keys: keys.length ? keys : base.keys,
        size: readNumber(value.size, base.size, 12, 64, 2),
        gap: readNumber(value.gap, base.gap, 0, 60, 2),
        foreground: normalizeBackgroundValue(value.foreground, base.foreground),
        showLabels: readBoolean(value.showLabels, base.showLabels),
      };
    }
    case "user":
      return {
        id,
        type: "user",
        padding: pad,
        size: readNumber(value.size, base.size, 12, 64, 2),
        foreground: normalizeBackgroundValue(value.foreground, base.foreground),
        showLabel: readBoolean(value.showLabel, base.showLabel),
        greeting: readString(value.greeting, base.greeting).slice(0, 60),
        label: readString(value.label, base.label).slice(0, 60),
      };
    case "collections":
      return {
        id,
        type: "collections",
        padding: pad,
        label: readString(value.label, base.label).slice(0, 60),
        showChevron: readBoolean(value.showChevron, base.showChevron),
        limit: readNumber(value.limit, base.limit, 1, 24, 2),
        columns: readNumber(value.columns, base.columns, 1, 4, 2),
        showDescription: readBoolean(value.showDescription, base.showDescription),
        showViewAll: readBoolean(value.showViewAll, base.showViewAll),
        textStyle: normalizeTextStyle(value.textStyle, base.textStyle.fill),
      };
    case "menuButton":
      return {
        id,
        type: "menuButton",
        padding: pad,
        size: readNumber(value.size, base.size, 12, 64, 2),
        roundness: readNumber(value.roundness, base.roundness, 0, 999, 2),
        background: normalizeBackgroundValue(value.background, base.background),
        foreground: normalizeBackgroundValue(value.foreground, base.foreground),
        showLabel: readBoolean(value.showLabel, base.showLabel),
        label: readString(value.label, base.label).slice(0, 40),
      };
    case "location":
      return {
        id,
        type: "location",
        padding: pad,
        size: readNumber(value.size, base.size, 12, 40, 2),
        foreground: normalizeBackgroundValue(value.foreground, base.foreground),
        showCaption: readBoolean(value.showCaption, base.showCaption),
        caption: readString(value.caption, base.caption).slice(0, 40),
      };
  }
}

export function createHeaderColumn(
  overrides: Partial<Omit<HeaderLayoutColumn, "id">> = {},
): HeaderLayoutColumn {
  return {
    id: newId(),
    width: 1,
    height: 0,
    justify: "start",
    align: alignment("start", "center"),
    gap: 16,
    items: [],
    ...overrides,
  };
}

export function createHeaderRow(
  columnCount: HeaderColumnCount = 3,
  overrides: Partial<Omit<HeaderLayoutRow, "id" | "columns">> = {},
  columns?: HeaderLayoutColumn[],
): HeaderLayoutRow {
  return {
    id: newId(),
    columnCount,
    align: alignment("start", "center"),
    background: inheritBackground(),
    foreground: inheritFill(),
    height: 0,
    gap: DEFAULT_HEADER_ROW_GAP,
    borderBottom: 0,
    borderColor: "#e5e7eb",
    blur: 0,
    hideOnScroll: false,
    ...overrides,
    columns:
      columns ?? Array.from({ length: columnCount }, () => createHeaderColumn()),
  };
}

function normalizeColumn(value: unknown): HeaderLayoutColumn {
  const source = isRecord(value) ? value : {};
  const base = createHeaderColumn();
  const items = Array.isArray(source.items)
    ? source.items
        .map(normalizeItem)
        .filter((item): item is HeaderLayoutItem => item !== null)
        .slice(0, MAX_HEADER_ITEMS_PER_COLUMN)
    : [];
  return {
    id: readString(source.id, "") || base.id,
    width: readNumber(source.width, base.width, 0.25, 12, 2),
    height: readNumber(source.height, base.height, 0, MAX_DIMENSION, 2),
    justify: readOneOf(source.justify, HEADER_JUSTIFY_VALUES, base.justify),
    align: normalizeAlignment(source.align, base.align),
    gap: readNumber(source.gap, base.gap, 0, 80, 2),
    items,
  };
}

/**
 * 0 was the row default before columns could sit at their content floor;
 * columns were never meant to touch, so a stored 0 takes today's default
 * and anything a merchant set stays, floored.
 */
function normalizeRowGap(value: unknown, fallback: number): number {
  const gap = readNumber(value, fallback, 0, 120, 2);
  return gap === 0 ? fallback : Math.max(MIN_HEADER_ROW_GAP, gap);
}

function normalizeRow(value: unknown): HeaderLayoutRow {
  const source = isRecord(value) ? value : {};
  const base = createHeaderRow();
  const count = HEADER_COLUMN_COUNTS.includes(
    source.columnCount as HeaderColumnCount,
  )
    ? (source.columnCount as HeaderColumnCount)
    : base.columnCount;
  const columns = Array.isArray(source.columns)
    ? source.columns.map(normalizeColumn)
    : [];

  // The stored column list is authoritative for content; `columnCount` only
  // decides how many are shown. Padding up keeps a row that gained a column
  // renderable, and the extras stay so a merchant who drops to two columns
  // and changes their mind does not lose the items.
  while (columns.length < count) columns.push(createHeaderColumn());

  return {
    id: readString(source.id, "") || base.id,
    columnCount: count,
    align: normalizeAlignment(source.align, base.align),
    background: normalizeBackgroundValue(source.background, base.background),
    foreground: normalizeBackgroundValue(source.foreground, base.foreground),
    height: readNumber(source.height, base.height, 0, MAX_DIMENSION, 2),
    gap: normalizeRowGap(source.gap, base.gap),
    borderBottom: readNumber(source.borderBottom, base.borderBottom, 0, 8, 2),
    borderColor: color(source.borderColor, base.borderColor),
    blur: readNumber(source.blur, base.blur, 0, 40, 2),
    hideOnScroll: readBoolean(source.hideOnScroll, base.hideOnScroll),
    columns: columns.slice(0, MAX_COLUMNS_KEPT),
  };
}

export function normalizeHeaderLayout(value: unknown): HeaderLayout {
  const source = isRecord(value) ? value : {};
  const rows = Array.isArray(source.rows)
    ? source.rows.slice(0, MAX_HEADER_ROWS).map(normalizeRow)
    : [];
  // Possibly empty: the default a store that never opened the studio gets
  // is a preset, and presets live in header-layout-default.ts so the
  // storefront bundle carries one design, not the studio's whole gallery.
  // `resolveHeaderLayout` there is the normalize-with-fallback callers want.
  return { rows };
}

/** The columns a row actually renders, honouring `columnCount`. */
export function visibleColumns(row: HeaderLayoutRow): HeaderLayoutColumn[] {
  return row.columns.slice(0, row.columnCount);
}

export function findHeaderItem(
  layout: HeaderLayout,
  itemId: string,
): {
  row: HeaderLayoutRow;
  column: HeaderLayoutColumn;
  item: HeaderLayoutItem;
} | null {
  for (const row of layout.rows) {
    for (const column of row.columns) {
      const item = column.items.find((entry) => entry.id === itemId);
      if (item) return { row, column, item };
    }
  }
  return null;
}

/**
 * Where the storefront paints the shopper-location control on a layout: a
 * placed `location` item, which renders it itself, or a host item it rides
 * beside.
 */
type HeaderLocationSlot = {
  type: "location" | "searchBar" | "searchIcon" | "icons";
  itemId: string;
};

/**
 * The item that carries the "Deliver to" control on desktop.
 *
 * A placed `location` item wins — that is the merchant saying exactly where
 * it goes — and only the first in reading order counts, so a layout cannot
 * paint two. Without one the control attaches to the piece a location
 * naturally sits next to — the search bar, as on every marketplace that has
 * one — and falls back through the compact search and then the first
 * utility-icon cluster on designs without a bar. That way flipping
 * `header.widgets.showLocationPicker` changes the header without a visit to
 * the builder. `null` on a layout with none of the four, where the phone strip
 * is the only place it renders.
 *
 * `showSearch` is the store's search switch: with search off the bar never
 * renders, so the control must not be attached to it.
 */
export function headerLocationSlot(
  layout: HeaderLayout,
  options: { showSearch: boolean },
): HeaderLocationSlot | null {
  const items = layout.rows.flatMap((row) =>
    visibleColumns(row).flatMap((column) => column.items),
  );
  const first = (type: HeaderLocationSlot["type"]) =>
    items.find((item) => item.type === type);

  const host =
    first("location") ??
    (options.showSearch
      ? (first("searchBar") ?? first("searchIcon") ?? first("icons"))
      : first("icons"));
  return host
    ? { type: host.type as HeaderLocationSlot["type"], itemId: host.id }
    : null;
}
