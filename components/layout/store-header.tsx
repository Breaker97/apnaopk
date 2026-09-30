"use client";

import Link from "@/components/language/link";
import {
  ShoppingCart,
  Search,
  User,
  LayoutDashboard,
  LogOut,
  Package,
  Phone,
  Heart,
  Settings,
  Store,
  ChevronDown,
  Sun,
  Moon,
  Sparkles,
  ArrowRight,
  ArrowLeftRight,
  Menu,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { useCart } from "@/hooks/use-cart";
import { useTranslations } from "next-intl";
import { signOutAndReload } from "@/lib/auth/auth-client";
import { Badge } from "@/components/ui/badge";
import { useWishlist } from "@/hooks/use-wishlist";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AppImage } from "@/components/ui/app-image";
import { usePathname, useRouter } from "@/hooks/use-locale-navigation";
import type { ThemeMode } from "@/config/branding.config";
import { useAppTheme } from "@/providers/theme-provider";
import { appConfig, USER_ROLES } from "@/config/app.config";
import { isStaffRole } from "@/lib/access/staff-role";
import { getRoleDashboardPath } from "@/lib/access/role-dashboard";
import { buildLoginUrl } from "@/lib/auth/return-path";
import { useAppSettings } from "@/providers/app-settings-provider";
import { useCurrency } from "@/providers/currency-provider";
import {
  swapLocaleInPathname,
  useLanguage,
} from "@/providers/language-provider";
import { type Locale } from "@/config/i18n.config";
import { FlagIcon } from "@/components/ui/flag-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  getDefaultHeaderSettings,
  headerShadowCss,
  resolveHeaderLogoUrl,
  type HeaderMenuItem,
  type HeaderSettings,
} from "@/lib/site-config/header-config";
import {
  headerCurrencyLabel,
  linkGlyph,
  visibleColumns,
  type HeaderBrandItem,
  type HeaderButtonsItem,
  type HeaderCategoriesItem,
  type HeaderCurrencyItem,
  type HeaderLanguageItem,
  type HeaderFill,
  type HeaderIconKey,
  type HeaderIconsItem,
  type HeaderLayoutItem,
  type HeaderLayoutRow,
  type HeaderLocationItem,
  type HeaderMenuButtonItem,
  type HeaderCollectionsItem,
  type HeaderNavItem,
  type HeaderNavLink,
  type HeaderSearchBarItem,
  type HeaderSearchIconItem,
  type HeaderTextItem,
  type HeaderUserItem,
  headerLocationSlot,
} from "@/lib/site-config/header-layout";
import { getDefaultHeaderLayout } from "@/lib/site-config/header-layout-default";
import {
  clearHeaderLayoutInk,
  darkenHeaderLayout,
} from "@/lib/site-config/header-layout-scheme";
import { LocationPickerLazy } from "@/components/layout/location-picker-lazy";
import {
  alignItemsValue,
  columnStyle,
  fillColorCss,
  fillTextCss,
  navJustifyContent,
  paddingStyle,
  rowBlurCss,
  rowGridStyle,
  rowSurfaceCss,
  surfaceInkCss,
  surfaceTone,
  textStyleCss,
  type SurfaceTone,
} from "@/lib/site-config/header-layout-style";
import { LinkGlyphIcon } from "@/lib/site-config/header-link-glyphs";
import {
  backgroundAccentColor,
  backgroundCss,
  hasBackground,
} from "@/lib/sliders/background";
import { cn } from "@/lib/utils";
import {
  MAX_MEGA_MENU_LEVEL_2_ITEMS,
  MAX_MEGA_MENU_ROOT_ITEMS,
} from "@/lib/site-config/menu-depth";

import { OverflowNav } from "@/components/layout/store-header/overflow-nav";
import { NavDropdown } from "@/components/layout/store-header/nav-dropdown";
import { CollectionsMenu } from "@/components/layout/store-header/collections-menu";
import { NavMegaDropdown } from "@/components/layout/store-header/nav-mega-dropdown";
import { LanguagePopover } from "@/components/layout/store-header/language-popover";
import {
  HeaderMobileSearch,
  HeaderSearchBar,
  HeaderSearchDrawer,
  HeaderSearchIconField,
  HeaderSearchProvider,
  useHeaderSearchActions,
} from "@/components/layout/store-header/header-search";
import { useMobileMenu } from "@/stores/mobile-menu";
import { CategoryTriggerGlyph } from "@/lib/site-config/header-trigger-style";
import { useHydrated } from "@/hooks/use-client-value";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { useMediaQuery } from "@/hooks/use-media-query";
import dynamic from "next/dynamic";

// The drawers and the mega-menu panel are closed on every first paint, so
// their code is fetched when first opened rather than shipped with the
// header on every storefront page.
const CartDrawer = dynamic(() =>
  import("@/components/cart/cart-drawer").then((module) => module.CartDrawer),
);
const MobileMenuSheet = dynamic(() =>
  import("@/components/layout/store-header/mobile-menu-sheet").then(
    (module) => module.MobileMenuSheet,
  ),
);
// Both drawers are chunks of their own, fetched the first time one opens
// (the search drawer's loader lives with the header's search).
const SideDrawer = dynamic(() =>
  import("@/components/layout/store-header/side-drawer").then(
    (module) => module.SideDrawer,
  ),
);
const CustomMegaMenuPanel = dynamic(() =>
  import("@/components/layout/store-header/mega-menu").then(
    (module) => module.CustomMegaMenuPanel,
  ),
);

type CategoryNode = {
  _id: string;
  name: string;
  slug: string;
  image?: string;
  icon?: string;
  children: CategoryNode[];
};

type CollectionItem = {
  _id: string;
  title: string;
  slug: string;
  handle?: string;
  description?: string;
  image?: { url?: string; alt?: string };
};

interface StoreHeaderProps {
  locale: Locale;
  menuItems?: HeaderMenuItem[];
  megaMenuItems?: HeaderMenuItem[];
  /**
   * Navigation menus the Header Studio linked to items, by handle — the side
   * drawer's lists and nav links' mega dropdowns. Fetched on the server for
   * exactly the handles the layout names (collectLinkedMenuHandles).
   */
  linkedMenus?: Record<string, HeaderMenuItem[]>;
  headerSettings?: HeaderSettings;
  // Nav categories + collections are now fetched on the server (in the store
  // layout) and passed in, so the mega-menu renders in the initial HTML instead
  // of after two client round-trips per page.
  initialCategories?: CategoryNode[];
  initialCollections?: CollectionItem[];
}

/**
 * The storefront header.
 *
 * From `lg` up it is the Header Studio's layout tree, painted row by row:
 * every item a merchant placed — brand, nav links, the All Categories
 * trigger, search, icons, account, buttons, text — renders here as the
 * live control it stands for, styled by the item's own properties, so the
 * studio preview and the storefront are two views of one document. Below
 * `lg` the tree gives way to the compact bar (logo, cart, a search row) and
 * the menu drawer, which the studio does not lay out.
 *
 * The search state sits above the bar (header-search.tsx), so a keystroke
 * re-renders the search fields and not the header around them.
 */
export function StoreHeader(props: StoreHeaderProps) {
  return (
    <HeaderSearchProvider
      locale={props.locale}
      categories={props.initialCategories}
    >
      <StoreHeaderBar {...props} />
    </HeaderSearchProvider>
  );
}

