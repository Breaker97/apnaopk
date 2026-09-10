import { type Locale } from "@/config/i18n.config";
import { StoreHeader } from "@/components/layout/store-header";
import { StoreFooter } from "@/components/layout/store-footer";
import {
  getMenuByHandle,
  getMenusByLocation,
  type MenuItemPlain,
} from "@/lib/site-config/menu-helpers";
import { mapMegaMenuItem } from "@/lib/site-config/mega-menu-mapping";
import {
  CONTENT_PAGE_KEYS,
  CONTENT_PAGE_META,
  HEADER_APP_PAGE_OPTIONS,
} from "@/lib/site-config/content-pages-config";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { getStorefrontCategories } from "@/lib/storefront/storefront-categories";
import { getStorefrontCollections } from "@/lib/storefront/storefront-collections";
import { readStoredShopperLocation } from "@/lib/locations/resolve-request-location";

/**
 * The main header bar and footer, as group-section bodies. All the menu
 * assembly the (store) layout used to do lives here VERBATIM — every input
 * is a cached getter, so the move changes where the code runs, not what it
 * costs. The classic header/footer settings forms keep editing the
 * underlying config; the group document only decides what renders around
 * these cores (announcement bar, top tags, …).
 */

type HeaderMenuItemPayload = {
  label: string;
  href: string;
  target: "_self" | "_blank";
  icon?: string;
  image?: string;
  description?: string;
  badge?: string;
  isFeatured?: boolean;
  promoMode?: "none" | "side" | "bottom";
  /** "bottom" mode: the pair of promo card images the strip renders. */
  promoImages?: string[];
  columnTitle?: string;
  navPosition?: "left" | "right";
  children: HeaderMenuItemPayload[];
};

/**
 * Assemble the header's link tree: the menus a merchant built plus the
 * pages they picked in Header Studio, deduped by href and tagged with the
 * side each page sits on. Pulled out of HeaderBar so the top-tags row can
 * render the same utility links when the header places them there.
 */
