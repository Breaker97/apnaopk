"use client";

import { useMemo } from "react";
import Link from "next/link";
import { signOutAndReload } from "@/lib/auth/auth-client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useRouter, usePathname } from "next/navigation";
import {
  User,
  Settings,
  LogOut,
  Store,
  LayoutDashboard,
  Globe,
  ShoppingCart,
} from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { locales, localeConfig, type Locale } from "@/config/i18n.config";
import { FlagIcon } from "@/components/ui/flag-icon";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { NotificationDrawer } from "@/components/admin/notification-drawer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
}

export function VendorHeader({
  user,
  locale,
  storeName,
  storeLogo,
  posEnabled,
}: VendorHeaderProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const isPosTerminal = pathname?.startsWith(`/${locale}/vendor/pos`) ?? false;

  const handleLogout = async () => {
    await signOutAndReload(locale);
  };

  const handleLocaleChange = (newLocale: Locale) => {
    const newPathname = pathname.replace(`/${locale}`, `/${newLocale}`);
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

        {/* Theme only. The admin settings drawer used to sit here, but every
            control in it writes the store-wide appearance record through an
            admin-only endpoint: a vendor's changes 403'd, were swallowed, and
            were undone by the next page load. */}
        <ThemeToggle />

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
          <DropdownMenuContent align="end" className="w-56">
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
              <Link
                href={`/${locale}/vendor/settings?tab=account`}
                className="cursor-pointer"
              >
                <User className="mr-2 h-4 w-4" />
                <span>
                  {t("common.profile")}
                </span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href={`/${locale}/vendor/settings?tab=store`}
                className="cursor-pointer"
              >
                <Settings className="mr-2 h-4 w-4" />
                <span>
                  {t("common.settings")}
                </span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/${locale}`} className="cursor-pointer">
                <Store className="mr-2 h-4 w-4" />
                <span>{t("vendor.viewStore")}</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              className="text-destructive focus:text-destructive cursor-pointer"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>{t("auth.signOut")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
