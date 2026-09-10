"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Heart,
  Home,
  LayoutDashboard,
  Menu,
  User,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useWishlist } from "@/hooks/use-wishlist";
import { buildLoginUrl } from "@/lib/auth/return-path";
import { getRoleDashboardPath } from "@/lib/access/role-dashboard";
import { AccountDrawer } from "@/components/layout/account-drawer";
import type { OAuthEnabled } from "@/components/auth/login-form";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useMobileMenu } from "@/stores/mobile-menu";
import { useHydrated } from "@/hooks/use-client-value";
import { type Locale } from "@/config/i18n.config";

interface StoreBottomNavProps {
  locale: Locale;
  /**
   * Server-resolved auth flags, forwarded straight to the guest account drawer
   * — the same ones /login and /register render with, so the OAuth buttons and
   * the demo card are in the initial HTML rather than popping in later.
   */
  oauthEnabled: OAuthEnabled;
  demoModeEnabled: boolean;
  emailVerificationRequired: boolean;
}

/**
 * A tab is either a link to a destination or a button that toggles a drawer —
 * Menu always, Account for guests. Both wear the same chrome, so the two kinds
 * differ only in the element they render and in how "active" is decided.
 */
type NavTab = {
  key: string;
  icon: LucideIcon;
  label: string;
  badge?: number;
  avatar?: { src?: string; name: string } | null;
};

type NavItem =
  | (NavTab & { kind: "link"; href: string })
  | (NavTab & { kind: "drawer"; isOpen: boolean; onToggle: () => void })
  | { kind: "placeholder"; key: string };

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Thumb-reachable navigation for phones and small tablets. Reaching the header
 * means scrolling back to the top of a long page, so the primary destinations
 * live down here instead.
 *
 * The bar and the mobile header split the work: the header's top-right slot
 * holds the cart (the drawer there offers "View cart" / "Checkout"), and this
 * bar holds the menu — the hamburger's old corner was the furthest point from
 * a thumb on a tall phone. Categories are not a tab; they live one level in,
 * inside that menu drawer, which lists them with their subcategories.
 *
 * Role-aware: staff-side roles (admin/vendor/staff) get a Dashboard tab in
 * place of Account and no Wishlist tab — the account area is customer-only.
 * While the session resolves, those two slots show neutral placeholders so
 * the bar never reshuffles under the user's thumb. Once signed in, the Account
 * tab wears the user's avatar instead of the generic person glyph; while
 * signed out it opens a drawer rather than jumping to /login, so a shopper
 * mid-browse keeps their place (see `AccountDrawer`).
 *
 * Hidden from `xl` up, where the header's own nav row takes over.
 */
