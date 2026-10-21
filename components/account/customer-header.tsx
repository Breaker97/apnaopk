"use client";

import Link from "@/components/language/link";
import { useTranslations } from "next-intl";
import { usePathname } from "@/hooks/use-locale-navigation";
import { Camera, Loader2, LogOut, User } from "lucide-react";
import type { DemoModeState } from "@/lib/demo-mode-shared";
import { useAuth } from "@/hooks/use-auth";
import { signOutAndReload } from "@/lib/auth/auth-client";
import type { Locale } from "@/config/i18n.config";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { NotificationDrawer } from "@/components/admin/notification-drawer";
import { PreferencesDrawer } from "@/components/layout/preferences-drawer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  dashboardLinks,
  settingsLinks,
  type AccountNavLink,
} from "./account-nav-links";
import { useAvatarUpload } from "./use-avatar-upload";

const TITLE_SECTIONS = [...dashboardLinks, ...settingsLinks];

const getInitials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

/**
 * The account area's top bar, laid out like the staff and admin headers: the
 * sidebar trigger, then notifications, preferences and the customer's own
 * menu (where the profile photo is changed). Below `lg` it also
 * names the current section, which the pages leave out of their own markup on
 * phones.
 */
export function CustomerHeader({
  locale,
  demoMode,
}: {
  locale: string;
  /** Server-resolved; the photo picker refuses uploads on the profile page in demo mode. */
  demoMode?: DemoModeState;
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const { user } = useAuth();
  const [avatar, fileInputRef] = useAvatarUpload(locale, demoMode);

  const label = (link: AccountNavLink) =>
    link.labelFallback && !t.has(link.labelKey)
      ? link.labelFallback
      : t(link.labelKey);

  const isActive = (href: string) => {
    const fullPath = `/${locale}${href}`;
    if (href === "/account") return pathname === fullPath;
    return pathname === fullPath || pathname.startsWith(`${fullPath}/`);
  };

  // Deeper routes (an order detail, 2FA setup) take the section they live
  // under; anything outside the known sections reads "Account".
  const activeSection = TITLE_SECTIONS.find((section) =>
    isActive(section.href),
  );
  const title = activeSection ? label(activeSection) : t("common.account");

  const name = user?.name || user?.email || "";

  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger className="size-9" />

      <h1 className="min-w-0 flex-1 truncate text-base font-semibold lg:hidden">
        {title}
      </h1>
      <div className="hidden flex-1 lg:block" />

      {/* The same bell the dashboards have: it reads the signed-in user's own
          notifications, so a customer sees theirs. */}
      <NotificationDrawer locale={locale as Locale} />

      {/* The viewer's own light/dark and sidebar preferences. No language
          picker here or in the drawer: the account stays in the language the
          store sets. */}
      <PreferencesDrawer locale={locale as Locale} showLanguage={false} />

      {/* Outside the menu, which unmounts its content once it closes. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={avatar.handleFileChange}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-full border border-border p-1"
            aria-label={t("common.account")}
          >
            <Avatar className="h-full w-full">
              <AvatarImage
                src={user?.image || undefined}
                alt={name}
                referrerPolicy="no-referrer"
              />
              <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                {name ? getInitials(name) : "U"}
              </AvatarFallback>
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
                {user?.name}
              </p>
              <p
                className="truncate text-xs leading-tight text-muted-foreground"
                title={user?.email}
              >
                {user?.email}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={`/${locale}/account/profile`} className="cursor-pointer">
              <User className="mr-2 h-4 w-4" />
              <span>{t("account.profile")}</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={avatar.openPicker}
            disabled={avatar.isUploading}
            className="cursor-pointer"
          >
            {avatar.isUploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Camera className="mr-2 h-4 w-4" />
            )}
            <span>{t("account.changePhoto")}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => signOutAndReload(locale)}
            className="cursor-pointer text-destructive focus:text-destructive"
          >
            <LogOut className="mr-2 h-4 w-4" />
            <span>{t("auth.signOut")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
