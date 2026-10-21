"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import Link from "@/components/language/link";
import { useRouter, usePathname } from "@/hooks/use-locale-navigation";
import { SearchModal } from "@/components/admin/search-modal";
import {
  UserRound,
  Settings,
  LayoutDashboard,
  ShoppingCart,
  Globe,
} from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { PreferencesDrawer } from "@/components/layout/preferences-drawer";
import { locales, localeConfig, type Locale } from "@/config/i18n.config";
import { FlagIcon } from "@/components/ui/flag-icon";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { NotificationDrawer } from "@/components/admin/notification-drawer";
import { HeaderAccountMenu } from "@/components/layout/account-menu";
import { USER_ROLES } from "@/config/app.config";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import { useAppSettings as usePublicAppSettings } from "@/providers/app-settings-provider";
import { useAppTheme } from "@/providers/theme-provider";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import { confirmLeaveSettings } from "@/components/admin/settings/settings-leave-check";

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

  const handleLocaleChange = async (newLocale: Locale) => {
    if (!pathname) return;
    const currentPrefix = `/${locale}`;
    const newPathname = pathname.startsWith(currentPrefix)
      ? pathname.replace(currentPrefix, `/${newLocale}`)
      : `/${newLocale}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
    // A push is no link click, so a settings page with unsaved edits is
    // asked here rather than by its own link guard.
    if (!(await confirmLeaveSettings(newPathname))) return;
    router.push(newPathname);
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
        {/* The POS header carries the store logo where other pages have the
            sidebar trigger, so between md and lg the left cell is too narrow
            for logo + search pill and the pill runs under the centre buttons.
            The ⌘K shortcut still works while the pill is hidden. */}
        <SearchModal triggerClassName={isPosTerminal ? "md:hidden lg:flex" : undefined} />
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
          onValueChange={(loc) => void handleLocaleChange(loc as Locale)}
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

        {isAdmin && (
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-primary"
          >
            <Link
              // Straight to the first section: `/admin/settings` only
              // redirects there.
              href="/admin/settings/general"
              aria-label={t("common.settings")}
              title={t("common.settings")}
            >
              <Settings className="h-5 w-5" />
            </Link>
          </Button>
        )}

        {/* The viewer's own preferences, opened from the account menu;
            nothing in it is store-wide. */}
        <PreferencesDrawer locale={locale} showTrigger={false} />

        {/* The account menu lives in the sidebar's foot; the POS terminal
            has no sidebar, so it keeps one here. */}
        {isPosTerminal && (
          <HeaderAccountMenu
            locale={locale}
            user={user}
            links={[
              { href: "/admin/profile", label: t("adminProfile.title"), Icon: UserRound },
              ...(isAdmin
                ? [
                    // Straight to the first section: `/admin/settings` only
                    // redirects there.
                    { href: "/admin/settings/general", label: t("common.settings"), Icon: Settings },
                  ]
                : []),
            ]}
          />
        )}
      </div>
    </header>
  );
}
