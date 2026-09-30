import {
  inheritFill,
  newId,
  type HeaderAlignment,
  type HeaderBackground,
  type HeaderFill,
  type HeaderJustify,
  type HeaderPadding,
} from "@/lib/site-config/header-layout";
import {
  readBoolean,
  readNumber,
  readOneOf,
  readString,
} from "@/lib/site-config/normalize-primitives";
import { normalizeBackground } from "@/lib/sliders/background";
import { isRecord } from "@/lib/utils";
import type { FooterSettings } from "@/lib/site-config/footer-config";

/**
 * The footer as a LAYOUT — rows of columns of items — rather than a fixed
 * set of slots with visibility toggles.
 *
 * The header has been a layout for a while: a merchant drags a search bar
 * into a column and gives that row its own background. The footer was still
 * seven booleans over a grid nobody could change, so "put the newsletter
 * beside the logo" or "give the legal strip its own colour" had no answer
 * at all. This is the same vocabulary, item kinds aside — deliberately, so
 * the two builders share their padding, alignment, background and fill
 * types and a merchant only learns the idea once.
 *
 * NOTHING here invents a design. `footerLayoutFromSettings` builds the
 * arrangement the footer already draws out of the settings a store already
 * has, so a shop that never opens the builder keeps the footer it had and
 * one that does opens on it rather than on a blank canvas.
 */

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

export const FOOTER_ITEM_KINDS = [
  "brand",
  "text",
  "contact",
  "social",
  "links",
  "copyright",
  "payments",
] as const;
export type FooterItemKind = (typeof FOOTER_ITEM_KINDS)[number];

interface FooterItemBase {
  id: string;
  padding: HeaderPadding;
}

/** The store's logo, sized by width as the header sizes its own. */
export interface FooterBrandItem extends FooterItemBase {
  type: "brand";
  /** px; 0 follows the header's logo size on every screen. */
  size: number;
}

/** A paragraph: the about line, or anything else the merchant writes. */
export interface FooterTextItem extends FooterItemBase {
  type: "text";
  text: string;
  fill: HeaderFill;
}

/** Phone, email and address, each shown only when it has a value. */
export interface FooterContactItem extends FooterItemBase {
  type: "contact";
  title: string;
  showPhone: boolean;
  showEmail: boolean;
  showAddress: boolean;
}

/** The social icon row; the URLs themselves stay in the footer settings. */
export interface FooterSocialItem extends FooterItemBase {
  type: "social";
  title: string;
}

/**
 * One titled column of links. `menu` names a reusable menu from Navigation,
 * exactly as the legacy link column did; without one it keeps its own list.
 */
export interface FooterLinksItem extends FooterItemBase {
  type: "links";
  title: string;
  menu: string;
  links: { id: string; label: string; url: string }[];
}

export interface FooterCopyrightItem extends FooterItemBase {
  type: "copyright";
  text: string;
  showYear: boolean;
  showStoreName: boolean;
}

export interface FooterPaymentsItem extends FooterItemBase {
  type: "payments";
  imageUrl: string;
  imageAlt: string;
}

export type FooterLayoutItem =
  | FooterBrandItem
  | FooterTextItem
  | FooterContactItem
  | FooterSocialItem
  | FooterLinksItem
  | FooterCopyrightItem
  | FooterPaymentsItem;

/* ------------------------------------------------------------------ */
/* Columns and rows                                                    */
/* ------------------------------------------------------------------ */

export const FOOTER_COLUMN_FLOWS = ["stack", "row"] as const;
export type FooterColumnFlow = (typeof FOOTER_COLUMN_FLOWS)[number];

export interface FooterLayoutColumn {
  id: string;
  /** Track share, in `fr` units, of the row width. */
  width: number;
  /**
   * Whether the column's items sit under each other or beside each other.
   * The legal strip needs "row": the payment marks and the social icons
   * share one end of it, which stacking them would break.
   */
  flow: FooterColumnFlow;
  justify: HeaderJustify;
  align: HeaderAlignment;
  /** Space between the column's items, px. */
  gap: number;
  items: FooterLayoutItem[];
}