export function StoreBottomNav({
  locale,
  oauthEnabled,
  demoModeEnabled,
  emailVerificationRequired,
}: StoreBottomNavProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const { isAuthenticated, isLoading: sessionLoading, user } = useAuth();
  // The role-dependent tabs stay placeholders until the tree has hydrated,
  // as the header's account button does. The session can resolve — or
  // fail — before hydration completes, and a tab that had already turned
  // into a link on the client would not match the placeholder the server
  // sent, which React reports as a hydration mismatch on that <Link>.
  const mounted = useHydrated();
  const isLoading = sessionLoading || !mounted;
  const isMenuOpen = useMobileMenu((state) => state.isOpen);
  const setMenuOpen = useMobileMenu((state) => state.setOpen);
  // Unlike the menu drawer — whose sheet the header renders, hence the shared
  // store — the account drawer belongs to this bar alone.
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const {
    items: wishlistItems,
    fetchWishlist,
    isSynced,
  } = useWishlist();

  // Staff-side roles (admin/vendor/staff) get a Dashboard tab instead of the
  // customer account tabs — the account area is customer-only and would
  // redirect them anyway.
  const dashboardHref = getRoleDashboardPath(locale, user?.role);

  // The wishlist store hydrates lazily; same pattern as WishlistHeaderIcon so
  // the badge shows the real count instead of the persisted stale one. Waits
  // for the session to resolve: staff-side roles have no wishlist tab to hang
  // a badge on, so their fetch would be wasted.
  useEffect(() => {
    if (!isLoading && !isSynced && !dashboardHref) {
      fetchWishlist();
    }
  }, [isLoading, isSynced, fetchWishlist, dashboardHref]);

  const home = `/${locale}`;

  // Landmark and menu labels. No existing locale key fits either, and adding
  // one would mean touching every locale file, so these fall back to literals
  // rather than rendering a MISSING_MESSAGE string.
  const navLabel = t.has("common.navigation")
    ? t("common.navigation")
    : "Main navigation";
  const menuLabel = t.has("common.menu") ? t("common.menu") : "Menu";

  // Wishlist is one destination rather than a hub, so a guest tapping it goes
  // straight to login with a return path — no drawer in between — and never
  // dead-ends on the account layout's redirect.
  const wishlistPath = `/${locale}/account/wishlist`;
  const wishlistHref = isAuthenticated
    ? wishlistPath
    : buildLoginUrl(locale, wishlistPath);

  // A signed-in shopper's own photo is a faster "that's me" cue than the
  // generic glyph; initials cover accounts with no image, and guests keep the
  // glyph because there is no identity to show yet.
  const avatar =
    isAuthenticated && user
      ? { src: user.image || undefined, name: user.name || "" }
      : null;

  // The wishlist and account slots depend on the viewer's role — staff-side
  // roles lose Wishlist and get Dashboard in place of Account. The storefront
  // pages are static, so the role is only known once the client session
  // resolves; committing to the customer layout during that window would
  // reshuffle the tabs under the user's thumb once the role arrives. Instead
  // those two slots render neutral placeholders while loading (same idea as
  // the header's account-button skeleton), and the role-invariant tabs stay
  // interactive throughout.
  const items: NavItem[] = [
    {
      kind: "link",
      key: "home",
      href: home,
      icon: Home,
      label: t("common.home"),
    },
    // Wishlist lives under the customer-only account area, so staff-side
    // roles get no tab for it.
    ...(isLoading
      ? [{ kind: "placeholder", key: "wishlist" } as const]
      : dashboardHref
        ? []
        : [
            {
              kind: "link",
              key: "wishlist",
              href: wishlistHref,
              icon: Heart,
              label: t("common.wishlist"),
              badge: wishlistItems.length,
            } as const,
          ]),
    // Opens the drawer the header renders (shared through `useMobileMenu`)
    // rather than navigating.
    {
      kind: "drawer",
      key: "menu",
      icon: Menu,
      label: menuLabel,
      isOpen: isMenuOpen,
      onToggle: () => setMenuOpen(!isMenuOpen),
    },
    // Account takes the last slot on purpose, so the two ends carry the two
    // anchors: Home where reading order starts, identity where a thumb
    // reaches most easily. That leaves Menu the inner slot — a deliberate
    // trade against the usual "overflow goes last" habit, since demoting Home
    // to make room for it would cost more than moving it in one place.
    isLoading
      ? { kind: "placeholder", key: "account" }
      : dashboardHref
        ? {
            kind: "link",
            key: "dashboard",
            href: dashboardHref,
            icon: LayoutDashboard,
            label: t("common.dashboard"),
          }
        : isAuthenticated
          ? {
              kind: "link",
              key: "account",
              href: `/${locale}/account`,
              icon: User,
              label: t("common.account"),
              avatar,
            }
          : {
              kind: "drawer",
              key: "account",
              icon: User,
              label: t("common.account"),
              isOpen: isAccountOpen,
              onToggle: () => setIsAccountOpen(!isAccountOpen),
            },
  ];

  // Every storefront path starts with `/${locale}`, so home has to match
  // exactly or it would light up on every page. Wishlist lives under
  // /account/, so the account tab has to disclaim that subtree or both tabs
  // would light up at once.
  const isActive = (key: string, href: string) => {
    if (key === "home") return pathname === home;
    if (key === "wishlist") {
      return (
        pathname === wishlistPath || pathname.startsWith(`${wishlistPath}/`)
      );
    }
    if (key === "account") {
      const account = `/${locale}/account`;
      return (
        (pathname === account || pathname.startsWith(`${account}/`)) &&
        pathname !== wishlistPath &&
        !pathname.startsWith(`${wishlistPath}/`)
      );
    }
    const [path] = href.split("?");
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  // Fixed-height icon box so an avatar, a glyph and a skeleton all leave the
  // label on the same baseline.
  const iconBox = "grid h-6 w-6 place-items-center";
  const tabClass =
    "flex w-full flex-col items-center gap-1 px-1 pb-1.5 pt-2 text-[10px] font-semibold leading-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

  return (
    <>
      <nav
        aria-label={navLabel}
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur",
          "pb-[env(safe-area-inset-bottom)] xl:hidden",
        )}
      >
        <ul className="flex items-stretch">
          {items.map((item) => {
            if (item.kind === "placeholder") {
              // Same paddings/sizes as a real tab so the bar height and the
              // neighboring tab positions never move when the tab materializes.
              return (
                <li key={item.key} className="flex-1">
                  <span
                    aria-hidden="true"
                    className="flex flex-col items-center gap-1 px-1 pb-1.5 pt-2"
                  >
                    <span className={iconBox}>
                      <Skeleton className="h-5 w-5 rounded-md" />
                    </span>
                    <Skeleton className="h-2.5 w-10" />
                  </span>
                </li>
              );
            }

            const Icon = item.icon;
            // A drawer tab has no route to match, so it lights up while its
            // sheet is open instead.
            const active =
              item.kind === "drawer"
                ? item.isOpen
                : isActive(item.key, item.href);
            const badge = item.badge ?? 0;
            const tabClassName = cn(
              tabClass,
              active
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground",
            );
            const face = (
              <>
                <span className={cn("relative", iconBox)}>
                  {item.avatar ? (
                    <Avatar
                      className={cn(
                        "h-6 w-6",
                        active && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                      )}
                    >
                      <AvatarImage
                        src={item.avatar.src}
                        alt=""
                        referrerPolicy="no-referrer"
                      />
                      <AvatarFallback className="text-[9px] font-semibold">
                        {item.avatar.name ? (
                          getInitials(item.avatar.name)
                        ) : (
                          <User className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <Icon
                      className={cn("h-5 w-5", active && "stroke-[2.25]")}
                      aria-hidden="true"
                    />
                  )}
                  {badge > 0 && (
                    <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-white">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate">{item.label}</span>
              </>
            );

            return (
              <li key={item.key} className="flex-1">
                {item.kind === "drawer" ? (
                  <button
                    type="button"
                    onClick={item.onToggle}
                    aria-haspopup="dialog"
                    aria-expanded={item.isOpen}
                    className={tabClassName}
                  >
                    {face}
                  </button>
                ) : (
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={tabClassName}
                  >
                    {face}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Guests only: everyone else's Account tab is a link to a real page. */}
      {!isAuthenticated && (
        <AccountDrawer
          locale={locale}
          isOpen={isAccountOpen}
          setIsOpen={setIsAccountOpen}
          oauthEnabled={oauthEnabled}
          demoModeEnabled={demoModeEnabled}
          emailVerificationRequired={emailVerificationRequired}
        />
      )}
    </>
  );
}