function StoreHeaderBar({
  locale,
  menuItems,
  megaMenuItems,
  linkedMenus,
  headerSettings,
  initialCategories,
  initialCollections,
}: StoreHeaderProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const router = useRouter();
  const { searchFor } = useHeaderSearchActions();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { items: wishlistItems } = useWishlist();
  const { storeName, logoUrl, darkModeLogoUrl } = useAppSettings();
  const { isDark, setTheme } = useAppTheme();
  const { currency } = useCurrency();
  const { language, languages } = useLanguage();
  const mounted = useHydrated();
  // The mobile drawer is opened from the bottom nav's Menu tab, which is a
  // sibling of the header rather than a child — hence the shared store.
  const isOpen = useMobileMenu((state) => state.isOpen);
  const setIsOpen = useMobileMenu((state) => state.setOpen);
  const [isCartOpen, setIsCartOpen] = useState(false);
  // Mounted on first open and kept mounted after, so the close animation still
  // plays and the chunk is fetched exactly once.
  const [cartDrawerMounted, setCartDrawerMounted] = useState(false);
  useApplyOnChange([isCartOpen], () => {
    if (isCartOpen) setCartDrawerMounted(true);
  });
  const [mobileMenuMounted, setMobileMenuMounted] = useState(false);
  /**
   * The editorial drawers. The item that opened one hands over its own
   * settings, so two menu buttons (or two search icons) in one header each
   * open theirs. Kept after close, so the closing animation still has
   * something to animate; set once, the drawer's chunk stays mounted.
   */
  const [sideDrawer, setSideDrawer] = useState<{
    side: "left" | "right";
    primary: HeaderMenuItem[];
    secondary: HeaderMenuItem[];
    label: string;
  } | null>(null);
  const [sideDrawerOpen, setSideDrawerOpen] = useState(false);
  const [searchDrawer, setSearchDrawer] = useState<{
    trending: string[];
    collections: string[];
    fieldStyle: "outline" | "underline";
    fieldRadius: number;
  } | null>(null);
  const [searchDrawerOpen, setSearchDrawerOpen] = useState(false);
  useApplyOnChange([isOpen], () => {
    if (isOpen) setMobileMenuMounted(true);
  });
  const [isGuestMenuOpen, setIsGuestMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [megaMenuOpen, setMegaMenuOpen] = useState(false);
  // True while an auto-open (scheduled by the merchant, not the shopper) is
  // the reason the rail is showing; opting that open out of focus capture.
  const [megaAutoOpened, setMegaAutoOpened] = useState(false);
  // Server-seeded (see store layout). No loading state needed — the data is in
  // the initial HTML. Read straight from props (not copied into state) so a
  // router.refresh() — e.g. StorefrontRefresh after a back-nav — updates the
  // nav when categories/collections change.
  const [categoriesLoading] = useState(false);
  const categories: CategoryNode[] = initialCategories ?? [];
  const collections: CollectionItem[] = initialCollections ?? [];
  const [activeRootCategoryId, setActiveRootCategoryId] = useState<
    string | null
  >(initialCategories?.[0]?._id ?? null);
  const [activeChildCategoryId, setActiveChildCategoryId] = useState<
    string | null
  >(initialCategories?.[0]?.children?.[0]?._id ?? null);
  const categoriesMenuCloseTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const megaMenuCloseTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const guestMenuCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const userMenuCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // The All Categories button's rendered width. An item with no width of
  // its own fills its column, and the rail beneath it has to match what
  // the column gave it — read off the button rather than guessed.
  const categoriesTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [categoriesTriggerWidth, setCategoriesTriggerWidth] = useState(0);
  useEffect(() => {
    const node = categoriesTriggerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      setCategoriesTriggerWidth(Math.round(node.getBoundingClientRect().width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [mounted]);

  const headerFullWidth = headerSettings?.layout.fullWidth ?? false;
  const headerSticky = headerSettings?.layout.sticky ?? true;
  const headerColorMode = headerSettings?.layout.color ?? "light";

  // The layout tree. A store with no saved header gets the default preset;
  // memoised because the default builds fresh ids on every call. In the
  // shopper's dark theme the tree is re-painted with the merchant's dark
  // scheme (darkenHeaderLayout) — except on a "color" bar, which the theme
  // never changes.
  const darkScheme = isDark && headerColorMode !== "color";
  const darkColors = headerSettings?.colors.dark;
  const homePaths = [`/${locale}`, `/${locale}/`, "/"];
  const onHomePage = homePaths.includes(pathname);
  const tree = useMemo(() => {
    const saved = headerSettings?.builder ?? getDefaultHeaderLayout();
    // Rows marked "home page only" leave the tree everywhere else, before
    // anything measures it — so hide-on-scroll and the sticky offset count
    // only the rows actually on this page.
    const stored = onHomePage
      ? saved
      : { ...saved, rows: saved.rows.filter((row) => !row.homeOnly) };
    return darkScheme
      ? darkenHeaderLayout(
          stored,
          darkColors ?? getDefaultHeaderSettings().colors.dark,
        )
      : stored;
  }, [headerSettings, darkScheme, darkColors, onHomePage]);
  const headerTransparent = headerColorMode === "transparent";
  /**
   * The floating bar. `overlapLayout` is the LAYOUT half — true for the
   * whole home page, so the bar is pulled out of the flow once and the page
   * never reflows; only its paint follows the scroll (`overlapping`, below,
   * once `scrolled` is known).
   *
   * Desktop only, and decided in CSS (`lg:` classes) so neither size flashes
   * the other's bar before hydration. On a phone the compact bar plus its
   * search row is a third of a short hero: it sits above the hero instead.
   */
  const overlapHome = headerSettings?.layout.overlapHome ?? false;
  const overlapTone = headerSettings?.layout.overlapTone ?? "dark";
  const overlapScrim = headerSettings?.layout.overlapScrim ?? 0;
  // The shadow under a solid bar — the merchant's, or the one it always had.
  const barShadow = headerShadowCss(headerSettings?.layout.shadow);
  const overlapLayout = overlapHome && onHomePage;
  const headerLogoUrl = headerSettings?.brand.logoUrl?.trim() || "";
  const headerDarkLogoUrl = headerSettings?.brand.darkLogoUrl?.trim() || "";
  const headerLogoAlt = headerSettings?.brand.logoAlt?.trim() || "";
  const mobileLogoWidth = headerSettings?.brand.mobileLogoWidth ?? 112;
  const showSearch = headerSettings?.search.enabled ?? true;
  const showAiSearch = headerSettings?.search.showAiButton ?? true;
  const searchPlaceholder =
    headerSettings?.search.placeholder?.trim() || t("common.searchPlaceholder");
  const searchHeight = headerSettings?.search.height ?? 40;
  const searchBorderRadius = headerSettings?.search.borderRadius ?? 999;
  const searchBorderColor =
    headerSettings?.search.borderColor?.trim() || "#dddddd";
  const showLanguageSelector =
    headerSettings?.market.showLanguageSelector ?? true;
  const showCurrencySelector =
    headerSettings?.market.showCurrencySelector ?? true;
  const showMarketSelector = showLanguageSelector || showCurrencySelector;
  const showThemeToggle = headerSettings?.widgets.showThemeToggle ?? true;
  const showAccountMenu = headerSettings?.widgets.showAccountMenu ?? true;
  const showWishlist = headerSettings?.widgets.showWishlist ?? true;
  // The one switch behind every shopper-location surface — this control,
  // the listing sidebars, the nearest-first collection points at checkout.
  const showLocationPicker =
    headerSettings?.widgets.showLocationPicker ?? false;
  // Which desktop item carries the "Deliver to" control: a placed Location
  // item renders it itself, otherwise it leads the search bar (or the next
  // best host) so flipping the switch changes the header without a visit to
  // the builder; see headerLocationSlot.
  const locationSlot = useMemo(
    () =>
      showLocationPicker ? headerLocationSlot(tree, { showSearch }) : null,
    [showLocationPicker, showSearch, tree],
  );
  const locationControlFor = (itemId: string) =>
    locationSlot?.type !== "location" && locationSlot?.itemId === itemId ? (
      <LocationPickerLazy appearance="header" />
    ) : null;
  const showCategoryMenu = headerSettings?.categoryMenu.enabled ?? true;
  const showMegaMenu = headerSettings?.categoryMenu.showMegaMenu ?? true;
  const categoryMenuLabel =
    headerSettings?.categoryMenu.label?.trim() || t("common.allCategories");
  const categoryMobileLimit = headerSettings?.categoryMenu.mobileLimit ?? 8;
  const showCollectionsMenu = headerSettings?.collectionsMenu.enabled ?? true;
  const collectionsMenuLabel =
    headerSettings?.collectionsMenu.label?.trim() || t("nav.collections");
  const collectionsLimit = headerSettings?.collectionsMenu.limit ?? 12;
  const showUtilityMenu = headerSettings?.utilityMenu.enabled ?? true;
  const showMobileSearch =
    showSearch && (headerSettings?.mobile.showSearch ?? true);
  const showMobileAccountSummary =
    showAccountMenu && (headerSettings?.mobile.showAccountSummary ?? true);
  const showMobileCategoryShortcuts =
    showCategoryMenu && (headerSettings?.mobile.showCategoryShortcuts ?? true);
  const showMobileCollections =
    showCollectionsMenu && (headerSettings?.mobile.showCollections ?? true);
  const showMobileMarketSelectors =
    showMarketSelector && (headerSettings?.mobile.showMarketSelectors ?? true);
  const showMobileThemeSelector =
    showThemeToggle && (headerSettings?.mobile.showThemeSelector ?? true);
  const rawCategoryPromoHref =
    headerSettings?.categoryMenu.promoHref?.trim() || "";
  const categoryPromoHref =
    !rawCategoryPromoHref
      ? `/${locale}/products`
      : rawCategoryPromoHref.startsWith("http://") ||
    rawCategoryPromoHref.startsWith("https://")
      ? rawCategoryPromoHref
      : rawCategoryPromoHref.startsWith(`/${locale}`)
        ? rawCategoryPromoHref
        : rawCategoryPromoHref.startsWith("/")
          ? `/${locale}${rawCategoryPromoHref}`
          : `/${locale}/${rawCategoryPromoHref}`;
  const categoryPromoImageSrc =
    headerSettings?.categoryMenu.promoImageSrc?.trim() || "";
  const categoryPromoTitle =
    headerSettings?.categoryMenu.promoTitle?.trim() || "";
  const categoryPromoSubtitle =
    headerSettings?.categoryMenu.promoSubtitle?.trim() || "";
  const hasCategoryPromoContent = Boolean(
    categoryPromoTitle || categoryPromoSubtitle || categoryPromoImageSrc,
  );
  const showCategoryPromoCard =
    showCategoryMenu &&
    (headerSettings?.categoryMenu.showPromoCard ?? false) &&
    hasCategoryPromoContent;
  // "dark" pins the dark scheme regardless of the shopper's theme; "color"
  // paints theme primary instead of the custom schemes entirely.
  const activeHeaderColors =
    headerColorMode === "color"
      ? undefined
      : headerColorMode === "dark" || isDark
        ? headerSettings?.colors.dark
        : headerSettings?.colors.light;
  const headerContainerClass = headerFullWidth
    ? "w-full px-4 sm:px-6 lg:px-8"
    : "container mx-auto px-4";
  const headerThemeStyle =
    headerColorMode === "color"
      ? ({
          // Theme primary as the bar. Popovers keep the store surface —
          // a primary-colored dropdown would swallow its own content.
          "--background": "var(--primary)",
          "--foreground": "var(--primary-foreground)",
          "--muted-foreground": "var(--primary-foreground)",
        } as CSSProperties)
      : activeHeaderColors
        ? ({
            // Transparent mode keeps the custom TEXT colors but hands the
            // background to the glass treatment below — a solid custom bg
            // would defeat the whole point of the setting.
            ...(headerTransparent
              ? {}
              : { "--background": activeHeaderColors.backgroundColor }),
            "--foreground": activeHeaderColors.textColor,
            "--popover": activeHeaderColors.backgroundColor,
            "--popover-foreground": activeHeaderColors.textColor,
            "--muted-foreground": activeHeaderColors.textColor,
            "--header-search-bg": activeHeaderColors.searchBackgroundColor,
            "--header-search-text": activeHeaderColors.searchTextColor,
          } as CSSProperties)
        : undefined;
  /** The compact bar's search field, below lg — the legacy search settings. */
  const mobileSearchInputStyle = {
    ...(activeHeaderColors
      ? {
          backgroundColor: "var(--header-search-bg)",
          color: "var(--header-search-text)",
        }
      : {}),
    borderColor: searchBorderColor,
    borderRadius: searchBorderRadius,
    height: searchHeight,
  } as CSSProperties;

  const handleLogout = async () => {
    await signOutAndReload(locale);
  };

  const getDashboardLink = () => getRoleDashboardPath(locale, user?.role);

  const getSettingsLink = () => {
    const role = user?.role;
    if (role === USER_ROLES.ADMIN) return `/${locale}/admin/settings`;
    if (role === USER_ROLES.VENDOR) return `/${locale}/vendor/settings`;
    if (isStaffRole(role)) return `/${locale}/staff/profile`;
    return `/${locale}/account`;
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  // ONE rule, shared with the admin's Header style preview — see
  // resolveHeaderLogoUrl. Header-level artwork wins where it is set; the
  // store's general logos are the fallback (and, today, the only ones the
  // studio uploads).
  const lightLogoUrl =
    headerLogoUrl || (typeof logoUrl === "string" ? logoUrl : "");
  const darkLogoUrl =
    headerDarkLogoUrl ||
    (typeof darkModeLogoUrl === "string" ? darkModeLogoUrl : "");
  const currentLogoUrl = resolveHeaderLogoUrl({
    colorMode: headerColorMode,
    brand: headerSettings?.brand ?? getDefaultHeaderSettings().brand,
    isDark,
    lightLogoUrl,
    darkLogoUrl,
  });
  const brandName =
    typeof storeName === "string" && storeName.trim()
      ? storeName
      : appConfig.name;

  const handleThemeToggle = () => {
    setTheme(isDark ? "light" : "dark");
  };

  const handleLanguageSave = (newLocale: string) => {
    const currentLocale = language.code;

    // Language changes are pure navigation: the URL locale is the source of
    // truth, and the router records the choice in the locale cookie on the
    // way (rememberLocale, hooks/use-locale-navigation.ts).
    if (newLocale !== currentLocale) {
      router.push(swapLocaleInPathname(pathname, currentLocale, newLocale));
    }
  };

  const handleThemeChange = (nextMode: ThemeMode) => {
    setTheme(nextMode);
  };

  const handleMobileLanguageChange = (newLocale: string) => {
    const currentLocale = locale || language.code;

    if (newLocale !== currentLocale) {
      router.push(swapLocaleInPathname(pathname, currentLocale, newLocale));
      setIsOpen(false);
    }
  };

  const closeMobileMenu = () => setIsOpen(false);

  const openGuestMenu = () => {
    if (guestMenuCloseTimeoutRef.current) {
      clearTimeout(guestMenuCloseTimeoutRef.current);
    }
    setIsGuestMenuOpen(true);
  };

  const closeGuestMenu = () => {
    if (guestMenuCloseTimeoutRef.current) {
      clearTimeout(guestMenuCloseTimeoutRef.current);
    }

    guestMenuCloseTimeoutRef.current = setTimeout(() => {
      setIsGuestMenuOpen(false);
    }, 120);
  };

  const openUserMenu = () => {
    if (userMenuCloseTimeoutRef.current) {
      clearTimeout(userMenuCloseTimeoutRef.current);
    }
    setIsUserMenuOpen(true);
  };

  const closeUserMenu = () => {
    if (userMenuCloseTimeoutRef.current) {
      clearTimeout(userMenuCloseTimeoutRef.current);
    }

    userMenuCloseTimeoutRef.current = setTimeout(() => {
      setIsUserMenuOpen(false);
    }, 120);
  };

  const openCategoriesMenu = () => {
    if (categoriesMenuCloseTimeoutRef.current) {
      clearTimeout(categoriesMenuCloseTimeoutRef.current);
    }
    setCategoriesOpen(true);
  };

  const closeCategoriesMenu = () => {
    if (categoriesMenuCloseTimeoutRef.current) {
      clearTimeout(categoriesMenuCloseTimeoutRef.current);
    }

    categoriesMenuCloseTimeoutRef.current = setTimeout(() => {
      setCategoriesOpen(false);
    }, 120);
  };

  const openMegaMenu = () => {
    if (megaMenuCloseTimeoutRef.current) {
      clearTimeout(megaMenuCloseTimeoutRef.current);
    }
    setMegaMenuOpen(true);
  };

  const closeMegaMenu = () => {
    if (megaMenuCloseTimeoutRef.current) {
      clearTimeout(megaMenuCloseTimeoutRef.current);
    }

    megaMenuCloseTimeoutRef.current = setTimeout(() => {
      setMegaMenuOpen(false);
    }, 120);
  };

  const activeRoot =
    categories.find((c) => c._id === activeRootCategoryId) || categories[0];
  const rootChildren = activeRoot?.children || [];
  const visibleRootChildren = rootChildren.slice(0, MAX_MEGA_MENU_LEVEL_2_ITEMS);
  const rootHasNested = visibleRootChildren.some(
    (c) => (c.children?.length || 0) > 0,
  );
  const isFlatCategoryList =
    categories.length > 0 &&
    categories.every((c) => (c.children?.length || 0) === 0);
  const showPromoCards = showCategoryPromoCard;
  const activeChild =
    visibleRootChildren.find((c) => c._id === activeChildCategoryId) ||
    visibleRootChildren[0];
  const megaSource = (
    rootHasNested ? activeChild?.children || [] : visibleRootChildren
  ).slice(
    0,
    rootHasNested
      ? (activeChild?.children || []).length
      : MAX_MEGA_MENU_LEVEL_2_ITEMS,
  );
  const categoriesPageHref = `/${locale}/categories`;
  const visibleCategoryRoots = categories.slice(0, MAX_MEGA_MENU_ROOT_ITEMS);
  const hasCategoryOverflow = categories.length > MAX_MEGA_MENU_ROOT_ITEMS;
  // The rail shows every category and scrolls — the old 7-item cap silently
  // dropped the rest. Which category is open lives inside the panel.
  const megaMenuRootItems = (megaMenuItems || []).filter((item) =>
    item.label.trim(),
  );
  const hasCustomMegaMenu =
    showCategoryMenu && showMegaMenu && megaMenuRootItems.length > 0;

  const setActiveRoot = (root: CategoryNode) => {
    setActiveRootCategoryId(root._id);
    setActiveChildCategoryId(
      root.children?.slice(0, MAX_MEGA_MENU_LEVEL_2_ITEMS)[0]?._id ?? null,
    );
  };

  /**
   * A categories item set to "always open" drops its panel the moment the
   * page lands, the way the big marketplaces keep their department list
   * showing — and again on every navigation, since the shopper may have
   * closed it on the last page. Dismissable: reopening a panel the shopper
   * just closed would make it undismissable.
   */
  const pinnedCategories = tree.rows.some((row) =>
    row.columns.some((column) =>
      column.items.some(
        (item) => item.type === "categories" && item.openOn === "always",
      ),
    ),
  );
  // Radix portals the panel to the body — opening it below the tree's
  // breakpoint would float a detached panel over a bar that has no trigger.
  const wideEnoughForRail = useMediaQuery("(min-width: 1024px)");
  useApplyOnChange(
    [pinnedCategories, hasCustomMegaMenu, pathname, wideEnoughForRail],
    () => {
      if (!pinnedCategories || !wideEnoughForRail) return;
      setMegaAutoOpened(true);
      if (hasCustomMegaMenu) setMegaMenuOpen(true);
      else setCategoriesOpen(true);
    },
  );

  /**
   * Rows marked "hide on scroll" go two ways.
   *
   * The ones at the TOP of the header — the usual case, a utility strip —
   * are hidden by the browser: the sticky wrapper's `top` is minus their
   * height, so they slide off above the viewport as the page scrolls and
   * come back at the top. No script, no reflow, nothing to jitter.
   *
   * A hiding row sitting BELOW a fixed row cannot be slid off without taking
   * the fixed row with it, so it folds instead — and folding changes the
   * page's height, which on a short page moves the scroll position and
   * would re-trigger the fold. So it follows the scroll DIRECTION with a
   * dead band, and ignores the scroll events of its own settling.
   */
  const leadingHidingRows = (() => {
    let count = 0;
    for (const row of tree.rows) {
      if (!row.hideOnScroll) break;
      count += 1;
    }
    return count;
  })();
  const hasFoldingRows = tree.rows.some(
    (row, index) => row.hideOnScroll && index >= leadingHidingRows,
  );
  /**
   * Whether a hidden row comes back as soon as the page scrolls up, or only
   * at its top. "auto" is by position: a top row rides off with the page
   * (the wrapper's sticky offset) and returns at the top; a lower row folds
   * and returns on scroll-up. Either can be told otherwise.
   */
  const rowReturnsOnScrollUp = (row: HeaderLayoutRow, index: number) =>
    row.returnOn === "scrollUp" ||
    (row.returnOn === "auto" && index >= leadingHidingRows);
  const hasScrollUpLeading = tree.rows
    .slice(0, leadingHidingRows)
    .some((row) => row.returnOn === "scrollUp");
  /**
   * A brand with a scroll size shrinks to it once scrolled, and its row
   * compacts by the same ratio — the header that tightens as you read. It
   * rides on the same direction-and-dead-band state as the folding rows,
   * for the same reason: its reflow must not be able to re-trigger itself.
   */
  const brandScaleOf = (row: HeaderLayoutRow): number => {
    for (const column of row.columns) {
      for (const item of column.items) {
        if (item.type === "brand" && item.scrollSize > 0 && item.size > 0) {
          return Math.min(1, item.scrollSize / item.size);
        }
      }
    }
    return 1;
  };
  const hasScalingBrand = tree.rows.some((row) => brandScaleOf(row) < 1);
  const [scrolled, setScrolled] = useState(false);
  /**
   * Whether the page has scrolled past the top zone at all — no intent, no
   * dead band. A hidden row that returns only at the top reads this.
   */
  const [pastTop, setPastTop] = useState(false);
  /**
   * Whether the page sits at its very top. The overlap reads THIS, not
   * `scrolled`: the fold's state is about intent — a short scroll back up
   * unfolds the header anywhere on the page — and painting the bar
   * transparent again over the middle of a listing left it floating over
   * content with no hero behind it. Transparent means "the hero is still
   * behind me", and that is only ever true at the top.
   */
  const [atTop, setAtTop] = useState(true);
  useEffect(() => {
    if (!overlapLayout) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      // A few pixels of slack: a rubber-band bounce must not flip it.
      setAtTop(window.scrollY <= 8);
    };
    update();
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [overlapLayout]);
  // The fold and the shrinking brand follow scroll INTENT, below.
  useEffect(() => {
    if (!hasFoldingRows && !hasScalingBrand && !hasScrollUpLeading) return;
    let frame = 0;
    let lastY = window.scrollY;
    let settleUntil = 0;
    // Intent, not jitter: a flick of a few pixels — or the page shortening
    // as the row folds — must not flip the header. Travel in one direction
    // accumulates and only commits past a real distance; reversing resets
    // it. A single per-event threshold sat exactly on the boundary and
    // toggled the fold back and forth at one scroll position.
    const COMMIT = 24;
    const TOP_ZONE = 64;
    let travel = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const delta = y - lastY;
      lastY = y;
      if (performance.now() < settleUntil) return;
      // Near the top the header is always whole; the zone is wide enough
      // that a fold's own reflow cannot bounce back across it.
      setPastTop(y >= TOP_ZONE);
      let next: boolean | null = null;
      if (y < TOP_ZONE) {
        travel = 0;
        next = false;
      } else {
        travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
        if (travel > COMMIT) next = true;
        else if (travel < -COMMIT) next = false;
      }
      if (next === null) return;
      setScrolled((current) => {
        if (current === next) return current;
        travel = 0;
        // The fold takes 220ms; scroll events in that window are its own.
        settleUntil = performance.now() + 340;
        return next;
      });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [hasFoldingRows, hasScalingBrand, hasScrollUpLeading]);

  /** Transparent while the hero is still behind it — at the top of the home
   * page, and nowhere else; normal from the first scroll on. */
  const overlapping = overlapLayout && atTop;
  const overlapInk = overlapTone === "dark" ? "#ffffff" : "#111111";
  /**
   * The tree as the floating bar paints it. Kept apart from `tree` so the
   * structural reads above it (folding rows, the brand scale) stay on the
   * stored one — only what is DRAWN changes as the hero passes.
   */
  const paintedTree = useMemo(
    () => (overlapping ? clearHeaderLayoutInk(tree) : tree),
    [overlapping, tree],
  );
  // A blurred row shows what scrolls beneath it, so the bar's own opaque
  // paint stands down and each row carries its own.
  const rowsPaintThemselves = tree.rows.some((row) => row.blur > 0);

  // Publish the sticky header's height so store pages can position their own
  // sticky elements below it — the height that STAYS on screen, so the
  // leading hiding rows (slid off once scrolled) do not count. Their height
  // is also what the wrapper's `top` retreats by.
  const stickyWrapperRef = useRef<HTMLDivElement>(null);
  const [leadingHeights, setLeadingHeights] = useState<number[]>([]);
  /**
   * How far the wrapper retreats: the heights of the leading hiding rows,
   * in order, up to the first one that is showing. A row that returns at
   * the top always counts — it rides off with the page and comes back with
   * it; one that returns on scroll-up counts only while the scroll is down.
   */
  const hiddenOffset = useMemo(() => {
    let offset = 0;
    for (let index = 0; index < leadingHidingRows; index += 1) {
      const row = tree.rows[index];
      const hidden = rowReturnsOnScrollUp(row, index) ? scrolled : true;
      if (!hidden) break;
      offset += leadingHeights[index] ?? 0;
    }
    return offset;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rowReturnsOnScrollUp reads only leadingHidingRows
  }, [leadingHeights, leadingHidingRows, scrolled, tree.rows]);
  /**
   * The bar's height AT REST, which is what the overlap pulls back out of
   * the flow. Measured only while the page is at the top: once scrolled, a
   * folding row shrinks the bar, and following that shrink would slide the
   * whole page up underneath it.
   */
  const [restHeight, setRestHeight] = useState(0);
  /**
   * A floating bar before its resting height is known — the server render,
   * and the first client frames. It cannot be pulled out of the flow by a
   * margin yet, so it takes no room another way: absolute, at its own
   * static position. The hero is under it from the first paint, instead of
   * a white band above the hero until the measurement lands.
   */
  const floatingUnmeasured = overlapLayout && restHeight === 0;
  // Read inside the observer below, which must not re-subscribe every time
  // the scroll state flips. Synced in its own effect, which runs before any
  // resize the fold goes on to produce.
  const scrolledRef = useRef(scrolled);
  useEffect(() => {
    scrolledRef.current = scrolled;
  }, [scrolled]);

  useEffect(() => {
    const el = stickyWrapperRef.current;
    if (!el) return;
    const root = document.documentElement;
    // A folding row's height changes every frame of its animation, and this
    // observer fires on each one. Writing the variable only when the rounded
    // value actually moved keeps the fold to one composited animation
    // instead of a style recalculation per frame.
    let published = -1;
    const update = () => {
      const rows = el.querySelectorAll<HTMLElement>("[data-header-row]");
      const heights: number[] = [];
      for (let index = 0; index < leadingHidingRows; index += 1) {
        heights.push(rows[index]?.offsetHeight ?? 0);
      }
      const hidden = heights.reduce((sum, height) => sum + height, 0);
      setLeadingHeights((current) =>
        current.length === heights.length &&
        current.every((height, index) => height === heights[index])
          ? current
          : heights,
      );
      if (!scrolledRef.current) {
        const rest = Math.round(el.offsetHeight);
        setRestHeight((current) => (current === rest ? current : rest));
      }
      const height = headerSticky
        ? Math.max(0, Math.round(el.offsetHeight - hidden))
        : 0;
      if (height === published) return;
      published = height;
      root.style.setProperty("--storefront-header-height", `${height}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const row of el.querySelectorAll("[data-header-row]")) {
      observer.observe(row);
    }
    return () => {
      observer.disconnect();
      root.style.removeProperty("--storefront-header-height");
    };
  }, [headerSticky, leadingHidingRows, mounted]);

  useEffect(() => {
    return () => {
      if (categoriesMenuCloseTimeoutRef.current) {
        clearTimeout(categoriesMenuCloseTimeoutRef.current);
      }
      if (megaMenuCloseTimeoutRef.current) {
        clearTimeout(megaMenuCloseTimeoutRef.current);
      }
      if (guestMenuCloseTimeoutRef.current) {
        clearTimeout(guestMenuCloseTimeoutRef.current);
      }
      if (userMenuCloseTimeoutRef.current) {
        clearTimeout(userMenuCloseTimeoutRef.current);
      }
    };
  }, []);

  /**
   * The search icon set to open the drawer: the same button and capsule the
   * inline search draws, minus the field — the drawer is where typing
   * happens, so a field here would be a second, narrower one.
   */
  const renderSearchDrawerTrigger = (
    item: HeaderSearchIconItem,
    pill: boolean,
  ) => {
    const open = () => openSearchDrawerFor(item);
    const labelled = item.showLabel && !pill && Boolean(item.label);
    const glyph = (
      <span
        className={cn(
          "shrink-0",
          labelled ? "flex items-center" : "grid place-items-center",
        )}
        style={{
          borderRadius: item.roundness,
          padding: pill ? "8px 14px" : 8,
          ...backgroundCss(item.background),
          ...surfaceInkCss(item.background, item.foreground),
        }}
      >
        <Search style={{ width: item.size, height: item.size }} />
        {labelled ? (
          <span className="ms-2 text-sm font-semibold">{item.label}</span>
        ) : null}
      </span>
    );
    return (
      <button
        type="button"
        onClick={open}
        aria-label={searchPlaceholder}
        aria-haspopup="dialog"
        className="relative shrink-0 transition-opacity hover:opacity-80"
        style={paddingStyle(item.padding)}
      >
        {pill ? (
          <span
            className="flex items-center justify-end gap-1 p-1 pl-3"
            style={{
              width: item.width,
              borderRadius: item.pillRoundness,
              borderWidth: item.borderThickness,
              borderStyle: "solid",
              borderColor: item.border || "transparent",
              ...backgroundCss(item.pillBackground),
              ...surfaceInkCss(item.pillBackground),
            }}
          >
            {glyph}
          </span>
        ) : (
          glyph
        )}
      </button>
    );
  };

  /** A link's target as the studio stored it, made absolute for this locale. */
  const hrefFor = (raw: string) => {
    const url = raw.trim();
    if (!url) return `/${locale}`;
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("#")) return url;
    if (url.startsWith("/")) {
      return url === `/${locale}` || url.startsWith(`/${locale}/`)
        ? url
        : `/${locale}${url}`;
    }
    return `/${locale}/${url}`;
  };

  const isCurrentPath = (href: string) =>
    pathname === href ||
    (href !== `/${locale}` && !href.startsWith("http") && pathname.startsWith(href));

  /* ------------------------------------------------------------------ *
   * Shared controls — drawn by more than one item type.                *
   * ------------------------------------------------------------------ */

  /** The account menu content — for a signed-in shopper. */
  const userMenuContent = user ? (
    <DropdownMenuContent
      align="end"
      className="w-56"
      onMouseEnter={openUserMenu}
      onMouseLeave={closeUserMenu}
    >
      <DropdownMenuLabel>
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{user.name}</span>
          <span
            className="truncate text-xs text-muted-foreground"
            title={user.email}
          >
            {user.email}
          </span>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {getDashboardLink() ? (
        <>
          <DropdownMenuItem asChild>
            <Link href={getDashboardLink()!}>
              <Package className="mr-2 h-4 w-4" />
              {t("common.dashboard")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={getSettingsLink()}>
              <Settings className="mr-2 h-4 w-4" />
              {t("admin.settings.title")}
            </Link>
          </DropdownMenuItem>
        </>
      ) : (
        <>
          <DropdownMenuItem asChild>
            <Link href={`/${locale}/account`}>
              <User className="mr-2 h-4 w-4" />
              {t("common.account")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/${locale}/account/orders`}>
              <Package className="mr-2 h-4 w-4" />
              {t("orders.myOrders")}
            </Link>
          </DropdownMenuItem>
          {showWishlist && (
            <DropdownMenuItem asChild>
              <Link href={`/${locale}/account/wishlist`}>
                <Heart className="mr-2 h-4 w-4" />
                {t("nav.wishlist") || "Wishlist"}
                {wishlistItems.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-auto h-5 px-1.5 text-[10px]"
                  >
                    {wishlistItems.length}
                  </Badge>
                )}
              </Link>
            </DropdownMenuItem>
          )}
        </>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={handleLogout} className="text-destructive">
        <LogOut className="mr-2 h-4 w-4" />
        {t("common.logout")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  ) : null;

  /** The account menu content — for a guest. */
  const guestMenuContent = (
    <DropdownMenuContent
      align="end"
      side="bottom"
      sideOffset={10}
      className="w-[310px] rounded-4xl border border-[#ececec] bg-[#f5f5f5] p-0 text-zinc-900 shadow-[0_18px_40px_rgba(15,23,42,0.2)] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:shadow-[0_18px_40px_rgba(0,0,0,0.5)]"
      onMouseEnter={openGuestMenu}
      onMouseLeave={closeGuestMenu}
    >
      <div className="px-5 pb-5 pt-4">
        <Link
          href={buildLoginUrl(locale, pathname)}
          onClick={() => setIsGuestMenuOpen(false)}
          className="flex h-10 w-full items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-primary-foreground hover:bg-primary/90"
        >
          {t("common.signIn")}
        </Link>
        <Link
          href={`/${locale}/register`}
          onClick={() => setIsGuestMenuOpen(false)}
          className="mt-3 block text-center text-[16px] text-zinc-700 transition-colors hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
        >
          {t("common.register")}
        </Link>
        <div className="mt-3 border-t border-[#dbdbdb] dark:border-zinc-700" />

        <div className="mt-3 space-y-0.5">
          <DropdownMenuItem asChild className="h-10 rounded-md px-2.5">
            <Link href={buildLoginUrl(locale, `/${locale}/account`)}>
              <LayoutDashboard className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
              <span className="text-[14px] leading-none">
                {t("common.dashboard")}
              </span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="h-10 rounded-md px-2.5">
            <Link href={buildLoginUrl(locale, `/${locale}/account/orders`)}>
              <Package className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
              <span className="text-[14px] leading-none">
                {t("common.myOrders")}
              </span>
            </Link>
          </DropdownMenuItem>
          {showWishlist && (
            <DropdownMenuItem asChild className="h-10 rounded-md px-2.5">
              <Link
                href={buildLoginUrl(locale, `/${locale}/account/wishlist`)}
              >
                <Heart className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
                <span className="text-[14px] leading-none">
                  {t("nav.wishlist")}
                </span>
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild className="h-10 rounded-md px-2.5">
            <Link href={buildLoginUrl(locale, `/${locale}/account/profile`)}>
              <User className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
              <span className="text-[14px] leading-none">
                {t("common.profile")}
              </span>
            </Link>
          </DropdownMenuItem>
        </div>
      </div>
    </DropdownMenuContent>
  );

  /** The language picker, opened from whatever trigger an item draws. */
  const languagePopover = (trigger: ReactNode) => (
    <LanguagePopover
      trigger={trigger}
      currentCode={language.code}
      languages={languages}
      onSave={handleLanguageSave}
    />
  );

  /** The cart button; the badge counts what is in the cart. */
  /**
   * `showGlyph` off makes the label the control — the icons cluster set to
   * words only. The count badge moves onto whichever of the two is actually
   * on screen, so a bag holding three items says so either way.
   */
  const cartButton = (
    size: number,
    label: ReactNode = null,
    showGlyph = true,
  ) => (
    <button
      type="button"
      onClick={() => setIsCartOpen(true)}
      className="flex flex-col items-center gap-1 transition-opacity hover:opacity-70"
      aria-label={t("common.openCart")}
    >
      {showGlyph ? (
        <>
          <CartCount size={size}>
            <ShoppingCart style={{ width: size, height: size }} />
          </CartCount>
          {label}
        </>
      ) : (
        <CartCount size={size}>{label}</CartCount>
      )}
    </button>
  );

  /**
   * The flat category panel — the "All Categories" dropdown for a store
   * without a custom mega menu: its category tree, column by column.
   */
  const flatCategoryPanel = isFlatCategoryList ? (
    <div className="space-y-1">
      {categoriesLoading ? (
        <div className="space-y-2 p-1">
          {Array.from({ length: 10 }).map((_, idx) => (
            <div
              key={idx}
              className="h-10 w-full animate-pulse rounded-sm bg-muted/60"
            />
          ))}
        </div>
      ) : categories.length > 0 ? (
        <>
          {visibleCategoryRoots.map((root) => (
            <Link
              key={root._id}
              href={`/${locale}/products?category=${encodeURIComponent(
                root.slug,
              )}`}
              onClick={() => setCategoriesOpen(false)}
              className="flex items-center rounded-md px-3 py-2 text-sm text-foreground/90 hover:bg-muted"
            >
              <span className="inline-flex min-w-0 items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-md bg-muted/40">
                  {root.icon || root.image ? (
                    <AppImage
                      src={(root.icon || root.image) as string}
                      alt={root.name}
                      className="h-8 w-8 rounded-md object-cover"
                      width={32}
                      height={32}
                    />
                  ) : (
                    <Package className="h-4 w-4 text-muted-foreground" />
                  )}
                </span>
                <span className="truncate">{root.name}</span>
              </span>
            </Link>
          ))}
          {hasCategoryOverflow ? (
            <Link
              href={categoriesPageHref}
              onClick={() => setCategoriesOpen(false)}
              className="mt-1 flex h-10 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted"
            >
              View All
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : null}
        </>
      ) : (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          {t("common.noCategories")}
        </div>
      )}
    </div>
  ) : (
    <div
      className={`grid ${
        rootHasNested
          ? showPromoCards
            ? "grid-cols-[260px_220px_1fr_340px]"
            : "grid-cols-[260px_220px_1fr]"
          : showPromoCards
            ? "grid-cols-[260px_1fr_340px]"
            : "grid-cols-[260px_1fr]"
      }`}
    >
      <div className="bg-popover p-3">
        <div className="space-y-1">
          {categoriesLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-10 w-full animate-pulse rounded-lg bg-muted/60"
                />
              ))}
            </div>
          ) : categories.length > 0 ? (
            <>
              {visibleCategoryRoots.map((root) => {
                const isActive = activeRoot?._id === root._id;
                const hasChildren = (root.children?.length || 0) > 0;
                return (
                  <Link
                    key={root._id}
                    href={`/${locale}/products?category=${encodeURIComponent(
                      root.slug,
                    )}`}
                    onMouseEnter={() => setActiveRoot(root)}
                    onClick={() => setCategoriesOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-colors ${
                      isActive
                        ? "bg-muted text-foreground"
                        : "text-foreground/85 hover:bg-muted/60"
                    }`}
                  >
                    <span className="grid h-5 w-5 shrink-0 place-items-center text-foreground/70">
                      {root.icon || root.image ? (
                        <AppImage
                          src={(root.icon || root.image) as string}
                          alt={root.name}
                          width={20}
                          height={20}
                          className="h-5 w-5 object-contain"
                        />
                      ) : (
                        <Package className="h-4 w-4" />
                      )}
                    </span>
                    <span className="flex-1 truncate">{root.name}</span>
                    {hasChildren && rootHasNested && (
                      <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-muted-foreground" />
                    )}
                  </Link>
                );
              })}
              {hasCategoryOverflow ? (
                <Link
                  href={categoriesPageHref}
                  onClick={() => setCategoriesOpen(false)}
                  className="mt-2 flex h-10 items-center justify-center gap-2 rounded-lg border bg-background px-3 text-[13px] font-medium text-foreground hover:bg-muted"
                >
                  View All
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : null}
            </>
          ) : (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              {t("common.noCategories")}
            </div>
          )}
        </div>
      </div>

      {rootHasNested && (
        <div className="bg-popover p-3">
          <div className="space-y-1">
            {visibleRootChildren.map((child) => {
              const isActive = activeChild?._id === child._id;
              const hasChildren = (child.children?.length || 0) > 0;
              return (
                <Link
                  key={child._id}
                  href={`/${locale}/products?category=${encodeURIComponent(
                    child.slug,
                  )}`}
                  onMouseEnter={() => setActiveChildCategoryId(child._id)}
                  onClick={() => setCategoriesOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-colors ${
                    isActive
                      ? "bg-muted text-foreground"
                      : "text-foreground/85 hover:bg-muted/60"
                  }`}
                >
                  <span className="grid h-5 w-5 shrink-0 place-items-center text-foreground/70">
                    {child.icon || child.image ? (
                      <AppImage
                        src={(child.icon || child.image) as string}
                        alt={child.name}
                        width={20}
                        height={20}
                        className="h-5 w-5 object-contain"
                      />
                    ) : (
                      <Package className="h-4 w-4" />
                    )}
                  </span>
                  <span className="flex-1 truncate">{child.name}</span>
                  {hasChildren && (
                    <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-muted-foreground" />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-popover px-8 py-6">
        {megaSource.length > 0 ? (
          <div className="grid grid-cols-2 gap-x-10 gap-y-3">
            {megaSource.map((col) => (
              <Link
                key={col._id}
                href={`/${locale}/products?category=${encodeURIComponent(
                  col.slug,
                )}`}
                onClick={() => setCategoriesOpen(false)}
                className="flex items-center gap-2 text-[13px] text-foreground/85 transition-colors hover:text-primary"
              >
                {col.icon || col.image ? (
                  <AppImage
                    src={(col.icon || col.image) as string}
                    alt={col.name}
                    width={20}
                    height={20}
                    className="h-5 w-5 shrink-0 object-contain"
                  />
                ) : (
                  <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{col.name}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            {t("common.selectCategory")}
          </div>
        )}
      </div>

      {showPromoCards && (
        <div className="bg-popover p-4">
          <Link
            href={categoryPromoHref}
            className="group relative flex h-full flex-col overflow-hidden rounded-2xl bg-linear-to-br from-[#eceaf6] via-[#f1ecf6] to-[#dfd6ef] p-5"
          >
            {categoryPromoTitle ? (
              <div className="text-[15px] font-semibold leading-tight text-foreground">
                {categoryPromoTitle}
              </div>
            ) : null}
            {categoryPromoSubtitle ? (
              <div className="mt-1 inline-flex items-center gap-1 text-[13px] text-foreground/75">
                {categoryPromoSubtitle}
                <Sparkles className="h-3.5 w-3.5 text-fuchsia-500" />
              </div>
            ) : null}
            {categoryPromoImageSrc ? (
              <div className="relative mt-auto flex h-40 items-end justify-center pt-4">
                <AppImage
                  src={categoryPromoImageSrc}
                  width={220}
                  height={220}
                  alt={categoryPromoTitle || "Header promo"}
                  aria-hidden="true"
                  className="h-full w-auto object-contain transition-transform duration-300 group-hover:scale-105"
                  loading="lazy"
                />
              </div>
            ) : null}
          </Link>
        </div>
      )}
    </div>
  );

  const flatPanelClass = isFlatCategoryList
    ? "w-75 rounded-t-none border-0 p-2"
    : rootHasNested
      ? showPromoCards
        ? "w-275 overflow-hidden rounded-t-none border-0 p-0"
        : "w-235 overflow-hidden rounded-t-none border-0 p-0"
      : showPromoCards
        ? "w-235 overflow-hidden rounded-t-none border-0 p-0"
        : "w-195 overflow-hidden rounded-t-none border-0 p-0";

  /* ------------------------------------------------------------------ *
   * The layout tree's items.                                           *
   * ------------------------------------------------------------------ */

  const renderBrand = (item: HeaderBrandItem, rowTone: SurfaceTone | null) => {
    // "auto" reads the surface BEHIND the logo: the row's own paint when it
    // has one, else the bar (resolveHeaderLogoUrl). A dark row on a light
    // store wants the inverse logo whatever the shopper's theme says.
    const autoLogo =
      rowTone === "dark"
        ? darkLogoUrl || lightLogoUrl
        : rowTone === "light"
          ? lightLogoUrl || darkLogoUrl
          : currentLogoUrl;
    const logo =
      item.theme === "dark"
        ? darkLogoUrl || currentLogoUrl
        : item.theme === "light"
          ? lightLogoUrl || currentLogoUrl
          : autoLogo;
    const width =
      scrolled && item.scrollSize > 0
        ? Math.min(item.scrollSize, item.size)
        : item.size;
    return (
      <Link
        href={`/${locale}`}
        className="flex shrink-0 items-center gap-2"
        style={paddingStyle(item.padding)}
      >
        {logo ? (
          // Sized by WIDTH, the axis the studio's Size field sets: the
          // height follows the artwork's own proportions, the way the
          // preview draws it. A fixed-height box would cap a wide logo at
          // whatever width fits 32px and ignore the setting past that.
          <span
            className="relative block transition-[width] duration-200 ease-out"
            style={{ width }}
          >
            <AppImage
              src={logo}
              alt={headerLogoAlt || storeName || "Logo"}
              className="h-auto w-full object-contain object-left"
              width={Math.round(item.size)}
              height={Math.round(item.size / 4)}
              priority
            />
          </span>
        ) : (
          <>
            <Store className="h-6 w-6 text-primary" />
            <span className="truncate text-xl font-bold">{brandName}</span>
          </>
        )}
      </Link>
    );
  };

  /** One nav link: its glyph or image, its label, a dropdown for children. */
  const renderNavLink = (link: HeaderNavLink, fill: HeaderFill) => {
    const labelFill = fillTextCss(fill);
    const icon = linkGlyph(link.icon) ? (
      <LinkGlyphIcon icon={link.icon} className="h-4 w-4 shrink-0 opacity-80" />
    ) : link.icon ? (
      <AppImage
        src={link.icon}
        alt=""
        width={16}
        height={16}
        className="h-4 w-4 shrink-0 object-contain"
      />
    ) : null;
    const label = link.label || "Link";
    // A linked menu wins over the link's own sub-links, which stay stored.
    // An unlinked, missing or empty menu falls through to them.
    const megaItems = link.megaMenu ? linkedMenus?.[link.megaMenu] : undefined;
    if (megaItems && megaItems.length > 0) {
      return (
        <NavMegaDropdown
          key={link.id}
          label={<span style={labelFill}>{label}</span>}
          icon={icon}
          labelStyle={fillColorCss(fill)}
          items={megaItems}
        />
      );
    }
    if (link.children.length > 0) {
      return (
        <NavDropdown
          key={link.id}
          label={<span style={labelFill}>{label}</span>}
          icon={icon}
          hrefFor={hrefFor}
          labelStyle={fillColorCss(fill)}
          menu={link.menu}
        >
          {link.children}
        </NavDropdown>
      );
    }
    const href = hrefFor(link.url);
    return (
      <Link
        key={link.id}
        href={href}
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap transition-opacity hover:opacity-75",
          isCurrentPath(href) ? "opacity-100" : "opacity-90",
        )}
      >
        {icon}
        <span style={labelFill}>{label}</span>
      </Link>
    );
  };

  /**
   * The Collections trigger: the store's OWN collections as a thumbnail
   * grid. Nothing here is authored in the header — the panel is the
   * catalogue, so publishing a collection puts it in the menu. It renders
   * nothing at all when the store has none, rather than dropping an empty
   * panel under a live trigger.
   */
  const renderCollections = (item: HeaderCollectionsItem) => {
    const shown = collections.slice(0, item.limit);
    if (shown.length === 0) return null;
    return (
      <span style={paddingStyle(item.padding)}>
        <CollectionsMenu
          label={item.label || t("nav.collections")}
          labelStyle={textStyleCss(item.textStyle)}
          showChevron={item.showChevron}
          columns={item.columns}
          showDescription={item.showDescription}
          viewAllHref={item.showViewAll ? `/${locale}/collections` : ""}
          viewAllLabel={t.has("nav.viewAllCollections")
            ? t("nav.viewAllCollections")
            : t("common.viewAll")}
          collections={shown.map((collection) => ({
            id: collection._id,
            title: collection.title,
            href: `/${locale}/collections/${collection.handle || collection.slug}`,
            image: collection.image?.url ?? "",
            description: collection.description ?? "",
          }))}
        />
      </span>
    );
  };

  const renderNav = (item: HeaderNavItem) => {
    return (
      <OverflowNav
        className="flex min-w-0 flex-1 items-center"
        style={{
          ...paddingStyle(item.padding),
          gap: item.gap,
          justifyContent: navJustifyContent(item),
          alignItems: alignItemsValue(item.align.vertical),
          ...backgroundCss(item.background),
          ...surfaceInkCss(item.background, item.textStyle.fill),
          ...textStyleCss(item.textStyle),
        }}
      >
        {item.links.map((link) => renderNavLink(link, item.textStyle.fill))}
      </OverflowNav>
    );
  };

  /**
   * The All Categories trigger, and under it the store's category panel:
   * the custom mega menu when the merchant built one, the catalogue tree
   * otherwise. The button is painted from the item; the panel takes the
   * item's panel colours through the same tokens it already reads.
   */
  const renderCategories = (item: HeaderCategoriesItem) => {
    if (!showCategoryMenu) return null;
    const mega = hasCustomMegaMenu;
    const open = mega ? megaMenuOpen : categoriesOpen;
    const hover =
      item.openOn === "hover"
        ? mega
          ? { onMouseEnter: openMegaMenu, onMouseLeave: closeMegaMenu }
          : {
              onMouseEnter: openCategoriesMenu,
              onMouseLeave: closeCategoriesMenu,
            }
        : {};
    const r = item.roundness;
    // The glyphs take the item's foreground, else the label's fill, else
    // the ink the button's own plate calls for (see surfaceInkCss).
    const glyphFill = surfaceInkCss(
      item.background,
      hasBackground(item.foreground) ? item.foreground : item.textStyle.fill,
    );
    // The item's padding is the room AROUND the button; the button's own
    // inset stays, so the glyph never sits on the edge of its plate.
    const trigger = (
      <button
        ref={categoriesTriggerRef}
        type="button"
        {...hover}
        className={cn(
          "flex items-center gap-3 px-5 text-left transition-opacity hover:opacity-90",
          item.width ? "shrink-0" : "min-w-0 flex-1",
        )}
        style={{
          margin: `${item.padding.top}px ${item.padding.right}px ${item.padding.bottom}px ${item.padding.left}px`,
          width: item.width || undefined,
          height: item.height || 40,
          // Squared off while the panel is open so the button and the panel
          // below it read as one card rather than a button parked above it.
          borderRadius: open ? `${r}px ${r}px 0 0` : r,
          borderWidth: item.borderThickness,
          borderStyle: "solid",
          borderColor: item.border || "transparent",
          ...backgroundCss(item.background),
          ...textStyleCss(item.textStyle),
          ...glyphFill,
        }}
      >
        {item.showIcon ? (
          <CategoryTriggerGlyph icon={item.icon} className="h-4 w-4 shrink-0" />
        ) : null}
        <span
          className="min-w-0 flex-1 truncate"
          style={fillTextCss(item.textStyle.fill)}
        >
          {item.label || categoryMenuLabel}
        </span>
        {item.showChevron ? (
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        ) : null}
      </button>
    );
    const panelBg = backgroundAccentColor(item.panel.background);
    // The panel portals out to the page, so an unset foreground would take
    // the PAGE's ink; a painted panel picks its own instead.
    const panelFg = surfaceInkCss(
      item.panel.background,
      item.panel.foreground,
    ).color;
    const highlight = backgroundAccentColor(item.panel.highlight);
    const panelVars = {
      ...(panelBg ? { "--popover": panelBg, "--background": panelBg } : {}),
      ...(panelFg
        ? {
            "--popover-foreground": panelFg,
            "--foreground": panelFg,
            "--muted-foreground": panelFg,
          }
        : {}),
      ...(highlight ? { "--muted": highlight } : {}),
    } as CSSProperties;
    const railWidth =
      item.panel.width || item.width || categoriesTriggerWidth || 232;

    return mega ? (
      <Popover open={megaMenuOpen} onOpenChange={setMegaMenuOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={2}
          {...hover}
          // An auto-opened rail must not pull focus: nobody asked for it,
          // and landing a keyboard or screen-reader user inside a menu on
          // page load is disorienting.
          onOpenAutoFocus={(event) => {
            if (!megaAutoOpened) return;
            setMegaAutoOpened(false);
            event.preventDefault();
          }}
          className="w-auto max-w-[calc(100vw-2rem)] border-0 bg-transparent p-0 shadow-none"
        >
          <div style={panelVars}>
            <CustomMegaMenuPanel
              roots={megaMenuRootItems}
              railLabel={item.label || categoryMenuLabel}
              viewAllHref={categoriesPageHref}
              viewAllLabel={t("home.viewAllCategories")}
              viewAllShortLabel={t("common.viewAll")}
              railRadius={r}
              railWidth={railWidth}
              onNavigate={() => setMegaMenuOpen(false)}
            />
          </div>
        </PopoverContent>
      </Popover>
    ) : (
      <Popover open={categoriesOpen} onOpenChange={setCategoriesOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={2}
          {...hover}
          onOpenAutoFocus={(event) => {
            if (!megaAutoOpened) return;
            setMegaAutoOpened(false);
            event.preventDefault();
          }}
          className={flatPanelClass}
          style={{
            ...panelVars,
            borderBottomLeftRadius: r,
            borderBottomRightRadius: r,
          }}
        >
          {flatCategoryPanel}
        </PopoverContent>
      </Popover>
    );
  };

  /** The search bar: a field, an optional category scope, the AI shortcut. */
  const renderSearchBar = (item: HeaderSearchBarItem) => {
    if (!showSearch) return null;
    const locationControl = locationControlFor(item.id);
    const form = <HeaderSearchBar item={item} placeholder={searchPlaceholder} />;
    // "Deliver to" leads the bar, the way every marketplace with a search
    // bar places it. Only wrapped when it is actually there, so a plain bar
    // keeps the exact box it had.
    return locationControl ? (
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {locationControl}
        {form}
      </div>
    ) : (
      form
    );
  };

  /**
   * The compact search: a button that submits, with a field that opens
   * beside it when the button is pressed with nothing typed. In pill style
   * the field is always showing, inside the capsule.
   */
  const renderSearchIcon = (item: HeaderSearchIconItem) => {
    if (!showSearch) return null;
    const locationControl = locationControlFor(item.id);
    if (locationControl) {
      // A header with no search bar hangs the control beside its compact
      // search instead; rendered once through the same path so the two do
      // not drift.
      return (
        <div className="flex shrink-0 items-center gap-3">
          {locationControl}
          {renderSearchIconOnly(item)}
        </div>
      );
    }
    return renderSearchIconOnly(item);
  };

  const renderSearchIconOnly = (item: HeaderSearchIconItem) =>
    item.drawer ? (
      renderSearchDrawerTrigger(item, item.style === "pill")
    ) : (
      <HeaderSearchIconField item={item} placeholder={searchPlaceholder} />
    );

  const renderButtons = (item: HeaderButtonsItem) => {
    const solid = item.variant === "solid";
    const outline = item.variant === "outline";
    return (
      <div
        className="flex shrink-0 items-center"
        style={{ ...paddingStyle(item.padding), gap: item.gap }}
      >
        {item.buttons.map((button) => (
          <Link
            key={button.id}
            href={hrefFor(button.url)}
            className={cn(
              "inline-flex items-center whitespace-nowrap px-4 py-2 transition-opacity hover:opacity-85",
              outline && "border",
              item.variant === "ghost" && "opacity-80",
            )}
            style={{
              ...textStyleCss(item.textStyle),
              borderRadius: item.roundness,
              ...(solid
                ? hasBackground(item.background)
                  ? backgroundCss(item.background)
                  : {
                      background: "var(--primary)",
                      color: "var(--primary-foreground)",
                    }
                : {}),
              borderColor: outline
                ? backgroundAccentColor(item.background) || "currentColor"
                : undefined,
              // A solid button reads in the ink its plate calls for until
              // the merchant says otherwise; the label carries any fill of
              // its own.
              ...(solid && !hasBackground(item.textStyle.fill)
                ? surfaceInkCss(item.background)
                : {}),
            }}
          >
            <span style={fillTextCss(item.textStyle.fill)}>
              {button.label || "Button"}
            </span>
          </Link>
        ))}
      </div>
    );
  };

  const renderText = (item: HeaderTextItem) => (
    <span
      className="min-w-0 truncate"
      style={{
        ...paddingStyle(item.padding),
        ...backgroundCss(item.background),
        ...surfaceInkCss(item.background, item.textStyle.fill),
      }}
    >
      <span
        style={{
          ...textStyleCss(item.textStyle),
          ...fillTextCss(item.textStyle.fill),
        }}
      >
        {item.content}
      </span>
    </span>
  );

  /** One utility glyph: the control the key names, drawn at the item's size. */
  const renderIconKey = (key: HeaderIconKey, item: HeaderIconsItem) => {
    const size = { width: item.size, height: item.size };
    const shell = cn(
      "relative flex shrink-0 items-center transition-opacity hover:opacity-70",
      item.showLabels ? "flex-col gap-1" : "",
    );
    // With the glyphs off the label IS the control, so it steps up from a
    // caption under an icon to something worth clicking.
    const caption = (text: string) =>
      item.showLabels ? (
        <span
          className={cn(
            "font-medium leading-none",
            item.showIcons ? "text-[10px]" : "text-sm",
          )}
        >
          {text}
        </span>
      ) : null;
    const glyph = (node: ReactNode) => (item.showIcons ? node : null);
    /** A glyph whose badge must survive the glyph being switched off. */
    const counted = (node: ReactNode, text: string, count: number) =>
      item.showIcons ? (
        <>
          <IconCount size={item.size} count={count}>
            {node}
          </IconCount>
          {caption(text)}
        </>
      ) : (
        <IconCount size={item.size} count={count}>
          {caption(text)}
        </IconCount>
      );
    switch (key) {
      case "menu":
        return (
          <button
            key={key}
            type="button"
            onClick={() => setIsOpen(true)}
            aria-label={t.has("common.menu") ? t("common.menu") : "Menu"}
            className={shell}
          >
            {glyph(<Menu style={size} />)}
            {caption(t.has("common.menu") ? t("common.menu") : "Menu")}
          </button>
        );
      case "theme":
        return showThemeToggle ? (
          <button
            key={key}
            type="button"
            onClick={handleThemeToggle}
            aria-label={
              isDark ? t("common.switchToLightMode") : t("common.switchToDarkMode")
            }
            className={shell}
          >
            {glyph(isDark ? <Sun style={size} /> : <Moon style={size} />)}
            {caption(t.has("common.theme") ? t("common.theme") : "Theme")}
          </button>
        ) : null;
      case "wishlist":
        return showWishlist ? (
          <Link
            key={key}
            href={`/${locale}/account/wishlist`}
            aria-label={t("nav.wishlist")}
            className={shell}
          >
            {counted(
              <Heart style={size} />,
              t("nav.wishlist"),
              wishlistItems.length,
            )}
          </Link>
        ) : null;
      case "cart":
        return (
          <Fragment key={key}>
            {cartButton(item.size, caption(t("common.cart")), item.showIcons)}
          </Fragment>
        );
      case "compare":
        return (
          <Link
            key={key}
            href={`/${locale}/compare`}
            aria-label={t.has("nav.compare") ? t("nav.compare") : "Compare"}
            className={shell}
          >
            {glyph(<ArrowLeftRight style={size} />)}
            {caption(t.has("nav.compare") ? t("nav.compare") : "Compare")}
          </Link>
        );
      case "contact":
        return (
          <Link
            key={key}
            href={`/${locale}/contact`}
            aria-label={t.has("nav.contact") ? t("nav.contact") : "Contact"}
            className={shell}
          >
            {glyph(<Phone style={size} />)}
            {caption(t.has("nav.contact") ? t("nav.contact") : "Contact")}
          </Link>
        );
      case "language":
        return showLanguageSelector ? (
          <Fragment key={key}>
            {languagePopover(
              <button
                type="button"
                className={cn(shell, "gap-2 text-left leading-none")}
              >
                {/* The flag is this control's glyph; the code is its label,
                    and the one thing it cannot go without. */}
                {glyph(
                  <FlagIcon
                    countryCode={language.countryCode}
                    size={item.size}
                    aria-hidden="true"
                  />,
                )}
                <span className="text-[12px] font-medium">
                  {language.code.toUpperCase()}
                </span>
              </button>,
            )}
          </Fragment>
        ) : null;
      case "currency":
        return showCurrencySelector ? (
          <span
            key={key}
            className="shrink-0 text-[12px] font-medium leading-none tracking-normal"
          >
            {currency.code}
          </span>
        ) : null;
    }
  };

  const renderIcons = (item: HeaderIconsItem) => (
    <div
      className="flex shrink-0 items-center"
      style={{
        ...paddingStyle(item.padding),
        gap: item.gap,
        ...fillColorCss(item.foreground),
      }}
    >
      {/* The last resort for a design with no search at all: the control
          leads the utility cluster, in the cluster's own ink. */}
      {locationControlFor(item.id)}
      {item.keys.map((key) => renderIconKey(key, item))}
    </div>
  );

  /** The account control: greeting and name for a member, sign-in for a guest. */
  const renderUser = (item: HeaderUserItem) => {
    if (!showAccountMenu) return null;
    const size = { width: item.size, height: item.size };
    const shell = {
      ...paddingStyle(item.padding),
      ...fillColorCss(item.foreground),
    };
    if (isLoading || !mounted) {
      return (
        <div
          // Over the hero the placeholder is a wash of the bar's own ink,
          // not the page's muted grey — which read as a white block.
          className={cn(
            "h-9 w-24 animate-pulse rounded-md",
            overlapping ? "bg-current/15" : "bg-muted",
          )}
          style={shell}
        />
      );
    }
    const greeting = item.greeting || t("common.welcome");
    if (isAuthenticated && user) {
      return (
        <DropdownMenu
          open={isUserMenuOpen}
          onOpenChange={setIsUserMenuOpen}
          modal={false}
        >
          <div
            className="shrink-0"
            onMouseEnter={openUserMenu}
            onMouseLeave={closeUserMenu}
            style={shell}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 text-left"
                onClick={openUserMenu}
              >
                <Avatar className="h-8 w-8" style={size}>
                  <AvatarImage
                    src={user.image || undefined}
                    alt={user.name}
                    referrerPolicy="no-referrer"
                  />
                  <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                </Avatar>
                {item.showLabel ? (
                  <span className="flex flex-col gap-[3px] leading-none">
                    <span className="text-[11px] font-medium opacity-60">
                      {greeting}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[12px] font-medium leading-none tracking-normal">
                      <span className="max-w-27.5 truncate">{user.name}</span>
                      <ChevronDown className="h-3.5 w-3.5 opacity-55" />
                    </span>
                  </span>
                ) : null}
              </button>
            </DropdownMenuTrigger>
          </div>
          {userMenuContent}
        </DropdownMenu>
      );
    }
    return (
      <DropdownMenu
        open={isGuestMenuOpen}
        onOpenChange={setIsGuestMenuOpen}
        modal={false}
      >
        <div
          className="shrink-0"
          onMouseEnter={openGuestMenu}
          onMouseLeave={closeGuestMenu}
          style={shell}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 text-left leading-none"
              onClick={openGuestMenu}
            >
              <User style={size} />
              {item.showLabel ? (
                <span className="flex flex-col gap-[3px]">
                  <span className="text-[11px] font-medium opacity-60">
                    {greeting}
                  </span>
                  <span className="inline-flex items-center gap-0.5 whitespace-nowrap text-[12px] font-semibold leading-none tracking-normal">
                    {item.label ? (
                      <span className="leading-none">{item.label}</span>
                    ) : (
                      <>
                        <span className="leading-none">
                          {t("common.login")} /
                        </span>
                        <span className="leading-none opacity-80">
                          {t("common.register")}
                        </span>
                      </>
                    )}
                    <ChevronDown className="h-3.5 w-3.5 opacity-55" />
                  </span>
                </span>
              ) : null}
            </button>
          </DropdownMenuTrigger>
          {guestMenuContent}
        </div>
      </DropdownMenu>
    );
  };

  /** Opens the search drawer with the settings of the icon that asked. */
  const openSearchDrawerFor = (item: HeaderSearchIconItem) => {
    setSearchDrawer({
      trending: item.trending,
      collections: item.drawerCollections,
      fieldStyle: item.drawerFieldStyle,
      fieldRadius: item.drawerFieldRadius,
    });
    setSearchDrawerOpen(true);
  };

  /**
   * The search icon whose drawer the side drawer's Search hands over to —
   * the first one set to open a drawer. None, and the side drawer searches
   * from its own field instead.
   */
  const drawerSearchIcon = (() => {
    for (const row of tree.rows) {
      for (const column of row.columns) {
        for (const entry of column.items) {
          if (entry.type === "searchIcon" && entry.drawer) return entry;
        }
      }
    }
    return null;
  })();

  /**
   * The hamburger. By default it opens the same app drawer the phone's Menu
   * tab does; set to open the side drawer it opens that instead — unless the
   * linked menu is missing or empty, where an empty panel would be worse
   * than the app drawer it replaces.
   */
  const openMenuFor = (item: HeaderMenuButtonItem) => {
    const primary = item.drawer ? (linkedMenus?.[item.drawerMenu] ?? []) : [];
    if (primary.length === 0) {
      setIsOpen(true);
      return;
    }
    setSideDrawer({
      side: item.drawerSide,
      primary,
      secondary: linkedMenus?.[item.drawerSecondaryMenu] ?? [],
      label:
        item.label || (t.has("common.menu") ? t("common.menu") : "Menu"),
    });
    setSideDrawerOpen(true);
  };

  const renderMenuButton = (item: HeaderMenuButtonItem) => (
    <button
      type="button"
      onClick={() => openMenuFor(item)}
      aria-label={item.label || (t.has("common.menu") ? t("common.menu") : "Menu")}
      className="flex shrink-0 items-center gap-2 transition-opacity hover:opacity-80"
      style={{
        ...paddingStyle(item.padding),
        borderRadius: item.roundness,
        ...(hasBackground(item.background) ? { padding: 8 } : {}),
        ...backgroundCss(item.background),
        ...surfaceInkCss(item.background, item.foreground),
      }}
    >
      <Menu style={{ width: item.size, height: item.size }} />
      {item.showLabel ? (
        <span className="text-sm font-semibold">{item.label}</span>
      ) : null}
    </button>
  );

  /**
   * A placed "Deliver to" block. Inert while the store's shopper-location
   * switch is off — the sidebars and checkout hang off that switch too, and
   * a header control with nothing behind it would be a promise the listings
   * do not keep. The studio flips the switch on when the item is added.
   */
  const renderLocation = (item: HeaderLocationItem) =>
    showLocationPicker ? (
      <div
        className="flex shrink-0 items-center"
        style={{ ...paddingStyle(item.padding), ...fillColorCss(item.foreground) }}
      >
        <LocationPickerLazy
          appearance="header"
          caption={item.showCaption ? item.caption : null}
          iconSize={item.size}
        />
      </div>
    ) : null;

  /**
   * The language switcher as an item of its own. Placing one is the ask, so
   * it renders whatever the utility cluster's language toggle says — the
   * same picker the cluster's glyph opens.
   */
  const renderLanguage = (item: HeaderLanguageItem) =>
    languagePopover(
      <button
        type="button"
        aria-label={t("common.language")}
        className="flex shrink-0 items-center gap-2 leading-none transition-opacity hover:opacity-70"
        style={{ ...paddingStyle(item.padding), ...fillColorCss(item.foreground) }}
      >
        {item.showFlag ? (
          <FlagIcon
            countryCode={language.countryCode}
            size={item.size}
            aria-hidden="true"
          />
        ) : null}
        <span
          style={{
            ...textStyleCss(item.textStyle),
            ...fillTextCss(item.textStyle.fill),
          }}
        >
          {item.display === "name" ? language.name : language.code.toUpperCase()}
        </span>
        {item.showChevron ? (
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
        ) : null}
      </button>,
    );

  /** The store currency, read-only: shoppers cannot switch it (no conversion). */
  const renderCurrency = (item: HeaderCurrencyItem) => (
    <span
      className="shrink-0 leading-none"
      title={currency.name}
      style={{
        ...paddingStyle(item.padding),
        ...textStyleCss(item.textStyle),
        ...fillTextCss(item.textStyle.fill),
      }}
    >
      {headerCurrencyLabel(item.display, currency)}
    </span>
  );

  const renderItem = (item: HeaderLayoutItem, rowTone: SurfaceTone | null) => {
    switch (item.type) {
      case "brand":
        return renderBrand(item, rowTone);
      case "nav":
        return renderNav(item);
      case "categories":
        return renderCategories(item);
      case "collections":
        return renderCollections(item);
      case "searchBar":
        return renderSearchBar(item);
      case "searchIcon":
        return renderSearchIcon(item);
      case "buttons":
        return renderButtons(item);
      case "text":
        return renderText(item);
      case "icons":
        return renderIcons(item);
      case "user":
        return renderUser(item);
      case "menuButton":
        return renderMenuButton(item);
      case "location":
        return renderLocation(item);
      case "language":
        return renderLanguage(item);
      case "currency":
        return renderCurrency(item);
    }
  };

  return (
    <>
      <div
        ref={stickyWrapperRef}
        data-sticky-header
        // Read by StoreChromeHeight: a floating bar takes no room, so a
        // full-height hero under it must measure the viewport, not the
        // viewport minus a header that is not there.
        data-header-overlap={overlapLayout ? "" : undefined}
        className={cn(
          floatingUnmeasured
            ? cn(
                "lg:absolute lg:inset-x-0",
                headerSticky ? "max-lg:sticky max-lg:top-0" : "max-lg:relative",
              )
            : headerSticky
              ? "sticky"
              : "relative",
          // Pulled out of the flow by its own resting height, from lg only.
          overlapLayout && !floatingUnmeasured && "lg:-mb-(--header-rest-h)",
          "z-50 w-full",
          // A row that returns on scroll-up slides back in rather than
          // snapping; a top-returning row rides with the page and needs none.
          hasScrollUpLeading && "transition-[top] duration-300 ease-out",
        )}
        style={{
          // No `top` while absolute: that would leave the static position
          // for the containing block's edge, over whatever sits above.
          ...(headerSticky && !floatingUnmeasured ? { top: -hiddenOffset } : {}),
          ...(overlapLayout && !floatingUnmeasured
            ? { "--header-rest-h": `${restHeight}px` }
            : {}),
        } as CSSProperties}
      >
        <header
          className={cn(
            "relative w-full [&_button]:cursor-pointer",
            // The fade back to the configured bar as the hero passes.
            overlapLayout && "transition-colors duration-300",
            overlapping && "max-lg:[box-shadow:var(--header-bar-shadow,none)]",
            // Floating is desktop-only: below lg the bar keeps its own paint.
            overlapping
              ? headerTransparent
                ? "max-lg:border-b max-lg:border-border/40 max-lg:bg-background/70 max-lg:backdrop-blur-md max-lg:supports-[backdrop-filter]:bg-background/60 lg:bg-transparent"
                : rowsPaintThemselves
                  ? "bg-transparent"
                  : "bg-background lg:bg-transparent"
              : headerTransparent
                ? "border-b border-border/40 bg-background/70 backdrop-blur-md supports-[backdrop-filter]:bg-background/60"
                : rowsPaintThemselves
                  ? "bg-transparent"
                  : "bg-background",
          )}
          style={{
            ...headerThemeStyle,
            // Only the solid bar casts it: glass shows the page through, and
            // self-painting rows carry their own. A floating bar casts none —
            // on desktop, the only size that floats.
            ...(!headerTransparent && !rowsPaintThemselves && barShadow
              ? overlapping
                ? { "--header-bar-shadow": barShadow }
                : { boxShadow: barShadow }
              : {}),
          } as CSSProperties}
        >
          {/* A soft fade from the top edge, in the hero tone's own shadow —
              black over a dark hero, white over a light one — reaching past
              the bar's foot so the ink reads over a busy picture. Behind the
              rows, in front of the hero; gone as the bar returns to its
              colours. */}
          {overlapLayout && overlapScrim > 0 ? (
            <div
              aria-hidden
              className="pointer-events-none max-lg:hidden absolute inset-x-0 top-0 -z-10 h-[160%] transition-opacity duration-300"
              style={{
                opacity: overlapping ? 1 : 0,
                background: `linear-gradient(to bottom, ${
                  overlapTone === "dark" ? "rgba(0,0,0," : "rgba(255,255,255,"
                }${overlapScrim / 100}), transparent)`,
              }}
            />
          ) : null}
          {/* From lg up: the layout tree, row by row. A row's paint spans
              the full width — a coloured nav strip runs edge to edge — while
              its columns sit inside the container. */}
          <div
            className="hidden lg:block"
            style={
              overlapping
                ? ({
                    // Ink only: the popover variables stay as configured, or
                    // every dropdown opened from the floating bar would come
                    // up transparent too.
                    "--background": "transparent",
                    "--foreground": overlapInk,
                    "--muted-foreground": overlapInk,
                    // `color` itself, not only the token: globals.css applies
                    // text-foreground at BODY, so an item that does not use
                    // the utility inherits the page's ink and would stay dark
                    // on a dark hero however the variable is set here.
                    color: overlapInk,
                  } as CSSProperties)
                : undefined
            }
          >
            {paintedTree.rows.map((row, index) => {
              const columns = visibleColumns(row);
              // Leading hiding rows are slid off by the wrapper's `top`;
              // only a hiding row below a fixed one has to fold.
              const folds = row.hideOnScroll && index >= leadingHidingRows;
              const folded =
                folds && (rowReturnsOnScrollUp(row, index) ? scrolled : pastTop);
              // While floating, the surface behind every row is the hero,
              // not the row's own paint — so the logo picks its artwork from
              // the tone the merchant named for it.
              const rowTone = overlapping
                ? overlapTone
                : surfaceTone(row.background);
              return (
                // A folding row folds through a 1fr → 0fr grid track, which
                // animates its height without knowing what that height is.
                <div
                  key={row.id}
                  data-header-row
                  className={cn(
                    // The row holding an open search dropdown sits above the
                    // rows after it; otherwise a row that forms its own
                    // stacking context (blur, a fold) keeps the panel under
                    // the next row's links.
                    "has-data-search-suggestions:relative has-data-search-suggestions:z-60",
                    folds &&
                      "grid transition-[grid-template-rows,opacity] duration-[220ms] ease-out motion-reduce:transition-none",
                    folded && "opacity-0",
                  )}
                  style={
                    folds
                      ? {
                          gridTemplateRows: folded ? "0fr" : "1fr",
                          // The row is about to animate its own height; say
                          // so, so the first frame is not the expensive one.
                          willChange: "grid-template-rows, opacity",
                          // The copy fades out ahead of the collapse and in
                          // behind it, so text never squashes as it goes.
                          transitionDelay: folded ? "0ms, 0ms" : "60ms, 60ms",
                        }
                      : undefined
                  }
                  aria-hidden={folded || undefined}
                >
                <div
                  className={cn(folds && "min-h-0 overflow-hidden")}
                  style={{
                    // A floating row paints nothing: its own background, its
                    // ink and its rule would all draw a bar across the hero.
                    ...(overlapping
                      ? {}
                      : {
                          ...backgroundCss(row.background),
                          ...rowSurfaceCss(row),
                          ...rowBlurCss(row),
                          borderBottom: row.borderBottom
                            ? `${row.borderBottom}px solid ${row.borderColor || "currentColor"}`
                            : undefined,
                        }),
                  }}
                >
                  <div className={headerContainerClass}>
                    <div
                      className={cn(
                        brandScaleOf(row) < 1 &&
                          "transition-[min-height] duration-200 ease-out",
                      )}
                      style={{
                        ...rowGridStyle(row),
                        // The row compacts with its logo: the same ratio
                        // on its minimum height, animated alongside.
                        ...(scrolled && row.height && brandScaleOf(row) < 1
                          ? { minHeight: Math.round(row.height * brandScaleOf(row)) }
                          : {}),
                      }}
                    >
                      {columns.map((column) => (
                        <div key={column.id} style={columnStyle(column, row)}>
                          {column.items.map((item) => (
                            <Fragment key={item.id}>
                              {renderItem(item, rowTone)}
                            </Fragment>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                </div>
              );
            })}
          </div>

          {/* Below lg: the compact bar. The cart is the storefront's only
              cart entry point here, so it renders regardless of the desktop
              icons; the menu drawer opens from the bottom nav's Menu tab. */}
          <div className={cn(headerContainerClass, "lg:hidden")}>
            <div className="flex items-center justify-between gap-4 py-3">
              <Link
                href={`/${locale}`}
                className="flex min-w-0 shrink-0 items-center gap-2"
              >
                {currentLogoUrl ? (
                  <span
                    className="relative block h-8 overflow-hidden"
                    style={{ width: mobileLogoWidth }}
                  >
                    <AppImage
                      src={currentLogoUrl}
                      alt={headerLogoAlt || storeName || "Logo"}
                      className="h-8 w-full object-contain object-left"
                      width={144}
                      height={32}
                      priority
                    />
                  </span>
                ) : (
                  <>
                    <Store className="h-6 w-6 text-primary" />
                    <span className="truncate text-xl font-bold">
                      {brandName}
                    </span>
                  </>
                )}
              </Link>
              <div className="flex shrink-0 items-center gap-4 text-foreground/90">
                {cartButton(20)}
              </div>
            </div>

            {/* The phone's search row: submits through the same handler,
                so results and the AI trigger behave identically. */}
            {showSearch && showMobileSearch && (
              <HeaderMobileSearch
                placeholder={searchPlaceholder}
                inputStyle={mobileSearchInputStyle}
                iconStyle={
                  activeHeaderColors
                    ? { color: "var(--header-search-text)" }
                    : undefined
                }
                showAiSearch={showAiSearch}
              />
            )}

            {/* The phone's "Deliver to" strip, under the search the way the
                marketplace apps draw it. Its own row rather than a slot in
                the compact bar: the bar has room for a logo and a cart, and
                a city name truncated to three letters tells nobody where
                they are. */}
            {showLocationPicker ? (
              <div className="-mt-1 pb-2">
                <LocationPickerLazy
                  appearance="header"
                  className="w-full rounded-lg bg-foreground/[0.04] px-3 py-1.5"
                />
              </div>
            ) : null}
          </div>

          {cartDrawerMounted ? (
            <CartDrawer open={isCartOpen} onOpenChange={setIsCartOpen} />
          ) : null}

          {mobileMenuMounted ? (
            <MobileMenuSheet
              locale={locale}
              isOpen={isOpen}
              setIsOpen={setIsOpen}
              closeMobileMenu={closeMobileMenu}
              categories={categories}
              collections={collections}
              brandName={brandName}
              brandLogoUrl={currentLogoUrl}
              showMobileMarketSelectors={showMobileMarketSelectors}
              showMobileThemeSelector={showMobileThemeSelector}
              showMobileCollections={showMobileCollections}
              showMobileAccountSummary={showMobileAccountSummary}
              showMobileCategoryShortcuts={showMobileCategoryShortcuts}
              showLanguageSelector={showLanguageSelector}
              showCurrencySelector={showCurrencySelector}
              showCollectionsMenu={showCollectionsMenu}
              showUtilityMenu={showUtilityMenu}
              showAccountMenu={showAccountMenu}
              categoryMenuLabel={categoryMenuLabel}
              collectionsMenuLabel={collectionsMenuLabel}
              categoriesPageHref={categoriesPageHref}
              getDashboardLink={getDashboardLink}
              getSettingsLink={getSettingsLink}
              handleLogout={handleLogout}
              handleMobileLanguageChange={handleMobileLanguageChange}
              handleThemeChange={handleThemeChange}
              menuItems={menuItems}
              megaMenuRootItems={megaMenuRootItems}
              hasCustomMegaMenu={hasCustomMegaMenu}
              categoryMobileLimit={categoryMobileLimit}
              collectionsLimit={collectionsLimit}
              megaMenuRootLimit={MAX_MEGA_MENU_ROOT_ITEMS}
            />
          ) : null}

          {sideDrawer ? (
            <SideDrawer
              open={sideDrawerOpen}
              onOpenChange={setSideDrawerOpen}
              side={sideDrawer.side}
              primary={sideDrawer.primary}
              secondary={sideDrawer.secondary}
              label={sideDrawer.label}
              onSearch={
                showSearch && drawerSearchIcon
                  ? () => openSearchDrawerFor(drawerSearchIcon)
                  : undefined
              }
              onSearchSubmit={showSearch ? searchFor : undefined}
              languages={languages.map(({ code, name }) => ({ code, name }))}
              currentLanguage={locale || language.code}
              onLanguageChange={(code) => {
                const current = locale || language.code;
                if (code !== current) {
                  router.push(swapLocaleInPathname(pathname, current, code));
                }
              }}
            />
          ) : null}

          {searchDrawer ? (
            <HeaderSearchDrawer
              open={searchDrawerOpen}
              onOpenChange={setSearchDrawerOpen}
              placeholder={searchPlaceholder}
              trending={searchDrawer.trending}
              collectionIds={searchDrawer.collections}
              fieldStyle={searchDrawer.fieldStyle}
              fieldRadius={searchDrawer.fieldRadius}
              brand={{ logoUrl: currentLogoUrl, name: brandName }}
            />
          ) : null}
        </header>
      </div>
    </>
  );
}

/**
 * The cart's count over its glyph — the only part of the header that reads
 * the cart, so an add to cart re-renders the badge and not the bar.
 */
function CartCount({ size, children }: { size: number; children: ReactNode }) {
  const { totalItems } = useCart();
  return (
    <IconCount size={size} count={totalItems}>
      {children}
    </IconCount>
  );
}

/**
 * A count over an icon. The badge wraps the GLYPH, not the button: a button
 * with a caption under it is wider and taller than its icon, so a badge
 * pinned to the button's corner drifts away from the thing it counts. It is
 * also sized from the icon and hung off its corner — a fixed 20px disc over
 * a 20px cart buries the cart under its own counter.
 */
function IconCount({
  size,
  count,
  children,
}: {
  size: number;
  count: number;
  children: ReactNode;
}) {
  if (count <= 0) return <>{children}</>;
  const badge = Math.max(14, Math.min(18, Math.round(size * 0.6)));
  return (
    <span className="relative inline-flex shrink-0">
      {children}
      <span
        className="absolute grid place-items-center rounded-full bg-primary font-semibold leading-none text-primary-foreground ring-2 ring-background"
        style={{
          height: badge,
          minWidth: badge,
          fontSize: Math.max(9, Math.round(badge * 0.58)),
          paddingInline: 3,
          // Hung off the corner rather than sat on it, and mirrored in RTL.
          top: -Math.round(badge * 0.42),
          insetInlineEnd: -Math.round(badge * 0.5),
        }}
      >
        {count > 99 ? "99+" : count}
      </span>
    </span>
  );
}