export interface FooterLayoutRow {
  id: string;
  align: HeaderAlignment;
  background: HeaderBackground;
  foreground: HeaderFill;
  /** Space between the row's columns, px. */
  gap: number;
  /** The row's own inset, px. */
  padding: HeaderPadding;
  /**
   * A rule along the row's TOP edge, px; 0 for none. The footer's divider
   * sits above its legal strip, which is why this is the top and not the
   * bottom the header states.
   */
  borderTop: number;
  borderColor: string;
  columns: FooterLayoutColumn[];
}

export interface FooterLayout {
  rows: FooterLayoutRow[];
}

export const MAX_FOOTER_ROWS = 6;
export const MAX_FOOTER_COLUMNS = 6;
export const MAX_FOOTER_ITEMS_PER_COLUMN = 8;
export const MAX_FOOTER_PADDING = 160;

const ALIGNMENTS = ["start", "center", "end"] as const;
const JUSTIFIES = ["start", "center", "end", "between"] as const;

function padding(top = 0, right = top, bottom = top, left = right): HeaderPadding {
  return { top, right, bottom, left };
}

function alignment(
  horizontal: HeaderAlignment["horizontal"] = "start",
  vertical: HeaderAlignment["vertical"] = "start",
): HeaderAlignment {
  return { horizontal, vertical };
}

/* ------------------------------------------------------------------ */
/* Making one                                                          */
/* ------------------------------------------------------------------ */

/** A new item of a kind, with the defaults that make it draw something. */
export function createFooterItem(kind: FooterItemKind): FooterLayoutItem {
  const base = { id: newId(), padding: padding(0) };
  switch (kind) {
    case "brand":
      return { ...base, type: "brand", size: 0 };
    case "text":
      return { ...base, type: "text", text: "", fill: inheritFill() };
    case "contact":
      return {
        ...base,
        type: "contact",
        title: "",
        showPhone: true,
        showEmail: true,
        showAddress: true,
      };
    case "social":
      return { ...base, type: "social", title: "" };
    case "links":
      return { ...base, type: "links", title: "", menu: "", links: [] };
    case "copyright":
      return { ...base, type: "copyright", text: "", showYear: true, showStoreName: true };
    case "payments":
      return { ...base, type: "payments", imageUrl: "", imageAlt: "" };
  }
}

export function createFooterColumn(width = 1): FooterLayoutColumn {
  return {
    id: newId(),
    width,
    flow: "stack",
    justify: "start",
    align: alignment("start", "start"),
    gap: 12,
    items: [],
  };
}

export function createFooterRow(columns = 3): FooterLayoutRow {
  return {
    id: newId(),
    align: alignment("start", "start"),
    background: inheritFill(),
    foreground: inheritFill(),
    gap: 32,
    padding: padding(48, 0),
    borderTop: 0,
    borderColor: "",
    columns: Array.from({ length: columns }, () => createFooterColumn()),
  };
}

/* ------------------------------------------------------------------ */
/* Reading a stored layout                                             */
/* ------------------------------------------------------------------ */

function normalizePadding(value: unknown, fallback: HeaderPadding): HeaderPadding {
  const source = isRecord(value) ? value : {};
  const side = (key: keyof HeaderPadding) =>
    readNumber(source[key], fallback[key], 0, MAX_FOOTER_PADDING);
  return { top: side("top"), right: side("right"), bottom: side("bottom"), left: side("left") };
}

function normalizeAlignment(value: unknown, fallback: HeaderAlignment): HeaderAlignment {
  const source = isRecord(value) ? value : {};
  return {
    horizontal: readOneOf(source.horizontal, ALIGNMENTS, fallback.horizontal),
    vertical: readOneOf(source.vertical, ALIGNMENTS, fallback.vertical),
  };
}

/**
 * A background or fill, kept as the slide-background shape the header uses
 * so a footer row can take a solid, a gradient or a picture without a
 * second vocabulary. Anything unreadable falls back to "inherit".
 */
function normalizeSurface(value: unknown, fallback: HeaderBackground): HeaderBackground {
  return isRecord(value) ? normalizeBackground(value) : fallback;
}

