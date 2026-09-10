"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { SearchModal } from "@/components/admin/search-modal";
import {
  User,
  Settings,
  LogOut,
  LayoutDashboard,
  ShoppingCart,
  Globe,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAndReload } from "@/lib/auth/auth-client";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { SettingsDrawer } from "@/components/admin/settings-drawer";
import { locales, localeConfig, type Locale } from "@/config/i18n.config";
import { FlagIcon } from "@/components/ui/flag-icon";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { NotificationDrawer } from "@/components/admin/notification-drawer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { USER_ROLES } from "@/config/app.config";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import { useAppSettings as usePublicAppSettings } from "@/providers/app-settings-provider";
import { useAppTheme } from "@/providers/theme-provider";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";

interface AdminHeaderProps {
  user: {
    name: string;
    email: string;
    image?: string;
  };
  locale: Locale;
  role?: string;
  posEnabled?: boolean;
}

export function AdminHeader({
  user,
  locale,
  role,
  posEnabled,
}: AdminHeaderProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const isAdmin = role === USER_ROLES.ADMIN;
  const { storeName, logoUrl, darkModeLogoUrl } = usePublicAppSettings();
  const { isDark } = useAppTheme();
  const activeLogoUrl =
    isDark && typeof darkModeLogoUrl === "string" && darkModeLogoUrl.trim()
      ? darkModeLogoUrl
      : typeof logoUrl === "string" && logoUrl.trim()
        ? logoUrl
        : undefined;

  const basePath = React.useMemo(() => {
    const prefix = `/${locale}`;
    if (pathname?.startsWith(prefix)) {
      const stripped = pathname.slice(prefix.length);
      return stripped.length ? stripped : "/";
    }
    return pathname;
  }, [pathname, locale]);

  const isPosTerminal =
    basePath === "/admin/pos" || basePath === "/vendor/pos";
  const dashboardHref =
    role === USER_ROLES.VENDOR
      ? `/${locale}/vendor/dashboard`
      : `/${locale}/admin/dashboard`;

  const handleLogout = async () => {
    await signOutAndReload(locale);
  };

  const handleLocaleChange = (newLocale: Locale) => {
    if (!pathname) return;
    const currentPrefix = `/${locale}`;
    const newPathname = pathname.startsWith(currentPrefix)
      ? pathname.replace(currentPrefix, `/${newLocale}`)
      : `/${newLocale}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
    router.push(newPathname);
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const currentLocaleConfig = localeConfig[locale];

  const languageOptions = React.useMemo(
    () =>
      locales.map((loc) => {
        const cfg = localeConfig[loc];
        return {
          value: loc,
          label: cfg.nativeName,
          // Match by English name too, so "german" finds "Deutsch".
          keywords: `${cfg.name} ${loc}`,
          icon: <FlagIcon countryCode={cfg.countryCode} size={20} />,
        };
      }),
    [],
  );

  return (
    <header
      className={cn(
        // Dashboard navigation is chrome, not content: printing an order (or
        // any dashboard screen) should produce the page, not the shell.
        "sticky top-0 z-40 grid h-16 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 backdrop-blur transition-[width,height] ease-linear print:hidden sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
        isPosTerminal
          ? "bg-card"
          : "border-b bg-background/95 supports-[backdrop-filter]:bg-background/80"
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {isPosTerminal ? (
          <Link
            href={dashboardHref}
            className="flex items-center gap-2 shrink-0 mr-1"
            aria-label={
              typeof storeName === "string" && storeName.trim()
                ? storeName
                : DEFAULT_STORE_NAME
            }
          >
            {activeLogoUrl ? (
              <span className="relative block h-8 w-32 overflow-hidden">
                <AppImage
                  src={activeLogoUrl}
                  alt="Logo"
                  width={128}
                  height={32}
                  className="h-8 w-full object-contain object-left"
                />
              </span>
            ) : (
              <span className="bg-linear-to-r from-primary to-primary/70 bg-clip-text text-transparent text-lg font-bold truncate">
                {typeof storeName === "string" && storeName.trim()
                  ? storeName
                  : DEFAULT_STORE_NAME}
              </span>
            )}
          </Link>
        ) : (
          <SidebarTrigger className="size-9" />
        )}
        <SearchModal />
      </div>

      {/* Center buttons */}
      <div className="hidden items-center justify-center gap-2 justify-self-center sm:flex">
        {isPosTerminal ? (
          <Button variant="outline" size="sm" className="rounded-xl gap-2" asChild>
            <Link href={dashboardHref}>
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden sm:inline">{t("common.backToDashboard")}</span>
            </Link>
          </Button>
        ) : posEnabled ? (
          <Button variant="outline" size="sm" className="rounded-xl gap-2 border-primary/30 text-primary hover:bg-primary/5 dark:border-border dark:text-foreground dark:hover:bg-accent dark:hover:text-accent-foreground" asChild>
            <Link href={`/${locale}/admin/pos`}>
              <ShoppingCart className="h-4 w-4" />
              <span className="hidden sm:inline">POS</span>
            </Link>
          </Button>
        ) : null}
        <Button variant="outline" size="sm" className="rounded-xl gap-2" asChild>
          <Link href={`/${locale}`} target="_blank" rel="noopener noreferrer">
            <Globe className="h-4 w-4" />
            <span className="hidden sm:inline">{t("admin.browseWebsite")}</span>
          </Link>
        </Button>
      </div>

      <div className="flex min-w-0 items-center justify-end gap-2">
        {/* Language Selector */}
        <SearchableSelect
          options={languageOptions}
          value={locale}
          onValueChange={(loc) => handleLocaleChange(loc as Locale)}
          searchPlaceholder={t("common.selectLanguage")}
          align="end"
          contentClassName="w-56 rounded-xl border-border/60 bg-popover/95 shadow-xl backdrop-blur"
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-primary"
              aria-label={t("common.selectLanguage")}
            >
              <FlagIcon countryCode={currentLocaleConfig.countryCode} size={22} />
            </Button>
          }
        />

        {/* Notifications Drawer */}
        <NotificationDrawer locale={locale} />

        {/* Settings Drawer */}
        {isAdmin && <SettingsDrawer locale={locale} />}

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full h-10 w-10 border border-border p-1"
            >
              <Avatar className="h-full w-full">
                <AvatarImage src={user.image} alt={user.name} />
                <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={10}
            collisionPadding={12}
            className="w-56 max-w-[calc(100vw-1.5rem)] rounded-xl border-border/60 bg-popover/95 shadow-xl backdrop-blur"
          >
            <DropdownMenuLabel>
              <div className="flex min-w-0 flex-col space-y-1">
                <p className="truncate text-sm font-medium leading-tight">
                  {user.name}
                </p>
                <p
                  className="truncate text-xs leading-tight text-muted-foreground"
                  title={user.email}
                >
                  {user.email}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`/${locale}/admin/profile`} className="cursor-pointer">
                <User className="mr-2 h-4 w-4" />
                <span>{t("adminProfile.title")}</span>
              </Link>
            </DropdownMenuItem>
            {isAdmin && (
              <DropdownMenuItem asChild>
                <Link
                  href={`/${locale}/admin/settings`}
                  className="cursor-pointer"
                >
                  <Settings className="mr-2 h-4 w-4" />
                  <span>
                    {t("common.settings")}
                  </span>
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>{t("common.logout")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
