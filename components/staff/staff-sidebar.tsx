"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BarChart3,
  ClipboardList,
  LayoutDashboard,
  MessageSquare,
  type LucideIcon,
  Package,
  ShoppingCart,
  Users,
  UserRound,
  Warehouse,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import {
  STAFF_PERMISSIONS,
  type StaffPermission,
} from "@/config/permissions.config";
import {
  presetColors,
  useAppSettings as useUiAppSettings,
} from "@/stores/app-settings";
import { useAppSettings as usePublicAppSettings } from "@/providers/app-settings-provider";
import { useAppTheme } from "@/providers/theme-provider";
import { AppImage } from "@/components/ui/app-image";
import type { Locale } from "@/config/i18n.config";

interface NavItem {
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

interface StaffSidebarProps {
  locale: Locale;
  user: {
    name: string;
    email: string;
    image?: string;
  };
  permissions: StaffPermission[];
  posEnabled: boolean;
  storeName?: string;
}

function buildStaffNav(
  locale: Locale,
  permissions: StaffPermission[],
  posEnabled: boolean,
): NavGroup[] {
  const has = (perm: StaffPermission) => permissions.includes(perm);

  const mainItems: NavItem[] = [
    {
      key: "dashboard",
      href: `/${locale}/staff/dashboard`,
      label: "admin.sidebar.dashboard",
      icon: LayoutDashboard,
    },
  ];

  if (has(STAFF_PERMISSIONS.VIEW_ORDERS)) {
    mainItems.push({
      key: "orders",
      href: `/${locale}/staff/orders`,
      label: "admin.sidebar.orders",
      icon: ClipboardList,
    });
  }

  if (
    has(STAFF_PERMISSIONS.VIEW_PRODUCTS) ||
    has(STAFF_PERMISSIONS.MANAGE_PRODUCTS) ||
    has(STAFF_PERMISSIONS.CREATE_PRODUCTS) ||
    has(STAFF_PERMISSIONS.EDIT_PRODUCTS) ||
    has(STAFF_PERMISSIONS.DELETE_PRODUCTS)
  ) {
    mainItems.push({
      key: "products",
      href: `/${locale}/staff/products`,
      label: "admin.sidebar.products",
      icon: Package,
    });
  }

  if (
    has(STAFF_PERMISSIONS.VIEW_INVENTORY) ||
    has(STAFF_PERMISSIONS.MANAGE_INVENTORY) ||
    has(STAFF_PERMISSIONS.CREATE_INVENTORY) ||
    has(STAFF_PERMISSIONS.EDIT_INVENTORY) ||
    has(STAFF_PERMISSIONS.DELETE_INVENTORY)
  ) {
    mainItems.push({
      key: "inventory",
      href: `/${locale}/staff/inventory`,
      label: "admin.sidebar.inventory",
      icon: Warehouse,
    });
  }

  if (
    has(STAFF_PERMISSIONS.VIEW_CUSTOMERS) ||
    has(STAFF_PERMISSIONS.MANAGE_CUSTOMERS) ||
    has(STAFF_PERMISSIONS.CREATE_CUSTOMERS) ||
    has(STAFF_PERMISSIONS.EDIT_CUSTOMERS) ||
    has(STAFF_PERMISSIONS.DELETE_CUSTOMERS)
  ) {
    mainItems.push({
      key: "customers",
      href: `/${locale}/staff/customers`,
      label: "admin.sidebar.customers",
      icon: Users,
    });
  }

  if (has(STAFF_PERMISSIONS.VIEW_ANALYTICS)) {
    mainItems.push({
      key: "analytics",
      href: `/${locale}/staff/analytics`,
      label: "admin.sidebar.analytics",
      icon: BarChart3,
    });
  }

  if (
    has(STAFF_PERMISSIONS.VIEW_INBOX) ||
    has(STAFF_PERMISSIONS.REPLY_INBOX) ||
    has(STAFF_PERMISSIONS.MANAGE_INBOX)
  ) {
    mainItems.push({
      key: "inbox",
      href: `/${locale}/staff/inbox`,
      label: "admin.sidebar.inbox",
      icon: MessageSquare,
    });
  }

  const groups: NavGroup[] = [{ items: mainItems }];

  if (posEnabled && has(STAFF_PERMISSIONS.ACCESS_POS)) {
    groups.push({
      label: "admin.sidebar.salesChannels",
      items: [
        {
          key: "pos",
          href: `/${locale}/staff/pos`,
          label: "admin.sidebar.pos",
          icon: ShoppingCart,
        },
      ],
    });
  }

  return groups;
}

// Every sidebar link is `prefetch={false}` on purpose. The tree holds 50–90
// links, and Next 16's viewport prefetch rendered a `/_tree` partial for each
// of them on every dashboard page view — more server work than the page
// itself. A click now pays one round trip instead (with `false`, Next 16 does
// not prefetch on hover either).
export function StaffSidebar({
  locale,
  user,
  permissions,
  posEnabled,
  storeName,
}: StaffSidebarProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const { navColor, presetColor, primaryColor, rtl } = useUiAppSettings();
  const {
    storeName: liveStoreName,
    logoUrl,
    darkModeLogoUrl,
    faviconUrl,
  } = usePublicAppSettings();
  const { isDark } = useAppTheme();
  const { state: sidebarState, isMobile } = useSidebar();

  const basePath = React.useMemo(() => {
    const prefix = `/${locale}`;
    if (pathname?.startsWith(prefix)) {
      const stripped = pathname.slice(prefix.length);
      return stripped.length ? stripped : "/";
    }
    return pathname || "/";
  }, [pathname, locale]);

  const tLabel = React.useCallback(
    (key: string) => {
      try {
        return t(key as never);
      } catch {
        return key;
      }
    },
    [t],
  );

  const navGroups = React.useMemo(
    () => buildStaffNav(locale, permissions, posEnabled),
    [locale, permissions, posEnabled],
  );

  const isRTL = locale === "ar" || rtl;
  const sidebarSide = isRTL ? "right" : "left";
  const collapsible = "icon";
  const isIconCollapsed =
    !isMobile && collapsible === "icon" && sidebarState === "collapsed";

  const isApparent = navColor === "apparent";
  const useDarkSidebarBrand = isDark || isApparent;
  const presetColorHex =
    typeof primaryColor === "string" && primaryColor.trim()
      ? primaryColor
      : presetColors[presetColor]?.hex;

  const brandStoreName =
    typeof liveStoreName === "string" && liveStoreName.trim()
      ? liveStoreName.trim()
      : typeof storeName === "string" && storeName.trim()
        ? storeName.trim()
        : DEFAULT_STORE_NAME;

  const currentLogoUrl =
    useDarkSidebarBrand &&
    typeof darkModeLogoUrl === "string" &&
    darkModeLogoUrl.trim()
      ? darkModeLogoUrl
      : typeof logoUrl === "string" && logoUrl.trim()
        ? logoUrl
        : "";
  // No bundled icon backs this up — an unconfigured favicon shows the store's
  // initial, never this app's own mark.
  const currentFaviconUrl =
    typeof faviconUrl === "string" && faviconUrl.trim() ? faviconUrl : "";

  const renderBrand = () => {
    if (isIconCollapsed) {
      return (
        <span className="relative block h-8 w-8 shrink-0 overflow-hidden rounded-md">
          {currentFaviconUrl ? (
            <AppImage
              src={currentFaviconUrl}
              alt="Favicon"
              className="h-8 w-8 object-contain"
              width={32}
              height={32}
            />
          ) : (
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md text-sm font-bold",
                isApparent
                  ? "bg-white/15 text-white"
                  : "bg-primary/10 text-primary",
              )}
            >
              {brandStoreName.trim().charAt(0).toUpperCase()}
            </span>
          )}
        </span>
      );
    }