function normalizeItem(value: unknown): FooterLayoutItem | null {
  const source = isRecord(value) ? value : {};
  const kind = readOneOf(source.type, FOOTER_ITEM_KINDS, "text");
  const base = { id: readString(source.id, "") || newId(), padding: normalizePadding(source.padding, padding(0)) };
  switch (kind) {
    case "brand":
      return { ...base, type: "brand", size: readNumber(source.size, 0, 0, 400) };
    case "text":
      return {
        ...base,
        type: "text",
        text: readString(source.text, ""),
        fill: isRecord(source.fill) ? normalizeBackground(source.fill) : inheritFill(),
      };
    case "contact":
      return {
        ...base,
        type: "contact",
        title: readString(source.title, ""),
        showPhone: readBoolean(source.showPhone, true),
        showEmail: readBoolean(source.showEmail, true),
        showAddress: readBoolean(source.showAddress, true),
      };
    case "social":
      return { ...base, type: "social", title: readString(source.title, "") };
    case "links":
      return {
        ...base,
        type: "links",
        title: readString(source.title, ""),
        menu: readString(source.menu, ""),
        links: Array.isArray(source.links)
          ? source.links.slice(0, 40).flatMap((link) => {
              const entry = isRecord(link) ? link : {};
              const label = readString(entry.label, "");
              if (!label) return [];
              return [
                {
                  id: readString(entry.id, "") || newId(),
                  label,
                  url: readString(entry.url, ""),
                },
              ];
            })
          : [],
      };
    case "copyright":
      return {
        ...base,
        type: "copyright",
        text: readString(source.text, ""),
        showYear: readBoolean(source.showYear, true),
        showStoreName: readBoolean(source.showStoreName, true),
      };
    case "payments":
      return {
        ...base,
        type: "payments",
        imageUrl: readString(source.imageUrl, ""),
        imageAlt: readString(source.imageAlt, ""),
      };
  }
  return null;
}

function normalizeColumn(value: unknown): FooterLayoutColumn {
  const source = isRecord(value) ? value : {};
  return {
    id: readString(source.id, "") || newId(),
    width: readNumber(source.width, 1, 1, 12),
    flow: readOneOf(source.flow, FOOTER_COLUMN_FLOWS, "stack"),
    justify: readOneOf(source.justify, JUSTIFIES, "start"),
    align: normalizeAlignment(source.align, alignment()),
    gap: readNumber(source.gap, 12, 0, 80),
    items: Array.isArray(source.items)
      ? source.items
          .slice(0, MAX_FOOTER_ITEMS_PER_COLUMN)
          .map(normalizeItem)
          .filter((item): item is FooterLayoutItem => item !== null)
      : [],
  };
}

function normalizeRow(value: unknown): FooterLayoutRow {
  const source = isRecord(value) ? value : {};
  return {
    id: readString(source.id, "") || newId(),
    align: normalizeAlignment(source.align, alignment("start", "start")),
    background: normalizeSurface(source.background, inheritFill()),
    foreground: normalizeSurface(source.foreground, inheritFill()),
    gap: readNumber(source.gap, 32, 0, 120),
    padding: normalizePadding(source.padding, padding(48, 0)),
    borderTop: readNumber(source.borderTop, 0, 0, 8),
    borderColor: readString(source.borderColor, ""),
    columns: Array.isArray(source.columns)
      ? source.columns.slice(0, MAX_FOOTER_COLUMNS).map(normalizeColumn)
      : [],
  };
}

/** A stored footer layout, read for use. An empty one means "not built yet". */
export function normalizeFooterLayout(value: unknown): FooterLayout {
  const source = isRecord(value) ? value : {};
  return {
    rows: Array.isArray(source.rows)
      ? source.rows.slice(0, MAX_FOOTER_ROWS).map(normalizeRow)
      : [],
  };
}

export function footerLayoutIsEmpty(layout: FooterLayout): boolean {
  return layout.rows.length === 0;
}

/* ------------------------------------------------------------------ */
/* The layout a store already has                                      */
/* ------------------------------------------------------------------ */

/**
 * The footer the settings already describe, as a layout.
 *
 * This is what makes the builder open on the merchant's own footer rather
 * than on an empty canvas, and it is why nothing changes for a store that
 * never opens it: the arrangement below IS the one `store-footer.tsx`
 * draws — a six-track row with the brand across two of them and the link
 * columns filling the rest, then a divider and a legal strip carrying the
 * copyright, the payment marks and the social icons.
 *
 * Widget toggles become presence: a hidden widget is simply not an item, so
 * the builder has one way to say "not shown" instead of two.
 */
