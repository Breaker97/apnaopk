"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BadgePercent,
  CalendarClock,
  ChevronDown,
  CircleHelp,
  DollarSign,
  Globe2,
  Home,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  LogIn,
  LogOut,
  MessageCircle,
  Moon,
  MoreHorizontal,
  Package,
  PackageSearch,
  Rss,
  Settings,
  ShoppingBag,
  Store,
  Sun,
  Tags,
  User,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MegaMenuItemVisual,
  getHeaderMenuItemKey,
} from "@/components/layout/store-header/mega-menu";
import type { HeaderMenuItem } from "@/lib/site-config/header-config";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { AppImage } from "@/components/ui/app-image";
import { buildLoginUrl } from "@/lib/auth/return-path";
import { useAuth } from "@/hooks/use-auth";
import type { ThemeMode } from "@/config/branding.config";
import { useAppTheme } from "@/providers/theme-provider";
import { useCurrency } from "@/providers/currency-provider";
import { useLanguage } from "@/providers/language-provider";
import type {
  CategoryNode,
  CollectionItem,
} from "@/components/layout/store-header/types";

// Hard ceiling on the drawer's category dropdown. The admin-facing
// `categoryMenu.mobileLimit` can be set higher, but a drawer dropdown that
// unfolds into a dozen rows defeats the point of collapsing it — anything past
// this belongs on the categories page behind "View all".
const MOBILE_CATEGORY_LIMIT = 7;

interface MobileMenuSheetProps {
  locale: string;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  closeMobileMenu: () => void;
  categories: CategoryNode[];
  collections: CollectionItem[];
  brandName: string;
  brandLogoUrl: string;
  showMobileMarketSelectors: boolean;
  showMobileThemeSelector: boolean;
  showMobileCollections: boolean;
  showMobileAccountSummary: boolean;
  showMobileCategoryShortcuts: boolean;
  showLanguageSelector: boolean;
  showCurrencySelector: boolean;
  showCollectionsMenu: boolean;
  showUtilityMenu: boolean;
  showAccountMenu: boolean;
  categoryMenuLabel: string;
  collectionsMenuLabel: string;
  categoriesPageHref: string;
  getDashboardLink: () => string | null;
  getSettingsLink: () => string;
  handleLogout: () => void | Promise<void>;
  handleMobileLanguageChange: (value: string) => void;
  handleThemeChange: (value: ThemeMode) => void;
  menuItems: HeaderMenuItem[] | undefined;
  megaMenuRootItems: HeaderMenuItem[];
  hasCustomMegaMenu: boolean;
  categoryMobileLimit: number;
  collectionsLimit: number;
  megaMenuRootLimit: number;
}

