import { unstable_cache } from "next/cache";
import { connectDB } from "@/lib/db";
import { Menu } from "@/models";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import {
  MAX_MEGA_MENU_DEPTH,
  MEGA_BOTTOM_PROMO_CARDS,
  trimMenuTreeDepth,
} from "@/lib/site-config/menu-depth";
import type { MenuLocation } from "@/types";

interface SeedItem {
  label: string;
  url: string;
  type?: string;
  target?: "_self" | "_blank";
  icon?: string;
  image?: string;
  description?: string;
  badge?: string;
  isFeatured?: boolean;
  children?: SeedItem[];
}

interface SeedMenu {
  name: string;
  handle: string;
  location: MenuLocation;
  description?: string;
  items: SeedItem[];
}

interface SeedItemDocument {
  label: string;
  url: string;
  type: string;
  target: "_self" | "_blank";
  icon?: string;
  image?: string;
  description?: string;
  badge?: string;
  isFeatured?: boolean;
  children: SeedItemDocument[];
}

const DEFAULT_MENUS: SeedMenu[] = [
  {
    name: "Main Header",
    handle: "main-header",
    location: "header",
    description: "Primary navigation links shown in the store header.",
    items: [
      { label: "Blog", url: "/blog", type: "page" },
      { label: "Track Order", url: "/track-order", type: "page" },
    ],
  },
  {
    name: "Mega Menu",
    handle: "main-mega-menu",
    location: "header-mega",
    description:
      "Layered storefront mega menu shown from the header category menu.",
    items: [
      {
        label: "Electronics",
        url: "/products?category=electronics",
        type: "category",
        children: [
          {
            label: "Phone",
            url: "/products?category=phone",
            type: "category",
            children: [
              { label: "iPhone", url: "/products?search=iPhone" },
              { label: "Samsung", url: "/products?search=Samsung" },
              { label: "Google", url: "/products?search=Google" },
              { label: "Nothing Phone", url: "/products?search=Nothing%20Phone" },
              { label: "Vivo", url: "/products?search=Vivo" },
              { label: "OnePlus", url: "/products?search=OnePlus" },
              { label: "Symphony", url: "/products?search=Symphony" },
              { label: "Xiaomi", url: "/products?search=Xiaomi" },
              { label: "Oppo", url: "/products?search=Oppo" },
              { label: "Honor", url: "/products?search=Honor" },
              { label: "Nokia", url: "/products?search=Nokia" },
              { label: "Infinix", url: "/products?search=Infinix" },
            ],
          },
          { label: "Laptop", url: "/products?category=laptop", type: "category" },
          { label: "Camera", url: "/products?category=camera", type: "category" },
          {
            label: "Accessories",
            url: "/products?category=accessories",
            type: "category",
          },
          {
            label: "Appliance",
            url: "/products?category=appliance",
            type: "category",
          },
          {
            label: "TV & Monitors",
            url: "/products?category=tv-monitors",
            type: "category",
          },
          {
            label: "Office Equipments",
            url: "/products?category=office-equipments",
            type: "category",
          },
          {
            label: "Headphones",
            url: "/products?category=headphones",
            type: "category",
          },
          {
            label: "Galaxy S26 Ultra",
            url: "/products?search=Galaxy%20S26%20Ultra",
            description: "Galaxy AI",
            isFeatured: true,
          },
        ],
      },
      { label: "Fashion", url: "/products?category=fashion", type: "category" },
      {
        label: "Furniture",
        url: "/products?category=furniture",
        type: "category",
      },
      { label: "Shoe", url: "/products?category=shoe", type: "category" },
      {
        label: "Jewelry & Accessories",
        url: "/products?category=jewelry-accessories",
        type: "category",
      },
      {
        label: "Food & Grocery",
        url: "/products?category=food-grocery",
        type: "category",
      },
    ],
  },
  // Footer link columns are managed from the Footer builder (settings.footer),
  // not from seeded menus — so no "footer" location menus are seeded here.
];

// Legacy footer menus, now fully replaced by the Footer builder
// (settings.footer.linkColumns). Purged by ensureDefaultMenus() so they can't
// reappear after an upgrade or a stale dev process.
const DEPRECATED_MENU_HANDLES = [
  "footer-products",
  "footer-help",
  "footer-company",
  "footer-legal",
];

let defaultMenusEnsured = false;
let defaultMenusPromise: Promise<void> | null = null;

function mapSeedItems(items: SeedItem[]): SeedItemDocument[] {
  return items.map((it) => ({
    label: it.label,
    url: it.url,
    type: it.type ?? "custom",
    target: it.target ?? "_self",
    icon: it.icon,
    image: it.image,
    description: it.description,
    badge: it.badge,
    isFeatured: it.isFeatured,
    children: mapSeedItems(it.children || []),
  }));
}

export async function ensureDefaultMenus(): Promise<void> {
  if (defaultMenusEnsured) return;
  if (defaultMenusPromise) return defaultMenusPromise;

  defaultMenusPromise = ensureDefaultMenusOnce().finally(() => {
    defaultMenusPromise = null;
  });

  return defaultMenusPromise;
}

