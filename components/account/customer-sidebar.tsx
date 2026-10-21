"use client";

import * as React from "react";
import Link from "@/components/language/link";
import { usePathname } from "@/hooks/use-locale-navigation";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
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
  presetColors,
  useAppSettings as useUiAppSettings,
} from "@/stores/app-settings";
import { useAppSettings as usePublicAppSettings } from "@/providers/app-settings-provider";
import { useAppTheme } from "@/providers/theme-provider";
import { signOutAndReload } from "@/lib/auth/auth-client";
import { AppImage } from "@/components/ui/app-image";
import { SidebarCountBadge } from "@/components/layout/sidebar-count-badge";
import {
  dashboardLinks,
  settingsLinks,
  type AccountNavLink,
  type AccountStats,
} from "./account-nav-links";

interface CustomerSidebarProps {
  locale: string;
  stats?: AccountStats;
}

/**
 * The account area's navigation, drawn like the admin, vendor and staff
 * sidebars: the same rail, brand block and collapse-to-icons behaviour. On
 * phones it is the off-canvas sheet the header's trigger opens.
 */
export function CustomerSidebar({ locale, stats = {} }: CustomerSidebarProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const { navColor, presetColor, primaryColor, rtl } = useUiAppSettings();
  const { storeName, logoUrl, darkModeLogoUrl, faviconUrl } =
    usePublicAppSettings();
  const { isDark } = useAppTheme();
  const { state: sidebarState, isMobile, setOpenMobile } = useSidebar();
  const [liveStats, setLiveStats] = React.useState(stats);

  // Re-read only when a page reports a change (an address saved, a
  // notification read). There is no read on mount: the layout computed these
  // same numbers on the server for this very render.
  React.useEffect(() => {
    let isActive = true;

    const onStatsChanged = async () => {
      try {
        const res = await fetch("/api/user/account-stats");
        const json = await res.json().catch(() => null);
        if (!isActive || !res.ok || !json?.success) return;
        const nextStats = json?.data?.stats;
        if (nextStats) setLiveStats(nextStats);
      } catch {}
    };

    window.addEventListener("account:stats-changed", onStatsChanged);
    return () => {
      isActive = false;
      window.removeEventListener("account:stats-changed", onStatsChanged);
    };
  }, []);

  // The sheet stays open across a client navigation on phones; close it so
  // the page the visitor picked is what they see.
  React.useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  const label = (link: AccountNavLink) =>
    link.labelFallback && !t.has(link.labelKey)
      ? link.labelFallback
      : t(link.labelKey);

  const isItemActive = (href: string) => {
    const fullPath = `/${locale}${href}`;
    // Overview is the account root, so it would prefix-match every sub-page.
    if (href === "/account") return pathname === fullPath;
    return pathname === fullPath || pathname.startsWith(`${fullPath}/`);
  };

  const isRTL = locale === "ar" || rtl;
  const sidebarSide = isRTL ? "right" : "left";
  const isIconCollapsed = !isMobile && sidebarState === "collapsed";

  const isApparent = navColor === "apparent";
  const useDarkSidebarBrand = isDark || isApparent;
  const presetColorHex =
    typeof primaryColor === "string" && primaryColor.trim()
      ? primaryColor
      : presetColors[presetColor]?.hex;

  const brandStoreName =
    typeof storeName === "string" && storeName.trim()
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
              {brandStoreName.charAt(0).toUpperCase()}
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

  const itemClassName = (active: boolean) =>
    cn(
      "rounded-lg px-3 py-2.5 h-9 text-[13px] font-semibold transition-colors group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1.5",
      isApparent
        ? active
          ? "bg-white/20 text-white hover:bg-white/25"
          : "text-white/80 hover:bg-white/10 hover:text-white"
        : active
          ? "bg-primary/10 text-primary hover:bg-primary/10 dark:bg-white/15 dark:text-white dark:hover:bg-white/20"
          : "text-foreground/70 hover:bg-muted/60 hover:text-foreground",
    );

  const railLabelClassName = (active: boolean) =>
    cn(
      "hidden text-[11px] leading-tight group-data-[collapsible=icon]:block text-center wrap-break-word whitespace-normal overflow-visible",
      isApparent
        ? "text-white"
        : active
          ? "text-sidebar-accent-foreground"
          : "text-muted-foreground",
    );

  // The first group goes unlabelled, as the admin's does: it sits right under
  // the brand, where a heading would only repeat what the page already is.
  const navGroups = [
    { key: "dashboard", label: "", links: dashboardLinks },
    { key: "settings", label: t("admin.settings.title"), links: settingsLinks },
  ].map((group) => ({
    ...group,
    links: group.links.filter((link) => !link.hideInSidebar),
  }));

  return (
    <Sidebar
      key={`customer-sidebar-${locale}-${sidebarSide}`}
      side={sidebarSide}
      className={cn(
        "border-r-0 transition-colors duration-300",
        isRTL && "border-l-0 border-r",
      )}
      style={sidebarStyle}
      collapsible="icon"
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
          href={`/${locale}`}
          className="flex w-full items-center px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          {renderBrand()}
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3 group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:gap-1">
        {navGroups.map((group, groupIndex) => (
          <SidebarGroup
            key={group.key}
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
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-1 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-3">
                {group.links.map((link) => {
                  const Icon = link.icon;
                  const active = isItemActive(link.href);
                  const rawCount = link.countKey
                    ? liveStats[link.countKey]
                    : undefined;
                  const count = typeof rawCount === "number" ? rawCount : 0;
                  return (
                    <SidebarMenuItem
                      key={link.href}
                      className="group-data-[collapsible=icon]:w-full"
                    >
                      <SidebarMenuButton
                        asChild
                        size="sm"
                        isActive={active}
                        className={itemClassName(active)}
                      >
                        <Link
                          prefetch={false}
                          href={`/${locale}${link.href}`}
                          className="relative w-full"
                        >
                          <div className="flex w-full items-center gap-3 group-data-[collapsible=icon]:justify-center">
                            <span className="relative inline-flex shrink-0">
                              <Icon className="size-4.5 shrink-0 stroke-2 transition-transform duration-300 group-data-[collapsible=icon]:size-5" />
                              <SidebarCountBadge
                                count={count}
                                isApparent={isApparent}
                                rail
                              />
                            </span>
                            <span className="group-data-[collapsible=icon]:hidden">
                              {label(link)}
                            </span>
                            <SidebarCountBadge
                              count={count}
                              isApparent={isApparent}
                            />
                          </div>
                          <span className={railLabelClassName(active)}>
                            {label(link)}
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
              type="button"
              size="sm"
              onClick={() => signOutAndReload(locale)}
              className={itemClassName(false)}
            >
              <div className="flex w-full items-center gap-3 group-data-[collapsible=icon]:justify-center">
                <LogOut className="size-4.5 shrink-0 stroke-2 group-data-[collapsible=icon]:size-5" />
                <span className="group-data-[collapsible=icon]:hidden">
                  {t("auth.signOut")}
                </span>
              </div>
              <span className={railLabelClassName(false)}>
                {t("auth.signOut")}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
