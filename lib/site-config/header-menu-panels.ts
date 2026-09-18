import type { HeaderMenuItem } from "@/lib/site-config/header-config";

/**
 * How a navigation menu reads when a header item borrows it — the side
 * drawer behind a menu button, or the full-width dropdown under a nav link.
 *
 * Both panels are authored as ordinary menus in Online Store → Menus, so a
 * merchant builds them with the editor they already know. What differs is
 * how the menu's SHAPE is read, and that reading lives here, pure, so the
 * storefront and its tests agree on it.
 */

export interface MegaDropdownColumn {
  title: string;
  /** The heading's own link; "" when the heading is only a label. */
  href: string;
  target?: HeaderMenuItem["target"];
  links: HeaderMenuItem[];
}

export interface MegaDropdownPromo {
  image: string;
  label: string;
  href: string;
  target?: HeaderMenuItem["target"];
}

export interface MegaDropdownLayout {
  columns: MegaDropdownColumn[];
  promos: MegaDropdownPromo[];
}

/** Past this the panel stops reading as a menu and starts reading as a page. */
export const MAX_MEGA_DROPDOWN_COLUMNS = 6;
/** Beside six columns there is room for two pictures, not three. */
export const MAX_MEGA_DROPDOWN_PROMOS = 2;
/** A column longer than this outruns the panel's height on a laptop. */
const MAX_MEGA_DROPDOWN_LINKS = 12;

function hasLabel(item: HeaderMenuItem): boolean {
  return item.label.trim().length > 0;
}

/**
 * A menu as the full-width dropdown under a nav link (Lanvin's WOMEN panel):
 *
 * - a top-level item WITH children is a column — its label the heading,
 *   its children the links under it;
 * - a top-level item with an image and NO children is a picture on the
 *   panel's end, captioned with its label and linked to its URL;
 * - a top-level item with neither is a column that is only its heading,
 *   which is how a merchant adds a standalone "Gifts" beside the groups.
 *
 * Deeper levels are ignored: a dropdown is headings and links, and a third
 * level would need a flyout inside a flyout.
 */
export function splitMegaDropdown(items: HeaderMenuItem[]): MegaDropdownLayout {
  const columns: MegaDropdownColumn[] = [];
  const promos: MegaDropdownPromo[] = [];

  for (const item of items) {
    const children = (item.children ?? []).filter(hasLabel);
    const image = item.image?.trim() ?? "";

    if (children.length === 0 && image) {
      if (promos.length < MAX_MEGA_DROPDOWN_PROMOS) {
        promos.push({
          image,
          label: item.label.trim(),
          href: item.href,
          target: item.target,
        });
      }
      continue;
    }

    if (!hasLabel(item)) continue;
    if (columns.length >= MAX_MEGA_DROPDOWN_COLUMNS) continue;
    columns.push({
      title: item.label.trim(),
      // A heading with children is usually a label ("READY TO WEAR"), but a
      // merchant who gave it a URL meant it to go somewhere.
      href: isRealHref(item.href) ? item.href : "",
      target: item.target,
      links: children.slice(0, MAX_MEGA_DROPDOWN_LINKS),
    });
  }

  return { columns, promos };
}

/**
 * The menu editor stores "#" or an empty URL for a heading that goes
 * nowhere; the header's href resolver turns empty into the store's home,
 * which is exactly the link a heading must NOT become.
 */
function isRealHref(href: string): boolean {
  const value = href.trim();
  if (!value || value === "#") return false;
  // `/en` and `/en/` are what an empty URL resolves to.
  return !/^\/[a-z]{2}(?:-[a-z]{2})?\/?$/i.test(value);
}

/**
 * The side drawer's lists: every labelled top-level item, in order. An item
 * with children opens its panel beside the drawer rather than navigating,
 * so its own URL only matters inside that panel (the "View all" row).
 */
export function drawerEntries(items: HeaderMenuItem[]): HeaderMenuItem[] {
  return items.filter(hasLabel).map((item) => ({
    ...item,
    children: drawerEntries(item.children ?? []),
  }));
}

/** Whether a drawer entry opens a sub-list instead of navigating. */
export function drawerEntryDrillsIn(item: HeaderMenuItem): boolean {
  return (item.children ?? []).length > 0;
}

/**
 * One run of links in the drawer's side panel: a titled group (a child with
 * children of its own — "FOR HER" over its links) or an untitled run of
 * plain children between groups.
 */
export interface DrawerPanelSection {
  /** "" for an untitled run of plain links. */
  title: string;
  /** The heading's own link; "" when it is only a label. */
  href: string;
  target?: HeaderMenuItem["target"];
  links: HeaderMenuItem[];
}

export interface DrawerPanel {
  sections: DrawerPanelSection[];
  promos: MegaDropdownPromo[];
}