async function ensureDefaultMenusOnce(): Promise<void> {
  await connectDB();

  // Remove deprecated menus that may still linger from an earlier seed.
  await Menu.deleteMany({ handle: { $in: DEPRECATED_MENU_HANDLES } }).catch(
    () => {},
  );

  const handles = DEFAULT_MENUS.map((menu) => menu.handle);
  const existingHandles = await Menu.find({ handle: { $in: handles } }).distinct(
    "handle",
  );
  const existing = new Set(existingHandles.map((handle) => String(handle)));
  const missingMenus = DEFAULT_MENUS.filter((menu) => !existing.has(menu.handle));

  if (missingMenus.length === 0) {
    defaultMenusEnsured = true;
    return;
  }

  await Menu.insertMany(
    missingMenus.map((m) => ({
      ...m,
      items: mapSeedItems(m.items),
      isActive: true,
    })),
    { ordered: false },
  ).catch(() => {});

  defaultMenusEnsured = true;
}

export interface MenuItemPlain {
  label: string;
  url: string;
  type: string;
  target: "_self" | "_blank";
  icon?: string;
  image?: string;
  description?: string;
  badge?: string;
  badgeColor?: string;
  isFeatured?: boolean;
  /** Mega menu top level: "none" | "side" | "bottom". Absent on older menus. */
  promoMode?: string;
  /** Mega menu top level, "bottom" mode: the pair of promo card images. */
  promoImages?: string[];
  isMegaColumn?: boolean;
  columnTitle?: string;
  children: MenuItemPlain[];
}

interface MenuPlain {
  _id: string;
  name: string;
  handle: string;
  location: MenuLocation;
  items: MenuItemPlain[];
}

function mapSeedMenuToPlain(menu: SeedMenu): MenuPlain {
  return {
    _id: `default:${menu.handle}`,
    name: menu.name,
    handle: menu.handle,
    location: menu.location,
    items: normalizeMenuItemsByLocation(mapSeedItems(menu.items), menu.location),
  };
}

function getDefaultMenusByLocation(location: MenuLocation): MenuPlain[] {
  return DEFAULT_MENUS.filter((menu) => menu.location === location).map(
    mapSeedMenuToPlain,
  );
}

function normalizeItems(items: unknown): MenuItemPlain[] {
  if (!Array.isArray(items)) return [];
  return items.map((raw) => {
    const it = (raw ?? {}) as Record<string, unknown>;
    return {
      label: typeof it.label === "string" ? it.label : "",
      url: typeof it.url === "string" ? it.url : "#",
      type: typeof it.type === "string" ? it.type : "custom",
      target: it.target === "_blank" ? "_blank" : "_self",
      icon: typeof it.icon === "string" ? it.icon : undefined,
      image: typeof it.image === "string" ? it.image : undefined,
      description: typeof it.description === "string" ? it.description : undefined,
      badge: typeof it.badge === "string" ? it.badge : undefined,
      badgeColor: typeof it.badgeColor === "string" ? it.badgeColor : undefined,
      isFeatured: !!it.isFeatured,
      promoMode:
        it.promoMode === "none" ||
        it.promoMode === "side" ||
        it.promoMode === "bottom"
          ? it.promoMode
          : undefined,
      promoImages: Array.isArray(it.promoImages)
        ? it.promoImages
            .filter((image): image is string => typeof image === "string")
            .map((image) => image.trim())
            .filter(Boolean)
            .slice(0, MEGA_BOTTOM_PROMO_CARDS)
        : undefined,
      isMegaColumn: !!it.isMegaColumn,
      columnTitle: typeof it.columnTitle === "string" ? it.columnTitle : undefined,
      children: normalizeItems(it.children),
    };
  });
}

function normalizeMenuItemsByLocation(
  items: unknown,
  location: MenuLocation,
): MenuItemPlain[] {
  const normalizedItems = normalizeItems(items);
  if (location !== "header-mega") return normalizedItems;
  return trimMenuTreeDepth(normalizedItems, MAX_MEGA_MENU_DEPTH).items;
}

async function loadMenuByHandle(handle: string): Promise<MenuPlain | null> {
  try {
    await connectDB();
    const m = await Menu.findOne({ handle, isActive: true }).lean();
    if (!m) return null;
    return {
      _id: String(m._id),
      name: m.name,
      handle: m.handle,
      location: m.location,
      items: normalizeMenuItemsByLocation(m.items, m.location),
    };
  } catch {
    return null;
  }
}

async function loadMenusByLocation(
  location: MenuLocation,
): Promise<MenuPlain[]> {
  try {
    await connectDB();
    const menus = await Menu.find({ location, isActive: true })
      .sort({ updatedAt: -1 })
      .lean();
    const normalizedMenus = menus.map((m) => ({
      _id: String(m._id),
      name: m.name,
      handle: m.handle,
      location: m.location,
      items: normalizeMenuItemsByLocation(m.items, m.location),
    }));

    return normalizedMenus.length > 0
      ? normalizedMenus
      : getDefaultMenusByLocation(location);
  } catch {
    return getDefaultMenusByLocation(location);
  }
}

// Header nav + mega menu are read on nearly every storefront (and auth) page
// render. The trees change rarely, so cache them tagged `menus`; menu edits call
// `revalidateMenuContent()` which busts that tag, and the 5-minute revalidate is
// a safety net. Returns plain JSON-serializable objects, so `unstable_cache` is
// safe here. Cache key includes the handle/location so entries don't collide.
export function getMenuByHandle(handle: string): Promise<MenuPlain | null> {
  return unstable_cache(
    () => loadMenuByHandle(handle),
    ["menu-by-handle", handle],
    { revalidate: 300, tags: [CACHE_TAGS.menus] },
  )();
}

export function getMenusByLocation(
  location: MenuLocation,
): Promise<MenuPlain[]> {
  return unstable_cache(
    () => loadMenusByLocation(location),
    ["menus-by-location", location],
    { revalidate: 300, tags: [CACHE_TAGS.menus] },
  )();
}