async function buildHeaderMenuItems(locale: Locale) {
  const [{ contentPages, headerSettings }, headerMenus] = await Promise.all([
    getStorefrontSettings(),
    getMenusByLocation("header"),
  ]);

  const resolveHref = (raw: string) => {
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    if (raw.startsWith("/")) {
      return raw.startsWith(`/${locale}`) ? raw : `/${locale}${raw}`;
    }
    return `/${locale}/${raw}`;
  };
  const controlledAppPagePaths = new Set(
    HEADER_APP_PAGE_OPTIONS.map((page) => page.publicPath),
  );
  const selectedAppPagePaths = new Set(headerSettings.pagesMenu.appPagePaths);
  const getControlledAppPath = (raw: string) => {
    if (raw.startsWith("http://") || raw.startsWith("https://")) return null;

    const path = raw.split(/[?#]/, 1)[0]?.trim();
    if (!path) return null;

    const absolutePath = path.startsWith("/") ? path : `/${path}`;
    const localePath = absolutePath.startsWith(`/${locale}/`)
      ? absolutePath.slice(locale.length + 1)
      : absolutePath === `/${locale}`
        ? "/"
        : absolutePath;
    const normalizedPath =
      localePath.length > 1 ? localePath.replace(/\/+$/, "") : localePath;

    return controlledAppPagePaths.has(normalizedPath) ? normalizedPath : null;
  };

  const isHeaderPageMenuItem = (item: MenuItemPlain) =>
    item.type === "page" || item.type === "blog" || item.type === "blog-post";

  const getVisibleHeaderMenuItems = (items: MenuItemPlain[]): MenuItemPlain[] =>
    items.flatMap((item) => {
      if (!headerSettings.pagesMenu.enabled && isHeaderPageMenuItem(item)) {
        return [];
      }

      const controlledAppPath = getControlledAppPath(item.url);
      if (controlledAppPath && !selectedAppPagePaths.has(controlledAppPath)) {
        return [];
      }

      return [
        {
          ...item,
          children: getVisibleHeaderMenuItems(item.children),
        },
      ];
    });

  const mapHeaderMenuItem = (item: MenuItemPlain): HeaderMenuItemPayload => ({
    label: item.label,
    href: resolveHref(item.url),
    target: item.target,
    icon: item.icon || item.image,
    image: item.image,
    description: item.description,
    badge: item.badge,
    isFeatured: item.isFeatured,
    promoMode: item.promoMode as HeaderMenuItemPayload["promoMode"],
    promoImages: item.promoImages,
    columnTitle: item.columnTitle,
    children: item.children.map(mapHeaderMenuItem),
  });

  const headerMenuItems = headerMenus.flatMap((menu) =>
    getVisibleHeaderMenuItems(menu.items).map(mapHeaderMenuItem),
  );
  const appHeaderPageItems = new Map<string, HeaderMenuItemPayload>(
    HEADER_APP_PAGE_OPTIONS.filter((page) =>
      headerSettings.pagesMenu.appPagePaths.includes(page.publicPath),
    ).map((page) => [
      `app:${page.publicPath}`,
      {
        label: page.label,
        href: resolveHref(page.publicPath),
        target: "_self" as const,
        children: [] as HeaderMenuItemPayload[],
      },
    ]),
  );
  const standardHeaderPageItems = new Map<string, HeaderMenuItemPayload>(
    CONTENT_PAGE_KEYS.flatMap((key) => {
      const page = contentPages[key];
      if (!page.visible || !headerSettings.pagesMenu.pageKeys.includes(key)) {
        return [];
      }

      return [
        [
          `standard:${key}`,
          {
            label: page.title || CONTENT_PAGE_META[key].adminTitle,
            href: resolveHref(CONTENT_PAGE_META[key].publicPath),
            target: "_self" as const,
            children: [] as HeaderMenuItemPayload[],
          },
        ] as const,
      ];
    }),
  );
  const customHeaderPageItems = new Map<string, HeaderMenuItemPayload>(
    contentPages.customPages
      .filter(
        (page) =>
          page.visible &&
          page.handle.trim() &&
          headerSettings.pagesMenu.customPageIds.includes(page.id),
      )
      .map((page) => [
        `custom:${page.id}`,
        {
          label: page.title,
          href: resolveHref(`/pages/${page.handle}`),
          target: "_self" as const,
          children: [] as HeaderMenuItemPayload[],
        },
      ]),
  );
  const headerPageItemMap = new Map([
    ...appHeaderPageItems,
    ...standardHeaderPageItems,
    ...customHeaderPageItems,
  ]);
  const selectedHeaderPageKeys = [
    ...headerSettings.pagesMenu.order.filter((key) =>
      headerPageItemMap.has(key),
    ),
    ...Array.from(headerPageItemMap.keys()).filter(
      (key) => !headerSettings.pagesMenu.order.includes(key),
    ),
  ];
  const headerPageItems = headerSettings.pagesMenu.enabled
    ? selectedHeaderPageKeys.flatMap((key) => {
        const item = headerPageItemMap.get(key);
        if (!item) return [];

        return [
          {
            ...item,
            navPosition: headerSettings.pagesMenu.positions[key] || "right",
          },
        ];
      })
    : [];
  // Custom menu links lead: they are the header's own nav, and the selected
  // pages "appear alongside" them. Order also decides the dedupe winner, so a
  // page whose URL a custom link already covers keeps the custom link's
  // placement (first in the nav) instead of being pulled into the pages group.
  const combinedHeaderMenuItems = dedupeHeaderMenuItems([
    ...headerMenuItems,
    ...headerPageItems,
  ]);

  return { combinedHeaderMenuItems, headerSettings, contentPages };
}

export async function HeaderBar({ locale }: { locale: Locale }) {
  const [
    { combinedHeaderMenuItems, headerSettings },
    headerMegaMenus,
    categoriesResult,
  ] = await Promise.all([
    buildHeaderMenuItems(locale),
    getMenusByLocation("header-mega"),
    getStorefrontCategories({ flat: false, page: 1, limit: 20 }),
  ]);

  // Collection nav count is configurable via header settings, so this
  // depends on the resolved settings above. The header renders no
  // collection nav at all when the menu is disabled, so skip the query.
  // Resolved together: the collection nav and the shopper's saved place are
  // independent reads, and the location is only worth a cookie parse when
  // the header actually renders the "Deliver to" control.
  const [collectionsResult, initialLocation] = await Promise.all([
    headerSettings.collectionsMenu?.enabled
      ? getStorefrontCollections({
          page: 1,
          limit: headerSettings.collectionsMenu?.limit ?? 12,
        })
      : Promise.resolve({ data: [] }),
    headerSettings.widgets?.showLocationPicker
      ? readStoredShopperLocation()
      : Promise.resolve(null),
  ]);

  const resolveHref = (raw: string) => {
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    if (raw.startsWith("/")) {
      return raw.startsWith(`/${locale}`) ? raw : `/${locale}${raw}`;
    }
    return `/${locale}/${raw}`;
  };

  // Mega-menu items go through their own mapper: the regular one folds `image`
  // into `icon` when no icon is set, which turns a category's side banner into
  // its rail icon and leaves the promo panel with nothing to draw.
  const headerMegaMenuItems = headerMegaMenus.flatMap((menu) =>
    menu.items.map((item) => mapMegaMenuItem(item, resolveHref)),
  );

  return (
    <StoreHeader
      locale={locale}
      menuItems={combinedHeaderMenuItems}
      megaMenuItems={headerMegaMenuItems}
      headerSettings={headerSettings}
      initialCategories={categoriesResult.categories}
      initialCollections={collectionsResult.data}
      initialLocation={initialLocation}
    />
  );
}

export async function FooterBar({ locale }: { locale: Locale }) {
  const { footerSettings, isMultiVendorEnabled } =
    await getStorefrontSettings();
  const resolved = await resolveFooterMenuColumns(footerSettings);
  return (
    <StoreFooter
      locale={locale}
      footerSettings={
        isMultiVendorEnabled ? resolved : dropMarketplaceLinks(resolved)
      }
    />
  );
}

/**
 * /vendors and /become-vendor both 404 while multi-vendor is off, so a
 * single-vendor store never prints footer links to them — including the
 * defaults a fresh install ships with. Matched with or without a locale
 * prefix because menu-sourced links may arrive either way.
 */
const MARKETPLACE_ONLY_PATH =
  /^\/(?:[a-z]{2}(?:-[a-zA-Z]{2})?\/)?(?:vendors|become-vendor)\/?$/;

function dropMarketplaceLinks(
  footerSettings: Awaited<
    ReturnType<typeof getStorefrontSettings>
  >["footerSettings"],
) {
  return {
    ...footerSettings,
    linkColumns: footerSettings.linkColumns.map((column) => ({
      ...column,
      links: column.links.filter(
        (link) => !MARKETPLACE_ONLY_PATH.test(link.href.split(/[?#]/)[0]),
      ),
    })),
  };
}

/**
 * Menu-sourced footer columns (Navigation as the single source of truth):
 * a column with a `menuHandle` renders that Menu's top-level items, and an
 * empty title takes the menu's name. Resolved here — server-side, cached
 * per menu handle with the `menus` tag — so StoreFooter stays a dumb
 * client renderer of ready links. An unresolvable handle empties the
 * column, which StoreFooter already drops.
 */
async function resolveFooterMenuColumns(
  footerSettings: Awaited<
    ReturnType<typeof getStorefrontSettings>
  >["footerSettings"],
) {
  const handles = [
    ...new Set(
      footerSettings.linkColumns
        .map((column) => column.menuHandle?.trim())
        .filter((handle): handle is string => Boolean(handle)),
    ),
  ];
  if (handles.length === 0) return footerSettings;

  const menus = await Promise.all(
    handles.map((handle) => getMenuByHandle(handle)),
  );
  const byHandle = new Map(
    menus.flatMap((menu) => (menu ? [[menu.handle, menu] as const] : [])),
  );

  return {
    ...footerSettings,
    linkColumns: footerSettings.linkColumns.map((column) => {
      const handle = column.menuHandle?.trim();
      if (!handle) return column;
      const menu = byHandle.get(handle);
      if (!menu) return { ...column, links: [] };
      return {
        ...column,
        title: column.title.trim() || menu.name,
        links: menu.items.map((item) => ({
          label: item.label,
          href: item.url,
          target: item.target,
          visible: true,
        })),
      };
    }),
  };
}

function dedupeHeaderMenuItems(
  items: HeaderMenuItemPayload[],
): HeaderMenuItemPayload[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = item.href.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