/**
 * What opens BESIDE the side drawer when a shopper picks an entry with
 * children (Prada's menu), read the way the nav-link dropdown reads a menu:
 *
 * - a child WITH children is a group — its label a small heading, its
 *   children the links beneath;
 * - a child with an image and no children is a picture under the groups;
 * - any other child is a plain link. Consecutive plain links share one
 *   untitled run, so a flat list of subcategories stays one list.
 *
 * Unlike the dropdown nothing is capped but the pictures: the panel scrolls,
 * and a category that lost its last subcategories to a column limit would
 * be a menu that silently hides part of the store. Deeper levels stay out —
 * a panel beside a panel beside a drawer is a maze.
 */
export function drawerPanel(item: HeaderMenuItem): DrawerPanel {
  const sections: DrawerPanelSection[] = [];
  const promos: MegaDropdownPromo[] = [];

  for (const child of item.children ?? []) {
    const grandchildren = (child.children ?? []).filter(hasLabel);
    const image = child.image?.trim() ?? "";

    if (grandchildren.length === 0 && image) {
      if (promos.length < MAX_MEGA_DROPDOWN_PROMOS) {
        promos.push({
          image,
          label: child.label.trim(),
          href: child.href,
          target: child.target,
        });
      }
      continue;
    }
    if (!hasLabel(child)) continue;

    if (grandchildren.length > 0) {
      sections.push({
        title: child.label.trim(),
        href: isRealHref(child.href) ? child.href : "",
        target: child.target,
        links: grandchildren.map((link) => ({ ...link, children: [] })),
      });
      continue;
    }

    const link: HeaderMenuItem = { ...child, children: [] };
    const run = sections.at(-1);
    if (run && run.title === "") run.links.push(link);
    else sections.push({ title: "", href: "", links: [link] });
  }

  return { sections, promos };
}

/**
 * The glyph beside a small service link at the foot of the side drawer
 * ("Contact us", "Find a store"). A merchant-uploaded menu icon wins; this
 * is the fallback, guessed from where the link goes, so a menu authored
 * without icons still reads as a list of services rather than bare text.
 */
export const DRAWER_LINK_GLYPHS = [
  "contact",
  "location",
  "account",
  "wishlist",
  "orders",
  "shipping",
  "returns",
  "help",
  "blog",
  "gift",
  "link",
] as const;
export type DrawerLinkGlyph = (typeof DRAWER_LINK_GLYPHS)[number];

/**
 * Checked in order, every rule's paths before any rule's words: a URL says
 * where a link goes more reliably than its wording. The narrower account
 * pages (orders, wishlist) sit above the account rule that would swallow them.
 */
const GLYPH_RULES: {
  glyph: DrawerLinkGlyph;
  paths: string[];
  words: string[];
}[] = [
  {
    glyph: "contact",
    paths: ["/contact"],
    words: ["contact", "call us", "chat", "client service", "customer service", "customer care"],
  },
  {
    glyph: "location",
    paths: ["/stores", "/store-locator", "/boutiques", "/locations"],
    words: ["find a store", "store locator", "boutique", "our stores"],
  },
  {
    glyph: "orders",
    paths: ["/track-order", "/account/orders", "/orders"],
    words: ["track", "my orders", "order status"],
  },
  {
    glyph: "wishlist",
    paths: ["/wishlist", "/account/wishlist"],
    words: ["wishlist", "wish list", "favorites", "favourites", "saved items"],
  },
  {
    glyph: "account",
    paths: ["/account", "/login", "/register"],
    words: ["account", "sign in", "log in", "login", "register"],
  },
  { glyph: "shipping", paths: ["/shipping", "/delivery"], words: ["shipping", "delivery"] },
  { glyph: "returns", paths: ["/returns", "/refund"], words: ["return", "refund", "exchange"] },
  { glyph: "help", paths: ["/faq", "/help", "/support"], words: ["help", "faq", "support", "questions"] },
  {
    glyph: "blog",
    paths: ["/blog", "/journal", "/stories"],
    words: ["blog", "journal", "stories", "magazine", "news"],
  },
  { glyph: "gift", paths: ["/gift"], words: ["gift"] },
];

export function drawerLinkGlyph(
  item: Pick<HeaderMenuItem, "href" | "label">,
): DrawerLinkGlyph {
  // The storefront hands over locale-prefixed hrefs (/en/contact).
  const path = item.href
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/, "");
  const label = item.label.trim().toLowerCase();
  for (const rule of GLYPH_RULES) {
    if (rule.paths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return rule.glyph;
    }
  }
  for (const rule of GLYPH_RULES) {
    if (rule.words.some((word) => label.includes(word))) return rule.glyph;
  }
  return "link";
}

/** The "View all" row inside a drilled-in list: only when the parent links somewhere. */
export function drawerViewAllHref(item: HeaderMenuItem): string {
  return isRealHref(item.href) ? item.href : "";
}
