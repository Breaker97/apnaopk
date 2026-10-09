import type { HeaderMenuItem } from "@/lib/site-config/header-config";
import type { MenuItemPlain } from "@/lib/site-config/menu-helpers";

/**
 * Mega-menu payload mapper, kept apart from the regular header-link mapper on
 * purpose.
 *
 * A regular header link is edited through a single "Icon / image" field that
 * writes `image`, so its mapper has to fall back to `image` when `icon` is
 * empty — drop that fallback and every header link loses its icon.
 *
 * A mega-menu item carries two independent assets: `icon` comes from the
 * synced category, `image` is the side banner the promo panel draws. Running
 * those through the regular mapper collapsed them into one, and that is what
 * silently killed the banner — `getMegaItemPromoImage` discards an image that
 * equals the icon, so a category with a banner and no icon of its own rendered
 * no promo at all.
 */
export function mapMegaMenuItem(
  item: MenuItemPlain,
  resolveHref: (raw: string) => string,
): HeaderMenuItem {
  return {
    label: item.label,
    href: resolveHref(item.url),
    target: item.target,
    // Icon-only, and deliberately no `|| item.image`: a promo image must never
    // be borrowed as an icon. A category without its own icon gets no visual.
    icon: item.icon,
    image: item.image,
    description: item.description,
    badge: item.badge,
    isFeatured: item.isFeatured,
    promoMode: item.promoMode as HeaderMenuItem["promoMode"],
    promoImages: item.promoImages,
    columnTitle: item.columnTitle,
    children: item.children.map((child) => mapMegaMenuItem(child, resolveHref)),
  };
}