export function MobileMenuSheet({
  locale,
  isOpen,
  setIsOpen,
  closeMobileMenu,
  categories,
  collections,
  brandName,
  brandLogoUrl,
  showMobileMarketSelectors,
  showMobileThemeSelector,
  showMobileCollections,
  showMobileAccountSummary,
  showMobileCategoryShortcuts,
  showLanguageSelector,
  showCurrencySelector,
  showCollectionsMenu,
  showUtilityMenu,
  showAccountMenu,
  categoryMenuLabel,
  collectionsMenuLabel,
  categoriesPageHref,
  getDashboardLink,
  getSettingsLink,
  handleLogout,
  handleMobileLanguageChange,
  handleThemeChange,
  menuItems,
  megaMenuRootItems,
  hasCustomMegaMenu,
  categoryMobileLimit,
  collectionsLimit,
  megaMenuRootLimit,
}: MobileMenuSheetProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { theme } = useAppTheme();
  const { currency } = useCurrency();
  const { language, languages } = useLanguage();
  // Admin menu hrefs arrive locale-prefixed; strip that (plus query/trailing
  // slash) so they can be compared against route slugs.
  const normalizeMenuPath = (href: string) => {
    let path = href.split(/[?#]/)[0].toLowerCase();
    const prefix = `/${locale.toLowerCase()}`;
    if (path === prefix) return "/";
    if (path.startsWith(`${prefix}/`)) path = path.slice(prefix.length);
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return path;
  };

  // Home / products / collections are hardcoded rows below, so admin menu
  // entries pointing at those same pages are dropped rather than rendered
  // twice — the default header menu ships with its own "Products" link, which
  // used to appear as a duplicate at the bottom of the list.
  const builtinPaths = new Set(["/", "/products", "/collections"]);
  const adminMenuItems = (menuItems ?? []).filter(
    (item) => !builtinPaths.has(normalizeMenuPath(item.href)),
  );

  // Catalog destinations sit with the primary shop links; help and company
  // pages get their own quieter group, so the drawer reads as two short
  // blocks instead of one undifferentiated list.
  const isShopPath = (path: string) =>
    [
      "/brands",
      "/categories",
      "/pre-order",
      "/deals",
      "/new-arrivals",
      "/best-sellers",
    ].some((slug) => path === slug || path.startsWith(`${slug}/`));
  const shopMenuItems = adminMenuItems.filter((item) =>
    isShopPath(normalizeMenuPath(item.href)),
  );
  const moreMenuItems = adminMenuItems.filter(
    (item) => !isShopPath(normalizeMenuPath(item.href)),
  );

  // One glyph per known destination — a wall of identical package icons said
  // nothing about where a row leads.
  const menuItemIcon = (item: HeaderMenuItem): LucideIcon => {
    const path = normalizeMenuPath(item.href);
    const label = item.label.toLowerCase();
    if (path.startsWith("/blog") || label.includes("blog")) return Rss;
    if (path.startsWith("/track-order") || label.includes("track"))
      return PackageSearch;
    if (path.startsWith("/contact")) return MessageCircle;
    if (path.startsWith("/brands")) return Tags;
    if (path.startsWith("/pre-order")) return CalendarClock;
    if (path.includes("vendor") || label.includes("vendor")) return Store;
    if (path.startsWith("/faq") || path.startsWith("/help")) return CircleHelp;
    if (path.startsWith("/deals")) return BadgePercent;
    if (path.startsWith("/categories")) return LayoutGrid;
    return Package;
  };

  const isActivePath = (href: string) =>
    pathname === href ||
    (href !== `/${locale}` && pathname.startsWith(`${href}/`));

  const moreLabel = t.has("common.more") ? t("common.more") : "More";
  const themeLabel = t.has("common.theme") ? t("common.theme") : "Theme";

  // The dropdown renders one flat list of top-level entries — no child
  // categories. Source is the custom mega menu when the store has one, the
  // real category tree otherwise, but both are gated on `categories.length`:
  // the mega mirror can be fed by the seeded default menu, which used to keep
  // a hardcoded grid of dead links in the drawer after every real category was
  // removed.
  const categoryEntries: {
    key: string;
    href: string;
    label: string;
    target?: string;
    // `null` when the entry has no artwork of its own — the row draws a blank
    // spacer instead of inventing a glyph, so the labels stay on one edge.
    visual: ReactNode | null;
  }[] =
    hasCustomMegaMenu && megaMenuRootItems.length > 0
      ? megaMenuRootItems.map((item, idx) => ({
          key: getHeaderMenuItemKey(item) ?? `mega-${idx}`,
          href: item.href,
          label: item.label,
          target: item.target,
          visual: <MegaMenuItemVisual item={item} className="h-4 w-4" />,
        }))
      : categories.map((cat) => ({
          key: cat._id,
          href: `/${locale}/products?category=${encodeURIComponent(cat.slug)}`,
          label: cat.name,
          // A category's own `image` is its catalog artwork, not a mega-menu
          // promo, so it is still fair game as the row visual here.
          visual:
            cat.icon || cat.image ? (
              <AppImage
                src={(cat.icon || cat.image) as string}
                alt={cat.name}
                className="h-5 w-5 object-contain"
                width={20}
                height={20}
              />
            ) : null,
        }));
  const visibleCategoryEntries = categoryEntries.slice(
    0,
    Math.min(categoryMobileLimit, megaMenuRootLimit, MOBILE_CATEGORY_LIMIT),
  );
  const showCategorySection =
    showMobileCategoryShortcuts &&
    categories.length > 0 &&
    visibleCategoryEntries.length > 0;

  return (
    // Trigger-less by design: the drawer is opened from the bottom nav's Menu
    // tab (via `useMobileMenu`), which sits in the thumb zone instead of the
    // top-right corner the hamburger used to occupy. The header slot it left
    // behind now holds the cart.
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-[min(92vw,380px)] gap-0 overflow-y-auto p-0"
      >
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <div className="flex min-h-full flex-col pb-[env(safe-area-inset-bottom)]">
          {/* Sticky brand bar. The sheet's default close button floated over
              whatever content happened to be under it at 70% opacity and
              scrolled away on a long drawer; this gives it a real 36px target
              that stays reachable, and puts the theme switch — a preference,
              not a destination — in the chrome instead of a "Settings" section
              that collided with the account area's dashboard settings link. */}
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <Link
              href={`/${locale}`}
              onClick={closeMobileMenu}
              className="flex min-w-0 flex-1 items-center gap-2"
            >
              {brandLogoUrl ? (
                <AppImage
                  src={brandLogoUrl}
                  alt={brandName}
                  className="h-7 w-auto max-w-[150px] object-contain object-left"
                  width={150}
                  height={28}
                />
              ) : (
                <>
                  <Store className="h-5 w-5 shrink-0 text-primary" />
                  <span className="truncate text-base font-bold">
                    {brandName}
                  </span>
                </>
              )}
            </Link>

            {showMobileThemeSelector && (
              /* Light and dark only — no "System" option, the storefront never
                 follows the visitor's OS preference. Icon-only up here: the
                 labels cost width the brand row needs. */
              <div
                role="group"
                aria-label={themeLabel}
                className="inline-flex shrink-0 rounded-full border p-0.5"
              >
                {[
                  { mode: "light" as const, label: "Light", icon: Sun },
                  { mode: "dark" as const, label: "Dark", icon: Moon },
                ].map((item) => {
                  const Icon = item.icon;
                  const isSelected = theme === item.mode;
                  return (
                    <button
                      key={item.mode}
                      type="button"
                      aria-label={item.label}
                      aria-pressed={isSelected}
                      onClick={() => handleThemeChange(item.mode)}
                      className={cn(
                        "grid h-7 w-8 place-items-center rounded-full transition-colors",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  );
                })}
              </div>
            )}

            <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full border bg-muted/60 text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95">
              <X className="h-[18px] w-[18px]" />
              <span className="sr-only">{t("common.close")}</span>
            </SheetClose>
          </div>

          {/* No account card, search bar or cart/wishlist shortcuts here —
              search lives in the header bar, and cart, wishlist and account all
              have their own bottom-nav tabs, so repeating them in the drawer
              was dead weight. */}
          <nav className="grid gap-1 px-3 py-4 text-sm font-medium">
            <MobileNavRow
              href={`/${locale}`}
              icon={Home}
              label={t("nav.home")}
              active={pathname === `/${locale}`}
              onNavigate={closeMobileMenu}
            />
            <MobileNavRow
              href={`/${locale}/products`}
              icon={ShoppingBag}
              label={t("nav.products")}
              active={isActivePath(`/${locale}/products`)}
              onNavigate={closeMobileMenu}
            />
            {showCollectionsMenu && (
              <MobileNavRow
                href={`/${locale}/collections`}
                icon={Layers}
                label={collectionsMenuLabel}
                active={isActivePath(`/${locale}/collections`)}
                onNavigate={closeMobileMenu}
              />
            )}
            {showUtilityMenu &&
              shopMenuItems.map((item, idx) => (
                <MobileNavRow
                  key={`ms-${item.href}-${idx}`}
                  href={item.href}
                  icon={menuItemIcon(item)}
                  label={item.label}
                  active={item.target !== "_blank" && isActivePath(item.href)}
                  onNavigate={closeMobileMenu}
                  target={item.target}
                />
              ))}

            {showUtilityMenu &&
              (moreMenuItems.length > 0 ||
                !menuItems ||
                menuItems.length === 0) && (
                <MobileNavDisclosure
                  icon={MoreHorizontal}
                  label={moreLabel}
                  className="pt-2"
                >
                  {menuItems && menuItems.length > 0 ? (
                    moreMenuItems.map((item, idx) => (
                      <MobileNavRow
                        key={`mm-${item.href}-${idx}`}
                        href={item.href}
                        icon={menuItemIcon(item)}
                        label={item.label}
                        active={
                          item.target !== "_blank" && isActivePath(item.href)
                        }
                        onNavigate={closeMobileMenu}
                        target={item.target}
                      />
                    ))
                  ) : (
                    <>
                      <MobileNavRow
                        href={`/${locale}/blog`}
                        icon={Rss}
                        label={t("nav.blog")}
                        active={isActivePath(`/${locale}/blog`)}
                        onNavigate={closeMobileMenu}
                      />
                      <MobileNavRow
                        href={`/${locale}/track-order`}
                        icon={PackageSearch}
                        label="Track Order"
                        active={isActivePath(`/${locale}/track-order`)}
                        onNavigate={closeMobileMenu}
                      />
                    </>
                  )}
                </MobileNavDisclosure>
              )}
          </nav>

          {/* Categories as a collapsed dropdown rather than an always-open
              tile grid: the grid spent ~180px of scroll on rows most shoppers
              scrolled straight past, and its truncated list gave no way to
              reach the rest. "View all" sits beside the toggle so the full
              catalog is one tap away whether or not the list is expanded. */}
          {showCategorySection && (
            <>
              <Separator />
              <section className="px-3 py-4">
                <MobileNavDisclosure
                  icon={LayoutGrid}
                  label={categoryMenuLabel}
                  action={
                    <Link
                      href={categoriesPageHref}
                      onClick={closeMobileMenu}
                      className="shrink-0 text-xs font-medium text-primary"
                    >
                      {t("common.viewAll")}
                    </Link>
                  }
                >
                  {visibleCategoryEntries.map((entry) => (
                    <Link
                      key={entry.key}
                      href={entry.href}
                      target={entry.target}
                      rel={
                        entry.target === "_blank"
                          ? "noopener noreferrer"
                          : undefined
                      }
                      onClick={closeMobileMenu}
                      className="flex h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors hover:bg-muted active:bg-muted"
                    >
                      {/* Same footprint either way: an entry with no artwork
                          holds the slot open rather than sliding its label left
                          past the rows that do have one. The tile only gets its
                          background when there is something to sit on it. */}
                      <span
                        aria-hidden={!entry.visual || undefined}
                        className={cn(
                          "grid h-7 w-7 shrink-0 place-items-center rounded-lg",
                          entry.visual && "bg-muted/60",
                        )}
                      >
                        {entry.visual}
                      </span>
                      <span className="truncate">{entry.label}</span>
                    </Link>
                  ))}
                </MobileNavDisclosure>
              </section>
            </>
          )}

          {showMobileCollections && collections.length > 0 && (
            <>
              <Separator />
              <section className="px-5 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">
                    {collectionsMenuLabel}
                  </h3>
                  <Link
                    href={`/${locale}/collections`}
                    onClick={closeMobileMenu}
                    className="text-xs font-medium text-primary"
                  >
                    {t("common.viewAll")}
                  </Link>
                </div>
                {/* Horizontal rail instead of a stacked card list — a dozen
                    collections cost ~700px of drawer scroll, and the subtitle
                    line was seed text ("Lorem Ipsum") more often than copy
                    worth reading. Artwork + title is enough to pick one. */}
                <div className="flex snap-x gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {collections.slice(0, collectionsLimit).map((col) => (
                    <Link
                      key={col._id}
                      href={`/${locale}/collections/${col.slug}`}
                      onClick={closeMobileMenu}
                      className="w-24 shrink-0 snap-start transition-transform active:scale-95"
                    >
                      <div className="relative aspect-square w-full overflow-hidden rounded-2xl border bg-muted/50">
                        {col.image?.url ? (
                          <AppImage
                            src={col.image.url}
                            alt={col.image.alt || col.title}
                            width={96}
                            height={96}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="grid h-full w-full place-items-center text-muted-foreground">
                            <Layers className="h-5 w-5" />
                          </div>
                        )}
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-[11px] font-semibold leading-tight">
                        {col.title}
                      </p>
                    </Link>
                  ))}
                </div>
              </section>
            </>
          )}

          {showAccountMenu && (
            <>
              <Separator />

              <section className="px-3 py-4">
                <MobileNavLabel>{t("common.account")}</MobileNavLabel>
                <div className="grid gap-1 text-sm font-medium">
                  {isLoading ? (
                    /* Placeholder rows while the session resolves — the group
                       swaps between staff links and shopper links, and
                       committing to either would reshuffle under the thumb. */
                    <>
                      <div className="h-11 animate-pulse rounded-xl bg-muted/60" />
                      <div className="h-11 animate-pulse rounded-xl bg-muted/60" />
                      <div className="h-11 animate-pulse rounded-xl bg-muted/60" />
                    </>
                  ) : isAuthenticated && user ? (
                    <>
                      {getDashboardLink() ? (
                        <>
                          <Link
                            href={getDashboardLink()!}
                            onClick={closeMobileMenu}
                            className="flex h-11 items-center gap-3 rounded-xl px-3 transition-colors hover:bg-muted active:bg-muted"
                          >
                            <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
                            {t("common.dashboard")}
                          </Link>
                          <Link
                            href={getSettingsLink()}
                            onClick={closeMobileMenu}
                            className="flex h-11 items-center gap-3 rounded-xl px-3 transition-colors hover:bg-muted active:bg-muted"
                          >
                            <Settings className="h-4 w-4 text-muted-foreground" />
                            {t("admin.settings.title")}
                          </Link>
                        </>
                      ) : (
                        <>
                          <Link
                            href={`/${locale}/account`}
                            onClick={closeMobileMenu}
                            className="flex h-11 items-center gap-3 rounded-xl px-3 transition-colors hover:bg-muted active:bg-muted"
                          >
                            <User className="h-4 w-4 text-muted-foreground" />
                            {t("common.account")}
                          </Link>
                          <Link
                            href={`/${locale}/account/orders`}
                            onClick={closeMobileMenu}
                            className="flex h-11 items-center gap-3 rounded-xl px-3 transition-colors hover:bg-muted active:bg-muted"
                          >
                            <Package className="h-4 w-4 text-muted-foreground" />
                            {t("orders.myOrders")}
                          </Link>
                          <Link
                            href={`/${locale}/account/profile`}
                            onClick={closeMobileMenu}
                            className="flex h-11 items-center gap-3 rounded-xl px-3 transition-colors hover:bg-muted active:bg-muted"
                          >
                            <User className="h-4 w-4 text-muted-foreground" />
                            {t("common.profile")}
                          </Link>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          closeMobileMenu();
                          void handleLogout();
                        }}
                        className="flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 active:bg-destructive/10"
                      >
                        <LogOut className="h-4 w-4" />
                        {t("common.logout")}
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Guests keep a sign-in entry here now that the drawer
                          no longer opens with an account card — one row, not
                          the pair of full-width buttons that used to sit above
                          the navigation. */}
                      {showMobileAccountSummary && (
                        <>
                          <Link
                            href={buildLoginUrl(locale, pathname)}
                            onClick={closeMobileMenu}
                            className="flex h-11 items-center gap-3 rounded-xl px-3 font-semibold text-primary transition-colors hover:bg-primary/10 active:bg-primary/10"
                          >
                            <LogIn className="h-4 w-4" />
                            {t("common.signIn")}
                          </Link>
                          <Link
                            href={`/${locale}/register`}
                            onClick={closeMobileMenu}
                            className="flex h-11 items-center gap-3 rounded-xl px-3 transition-colors hover:bg-muted active:bg-muted"
                          >
                            <UserPlus className="h-4 w-4 text-muted-foreground" />
                            {t("common.register")}
                          </Link>
                        </>
                      )}
                      <Link
                        href={buildLoginUrl(locale, `/${locale}/account/orders`)}
                        onClick={closeMobileMenu}
                        className="flex h-11 items-center gap-3 rounded-xl px-3 transition-colors hover:bg-muted active:bg-muted"
                      >
                        <Package className="h-4 w-4 text-muted-foreground" />
                        {t("common.myOrders")}
                      </Link>
                      <Link
                        href={buildLoginUrl(
                          locale,
                          `/${locale}/account/profile`,
                        )}
                        onClick={closeMobileMenu}
                        className="flex h-11 items-center gap-3 rounded-xl px-3 transition-colors hover:bg-muted active:bg-muted"
                      >
                        <User className="h-4 w-4 text-muted-foreground" />
                        {t("common.profile")}
                      </Link>
                    </>
                  )}
                </div>
              </section>
            </>
          )}

          {/* Language / currency close the drawer with no heading of their own.
              The old "Settings" heading over this block read as a sibling of
              the account area's dashboard-settings link — two "Settings" in one
              sheet meaning different things. Theme moved to the brand bar, so
              what is left here is market data, not preferences. */}
          {showMobileMarketSelectors && (
            <>
              <Separator />
              <section className="grid gap-3 px-5 py-4">
                {showLanguageSelector && (
                  <label className="grid gap-1.5 text-sm font-medium">
                    <span className="flex items-center gap-2">
                      <Globe2 className="h-4 w-4 text-muted-foreground" />
                      {t("common.language")}
                    </span>
                    <div className="relative">
                      <select
                        value={language.code}
                        onChange={(event) =>
                          handleMobileLanguageChange(event.target.value)
                        }
                        className="h-11 w-full appearance-none rounded-xl border bg-background px-3 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      >
                        {languages.map((lang) => (
                          <option key={lang.code} value={lang.code}>
                            {lang.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    </div>
                  </label>
                )}

                {/* Read-only: the store currency is admin-controlled
                    (settings.general.defaultCurrency). */}
                {showCurrencySelector && (
                  <div className="grid gap-1.5 text-sm font-medium">
                    <span className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      {t("common.currency")}
                    </span>
                    <div className="flex h-11 w-full items-center rounded-xl border bg-muted/40 px-3 text-sm text-muted-foreground">
                      {currency.code} - {currency.name}
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// One drawer nav row. The active page is tinted with the accent so a shopper
// opening the menu can see where they already are.
function MobileNavRow({
  href,
  icon: Icon,
  label,
  active,
  onNavigate,
  target,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onNavigate: () => void;
  target?: string;
}) {
  return (
    <Link
      href={href}
      target={target}
      rel={target === "_blank" ? "noopener noreferrer" : undefined}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-11 items-center gap-3 rounded-xl px-3 transition-colors",
        active ? "bg-accent text-primary" : "hover:bg-muted active:bg-muted",
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4",
          active ? "text-primary" : "text-muted-foreground",
        )}
      />
      {label}
    </Link>
  );
}

/**
 * Collapsible group used by both the "More" links and the category list.
 *
 * Same row as a nav item — icon, label, chevron — with an optional trailing
 * action (categories put "View all" there so the full catalog stays one tap
 * away whether or not the list is expanded). Collapsed by default: the
 * drawer's job is to get a shopper to a destination fast, and every
 * always-open group pushes the ones below it off the screen.
 */
function MobileNavDisclosure({
  icon: Icon,
  label,
  action,
  className,
  children,
}: {
  icon: LucideIcon;
  label: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={className}>
      <div className="flex items-center gap-2 px-3">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
        >
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-semibold">{label}</span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              isOpen && "rotate-180",
            )}
          />
        </button>
        {action}
      </div>

      {isOpen && (
        // Slight indent so expanded rows read as children of the group rather
        // than as more top-level destinations.
        <div className="mt-1 grid gap-1 pl-2 duration-200 animate-in fade-in-0 slide-in-from-top-1">
          {children}
        </div>
      )}
    </div>
  );
}

// Tiny uppercase group label — gives the drawer's long list its sections.
function MobileNavLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </p>
  );
}
