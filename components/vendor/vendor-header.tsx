"use client";

import { useMemo } from "react";
import Link from "@/components/language/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useRouter, usePathname } from "@/hooks/use-locale-navigation";
import {
  UserRound,
  Settings,
  Store,
  LayoutDashboard,
  Globe,
  ShoppingCart,
} from "lucide-react";
import { PreferencesDrawer } from "@/components/layout/preferences-drawer";
import { locales, localeConfig, type Locale } from "@/config/i18n.config";
import { FlagIcon } from "@/components/ui/flag-icon";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { NotificationDrawer } from "@/components/admin/notification-drawer";
import { HeaderAccountMenu } from "@/components/layout/account-menu";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";

interface VendorHeaderProps {
  user: {
    name: string;
    email: string;
    image?: string;
  };
  locale: Locale;
  storeName?: string;
  storeLogo?: string;
  posEnabled?: boolean;
  /** The vendor (or their staff member) may open the store's settings page. */
  canOpenSettings?: boolean;
}

export function VendorHeader({
  user,
  locale,
  storeName,
  storeLogo,
  posEnabled,
  canOpenSettings = false,
}: VendorHeaderProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const isPosTerminal = pathname?.startsWith(`/${locale}/vendor/pos`) ?? false;
  // The till itself, which alone has no sidebar (its sub-pages have one).
  const isPosTill = pathname === `/${locale}/vendor/pos`;

  const handleLocaleChange = (newLocale: Locale) => {
    const newPathname = pathname.replace(`/${locale}`, `/${newLocale}`);
    router.push(newPathname);
  };

  const currentLocaleConfig = localeConfig[locale];

  const languageOptions = useMemo(
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
          : "bg-background/50"
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {isPosTerminal ? (
          <Link
            href={`/${locale}/vendor/dashboard`}
            className="flex items-center gap-2 shrink-0 mr-1"
            aria-label={
              typeof storeName === "string" && storeName.trim()
                ? storeName
                : DEFAULT_STORE_NAME
            }
          >
            {typeof storeLogo === "string" && storeLogo.trim() ? (
              <span className="relative block h-8 w-32 overflow-hidden">
                <AppImage
                  src={storeLogo}
                  alt={`${storeName || "Store"} logo`}
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
          <>
            <SidebarTrigger className="size-9" />
            {storeName && (
              <div className="flex items-center gap-2 ml-2">
                <Store className="h-5 w-5 text-primary" />
                <span className="font-semibold text-lg hidden sm:block">
                  {storeName}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <div className="hidden items-center justify-center gap-2 justify-self-center sm:flex">
        {isPosTerminal ? (
          <Button variant="outline" size="sm" className="rounded-xl gap-2" asChild>
            <Link href={`/${locale}/vendor/dashboard`}>
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden sm:inline">
                {t("common.backToDashboard")}
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
            <Link href={`/${locale}/vendor/pos`}>
              <ShoppingCart className="h-4 w-4" />
              <span className="hidden sm:inline">POS</span>
            </Link>
          </Button>
        ) : null}
        <Button variant="outline" size="sm" className="rounded-xl gap-2" asChild>
          <Link href={`/${locale}`} target="_blank" rel="noopener noreferrer">
            <Globe className="h-4 w-4" />
            <span className="hidden sm:inline">
              {t("admin.browseWebsite")}
            </span>
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

        {canOpenSettings && (
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-primary"
          >
            <Link
              href="/vendor/settings"
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

        {/* The account menu lives in the sidebar's foot; the till has no
            sidebar, so it keeps one here. */}
        {isPosTill && (
          <HeaderAccountMenu
            locale={locale}
            user={user}
            links={[
              { href: "/vendor/settings?tab=account", label: t("common.profile"), Icon: UserRound },
              { href: "/vendor/settings?tab=store", label: t("common.settings"), Icon: Settings },
            ]}
          />
        )}
      </div>
    </header>
  );
}