export function footerLayoutFromSettings(settings: FooterSettings): FooterLayout {
  const { widgets } = settings;

  const brandItems: FooterLayoutItem[] = [];
  if (widgets.showLogo) {
    brandItems.push({ id: newId(), type: "brand", size: settings.brand.logoSize, padding: padding(0) });
  }
  if (widgets.showDescription) {
    // The text may be EMPTY, and that is not the same as absent: an empty
    // footer description falls back to the store's own, which is what the
    // footer has always shown. Dropping the item here would have dropped
    // that line from every store that never wrote a footer-specific one.
    brandItems.push({
      id: newId(),
      type: "text",
      text: settings.brand.description,
      fill: inheritFill(),
      padding: padding(0),
    });
  }
  if (widgets.showContact) {
    brandItems.push({
      id: newId(),
      type: "contact",
      title: settings.contact.title,
      showPhone: settings.contact.showPhone,
      showEmail: settings.contact.showEmail,
      showAddress: settings.contact.showAddress,
      padding: padding(0),
    });
  }

  const columns: FooterLayoutColumn[] = [
    {
      id: newId(),
      // Two of the six tracks, which is the `col-span-2` the grid gives it.
      width: 2,
      flow: "stack",
      justify: "start",
      align: alignment("start", "start"),
      gap: 16,
      items: brandItems,
    },
  ];

  if (widgets.showLinkColumns) {
    for (const column of settings.linkColumns.slice(0, MAX_FOOTER_COLUMNS - 1)) {
      columns.push({
        id: newId(),
        width: 1,
        flow: "stack",
        justify: "start",
        align: alignment("start", "start"),
        gap: 12,
        items: [
          {
            id: newId(),
            type: "links",
            title: column.title,
            menu: column.menuHandle ?? "",
            links: (column.links ?? [])
              .filter((link) => link.visible !== false)
              .map((link) => ({ id: newId(), label: link.label, url: link.href })),
            padding: padding(0),
          },
        ],
      });
    }
  }

  const legal: FooterLayoutColumn[] = [];
  if (widgets.showCopyright) {
    legal.push({
      id: newId(),
      width: 1,
      flow: "stack",
      justify: "start",
      align: alignment("start", "center"),
      gap: 8,
      items: [
        {
          id: newId(),
          type: "copyright",
          text: settings.copyright.text,
          showYear: settings.copyright.showYear,
          showStoreName: settings.copyright.showStoreName,
          padding: padding(0),
        },
      ],
    });
  }
  // The payment marks and the social icons share the strip's right-hand
  // end — one flex group against `justify-between`, which is what the
  // footer draws. A column each would have centred the marks and moved them.
  const endItems: FooterLayoutItem[] = [];
  if (widgets.showPaymentMethods && settings.paymentMethods.enabled) {
    endItems.push({
      id: newId(),
      type: "payments",
      imageUrl: settings.paymentMethods.imageUrl,
      imageAlt: settings.paymentMethods.imageAlt,
      padding: padding(0),
    });
  }
  if (widgets.showSocialLinks) {
    endItems.push({ id: newId(), type: "social", title: settings.social.title, padding: padding(0) });
  }
  if (endItems.length > 0) {
    legal.push({
      id: newId(),
      width: 1,
      flow: "row",
      justify: "end",
      align: alignment("end", "center"),
      gap: 16,
      items: endItems,
    });
  }

  const rows: FooterLayoutRow[] = [];
  if (columns.some((column) => column.items.length > 0)) {
    rows.push({
      id: newId(),
      align: alignment("start", "start"),
      background: inheritFill(),
      foreground: inheritFill(),
      gap: 32,
      // `py-12` on the content box, which is what the footer draws today.
      padding: padding(48, 0),
      borderTop: 0,
      borderColor: "",
      columns,
    });
  }
  if (legal.length > 0) {
    rows.push({
      id: newId(),
      align: alignment("start", "center"),
      background: inheritFill(),
      foreground: inheritFill(),
      gap: 16,
      // `py-6`, under the divider the footer already draws.
      padding: padding(24, 0),
      borderTop: 1,
      borderColor: "",
      columns: legal,
    });
  }
  return { rows };
}

/** The layout to render: the merchant's if they have built one, else theirs. */
export function resolveFooterLayout(
  stored: unknown,
  settings: FooterSettings,
): FooterLayout {
  const layout = normalizeFooterLayout(stored);
  return footerLayoutIsEmpty(layout) ? footerLayoutFromSettings(settings) : layout;
}
