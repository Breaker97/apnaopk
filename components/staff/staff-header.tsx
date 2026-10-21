"use client";

import * as React from "react";
import Link from "@/components/language/link";
import { usePathname, useRouter } from "@/hooks/use-locale-navigation";
import { useTranslations } from "next-intl";
import {
  Globe,
  LayoutDashboard,
  ShoppingCart,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { HeaderAccountMenu } from "@/components/layout/account-menu";
import { locales, localeConfig, type Locale } from "@/config/i18n.config";
import { FlagIcon } from "@/components/ui/flag-icon";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PreferencesDrawer } from "@/components/layout/preferences-drawer";
import { NotificationDrawer } from "@/components/admin/notification-drawer";
import { cn } from "@/lib/utils";

interface StaffHeaderProps {
  user: {
    name: string;
    email: string;
    image?: string;
  };
  locale: Locale;
  posEnabled?: boolean;
}

export function StaffHeader({ user, locale, posEnabled }: StaffHeaderProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();

  const tf = React.useCallback(
    (key: string, fallback: string) => {
      const msg = t(key as never);
      return msg === key ? fallback : msg;
    },
    [t],
  );

  const basePath = React.useMemo(() => {
    const prefix = `/${locale}`;
    if (pathname?.startsWith(prefix)) {
      const stripped = pathname.slice(prefix.length);
      return stripped.length ? stripped : "/";
    }
    return pathname || "/";
  }, [pathname, locale]);

  const isPosTerminal = basePath === "/staff/pos";

  const handleLocaleChange = (newLocale: Locale) => {
    if (!pathname) return;
    const currentPrefix = `/${locale}`;
    const newPathname = pathname.startsWith(currentPrefix)
      ? pathname.replace(currentPrefix, `/${newLocale}`)
      : `/${newLocale}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
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
          keywords: `${cfg.name} ${loc}`,
          icon: <FlagIcon countryCode={cfg.countryCode} size={20} />,
        };
      }),
    [],
  );

  return (
    <header
      className={cn(
        "sticky top-0 z-40 grid h-16 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 backdrop-blur transition-[width,height] ease-linear sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
        isPosTerminal
          ? "bg-card"
          : "border-b bg-background/95 supports-[backdrop-filter]:bg-background/80",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="size-9" />
      </div>

      {/* Center quick actions */}
      <div className="hidden items-center justify-center gap-2 justify-self-center sm:flex">
        {isPosTerminal ? (
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-2"
            asChild
          >
            <Link href={`/${locale}/staff/dashboard`}>
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden sm:inline">
                {tf("common.backToDashboard", "Dashboard")}
              </span>
            </Link>
          </Button>
        ) : posEnabled ? (
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-2 border-primary/30 text-primary hover:bg-primary/5 dark:border-border dark:text-foreground dark:hover:bg-accent dark:hover:text-accent-foreground"
            asChild
          >
            <Link href={`/${locale}/staff/pos`}>
              <ShoppingCart className="h-4 w-4" />
              <span className="hidden sm:inline">POS</span>
            </Link>
          </Button>
        ) : null}
        <Button variant="outline" size="sm" className="rounded-xl gap-2" asChild>
          <Link href={`/${locale}`} target="_blank" rel="noopener noreferrer">
            <Globe className="h-4 w-4" />
            <span className="hidden sm:inline">
              {tf("admin.browseWebsite", "Browse Website")}
            </span>
          </Link>
        </Button>
      </div>

      <div className="flex min-w-0 items-center justify-end gap-2">
        <SearchableSelect
          options={languageOptions}
          value={locale}
          onValueChange={(loc) => handleLocaleChange(loc as Locale)}
          searchPlaceholder={tf("common.selectLanguage", "Select Language")}
          align="end"
          contentClassName="w-56 rounded-xl border-border/60 bg-popover/95 shadow-xl backdrop-blur"
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-primary"
              aria-label={tf("common.selectLanguage", "Select Language")}
            >
              <FlagIcon countryCode={currentLocaleConfig.countryCode} size={22} />
            </Button>
          }
        />

        {/* The bell, as admins and vendors have: staff alerts were written to
            it but there was nowhere to read them, nor to turn on push. */}
        <NotificationDrawer locale={locale} />

        {/* The viewer's own preferences, opened from the account menu;
            nothing in it is store-wide. Staff have no settings page, so
            no gear either. */}
        <PreferencesDrawer locale={locale} showTrigger={false} />

        {/* The account menu lives in the sidebar's foot; the POS terminal
            has no sidebar, so it keeps one here. */}
        {isPosTerminal && (
          <HeaderAccountMenu
            locale={locale}
            user={user}
            links={[
              { href: "/staff/profile", label: tf("common.profile", "Profile"), Icon: UserRound },
            ]}
          />
        )}
      </div>
    </header>
  );
}