    if (currentLogoUrl) {
      return (
        <span className="relative block h-8 w-full overflow-hidden">
          <AppImage
            src={currentLogoUrl}
            alt="Logo"
            className="h-8 w-full object-contain object-left"
            width={224}
            height={32}
          />
        </span>
      );
    }

    return (
      <span
        className={cn(
          "block truncate text-lg font-bold",
          isApparent
            ? "text-white"
            : "bg-linear-to-r from-primary to-primary/70 bg-clip-text text-transparent",
        )}
      >
        {brandStoreName}
      </span>
    );
  };

  const sidebarStyle = isApparent
    ? ({
        "--sidebar": presetColorHex,
        "--color-sidebar": presetColorHex,
        "--sidebar-foreground": "#ffffff",
        "--color-sidebar-foreground": "#ffffff",
        "--sidebar-accent": "rgb(255 255 255 / 0.2)",
        "--color-sidebar-accent": "rgb(255 255 255 / 0.2)",
        "--sidebar-accent-foreground": "#ffffff",
        "--color-sidebar-accent-foreground": "#ffffff",
      } as React.CSSProperties)
    : undefined;

  const isItemActive = (href: string) =>
    basePath === href || basePath.startsWith(`${href}/`);

  if (basePath === "/staff/pos") {
    return null;
  }

  const profileHref = `/${locale}/staff/profile`;
  const isProfileActive = isItemActive(`/staff/profile`);

  return (
    <Sidebar
      key={`staff-sidebar-${locale}-${sidebarSide}`}
      side={sidebarSide}
      className={cn(
        "border-r-0 transition-colors duration-300",
        isRTL && "border-l-0 border-r",
      )}
      style={sidebarStyle}
      collapsible={collapsible}
    >
      {!isMobile && (
        <div
          suppressHydrationWarning
          className={cn(
            "absolute top-0 bottom-0 w-px z-30 pointer-events-none",
            isApparent ? "bg-white/30" : "bg-border",
            isRTL ? "-left-px" : "-right-px",
          )}
        />
      )}

      <SidebarHeader className="border-b-0 px-3 py-3 relative group-data-[collapsible=icon]:px-2">
        <Link
          prefetch={false}
          href={`/${locale}/staff/dashboard`}
          className="flex w-full items-center px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          {renderBrand()}
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3 group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:gap-1">
        {navGroups.map((group, groupIndex) => (
          <SidebarGroup
            key={group.label ?? `group-${groupIndex}`}
            className={cn(
              groupIndex === 0 ? "mt-0" : "mt-2",
              "group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:py-2",
            )}
          >
            {group.label && (
              <SidebarGroupLabel
                className={cn(
                  "px-4 mb-1 text-[11px] font-semibold tracking-[0.08em] uppercase group-data-[collapsible=icon]:hidden flex items-center",
                  isApparent ? "text-white/60" : "text-muted-foreground/60",
                )}
              >
                {tLabel(group.label)}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-1 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-3">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isItemActive(
                    item.href.replace(`/${locale}`, ""),
                  );
                  return (
                    <SidebarMenuItem
                      key={item.key}
                      className="group-data-[collapsible=icon]:w-full"
                    >
                      <SidebarMenuButton
                        asChild
                        size="sm"
                        isActive={active}
                        className={cn(
                          "rounded-lg px-3 py-2.5 h-9 text-[13px] transition-colors group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1.5",
                          isApparent
                            ? active
                              ? "bg-white/20 text-white hover:bg-white/25 font-semibold"
                              : "text-white/80 hover:bg-white/10 hover:text-white font-semibold"
                            : active
                              ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-50 dark:bg-white/15 dark:text-white dark:hover:bg-white/20 font-semibold"
                              : "text-foreground/70 hover:bg-muted/60 hover:text-foreground font-semibold",
                        )}
                      >
                        <Link prefetch={false} href={item.href} className="relative w-full">
                          <div className="flex w-full items-center gap-3 group-data-[collapsible=icon]:justify-center">
                            <Icon className="size-4.5 shrink-0 stroke-2 transition-transform duration-300 group-data-[collapsible=icon]:size-5" />
                            <span className="group-data-[collapsible=icon]:hidden">
                              {tLabel(item.label)}
                            </span>
                          </div>
                          <span
                            className={cn(
                              "hidden text-[11px] leading-tight group-data-[collapsible=icon]:block text-center wrap-break-word whitespace-normal overflow-visible",
                              isApparent
                                ? "text-white"
                                : active
                                  ? "text-sidebar-accent-foreground"
                                  : "text-muted-foreground",
                            )}
                          >
                            {tLabel(item.label)}
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="p-3 group-data-[collapsible=icon]:p-2 mt-auto">
        <SidebarMenu className="group-data-[collapsible=icon]:items-center">
          <SidebarMenuItem className="group-data-[collapsible=icon]:w-full">
            <SidebarMenuButton
              asChild
              size="sm"
              isActive={isProfileActive}
              className={cn(
                "rounded-lg px-3 py-2.5 h-9 text-[13px] transition-colors group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1.5",
                isApparent
                  ? isProfileActive
                    ? "bg-white/20 text-white hover:bg-white/25 font-semibold"
                    : "text-white/80 hover:bg-white/10 hover:text-white font-semibold"
                  : isProfileActive
                    ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-50 dark:bg-white/15 dark:text-white dark:hover:bg-white/20 font-semibold"
                    : "text-foreground/70 hover:bg-muted/60 hover:text-foreground font-semibold",
              )}
            >
              <Link
                prefetch={false}
                href={profileHref}
                className="relative flex w-full items-center gap-3 group-data-[collapsible=icon]:justify-center"
              >
                <UserRound className="size-4.5 shrink-0 stroke-2 transition-transform duration-300 group-data-[collapsible=icon]:size-5" />
                <span className="flex-1 truncate group-data-[collapsible=icon]:hidden">
                  {user.name || user.email}
                </span>
                <span
                  className={cn(
                    "hidden text-[11px] leading-tight group-data-[collapsible=icon]:block text-center wrap-break-word whitespace-normal overflow-visible",
                    isApparent
                      ? "text-white"
                      : isProfileActive
                        ? "text-sidebar-accent-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  {tLabel("common.profile")}
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
