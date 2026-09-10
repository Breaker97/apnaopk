import {
  Apple,
  ArrowLeftRight,
  DollarSign,
  Globe,
  Heart,
  LayoutGrid,
  Link2,
  MapPin,
  Menu,
  Moon,
  Phone,
  RectangleHorizontal,
  ScanSearch,
  Search,
  Shapes,
  ShoppingCart,
  Type,
  User,
  type LucideIcon,
  Images,
} from "lucide-react";
import type {
  HeaderIconKey,
  HeaderItemType,
} from "@/lib/site-config/header-layout";

// The CSS helpers live in lib so the storefront header shares them; the
// studio's own modules keep importing them from here.
export {
  alignItemsValue,
  columnStyle,
  fillColorCss,
  fillTextCss,
  navJustifyContent,
  paddingStyle,
  rowStyle,
  surfaceInkCss,
  surfaceTone,
  textStyleCss,
  type SurfaceTone,
} from "@/lib/site-config/header-layout-style";

/**
 * The studio's radius scale: 12px cards, 4px controls. The shared inputs,
 * selects and buttons default to 6px, so the studio root (and each of its
 * dialogs, which portal out of the root) narrows them with this scope
 * rather than every field carrying its own override.
 */
export const STUDIO_CONTROL_RADIUS =
  "[&_[data-slot=button]]:rounded-[4px] [&_[data-slot=input]]:rounded-[4px] [&_[data-slot=native-select]]:rounded-[4px]";

/* ------------------------------------------------------------------ *
 * The drawer catalogue.                                              *
 * ------------------------------------------------------------------ */

export interface HeaderItemMeta {
  type: HeaderItemType;
  /** English label; the studio looks for a translation first. */
  label: string;
  icon: LucideIcon;
}

export const HEADER_ITEM_META: HeaderItemMeta[] = [
  { type: "brand", label: "Brand", icon: Apple },
  { type: "nav", label: "Nav Links", icon: Link2 },
  { type: "categories", label: "All Categories", icon: LayoutGrid },
  { type: "collections", label: "Collections", icon: Images },
  { type: "searchBar", label: "Search Bar", icon: Search },
  { type: "searchIcon", label: "Search icon", icon: ScanSearch },
  { type: "location", label: "Location", icon: MapPin },
  { type: "buttons", label: "Buttons", icon: RectangleHorizontal },
  { type: "text", label: "Text", icon: Type },
  { type: "icons", label: "Icons", icon: Shapes },
  { type: "user", label: "User", icon: User },
  { type: "menuButton", label: "Menu button", icon: Menu },
];

export function itemMeta(type: HeaderItemType): HeaderItemMeta {
  return (
    HEADER_ITEM_META.find((entry) => entry.type === type) ??
    HEADER_ITEM_META[0]
  );
}

/**
 * What each utility key is, for the studio's picker and its preview. The
 * glyph and `labelKey` are the STOREFRONT's — a picker that offers a pair
 * of scales for Compare, or a preview that captions the cart in English
 * while the header speaks the shopper's language, is describing a header
 * the store does not have.
 */
export const HEADER_ICON_META: Record<
  HeaderIconKey,
  { label: string; labelKey: string; icon: LucideIcon }
> = {
  theme: { label: "Theme toggle", labelKey: "common.theme", icon: Moon },
  wishlist: { label: "Wishlist", labelKey: "nav.wishlist", icon: Heart },
  cart: { label: "Cart", labelKey: "common.cart", icon: ShoppingCart },
  compare: { label: "Compare", labelKey: "nav.compare", icon: ArrowLeftRight },
  contact: { label: "Contact", labelKey: "nav.contact", icon: Phone },
  language: { label: "Language", labelKey: "common.language", icon: Globe },
  currency: { label: "Currency", labelKey: "common.currency", icon: DollarSign },
};
