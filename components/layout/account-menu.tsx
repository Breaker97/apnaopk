"use client";

import type * as React from "react";
import Link from "@/components/language/link";
import { useTranslations } from "next-intl";
import {
  Bell,
  ChevronsUpDown,
  LogOut,
  Moon,
  SlidersHorizontal,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { openNotificationDrawer } from "@/components/admin/notification-drawer";
import { openPreferencesDrawer } from "@/components/layout/preferences-drawer";
import { signOutAndReload } from "@/lib/auth/auth-client";
import { useAppTheme } from "@/providers/theme-provider";
import { cn } from "@/lib/utils";

export interface AccountMenuLink {
  href: string;
  label: string;
  Icon: LucideIcon;
}

interface AccountMenuUser {
  name: string;
  email: string;
  image?: string;
}

function initialsOf(name: string) {
  const letters = name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("");
  return (letters || "?").toUpperCase().slice(0, 2);
}

/**
 * What the account menu holds wherever it opens from: the address, the
 * light/dark switch (a personal preference, kept in this browser), the
 * person's own pages, their notifications and preferences, and Log out.
 */
function AccountMenuContent({
  locale,
  email,
  links,
  beforePanel,
  className,
  ...props
}: {
  locale: string;
  email: string;
  links: AccountMenuLink[];
  /** Runs before a drawer (notifications, preferences) opens from the menu. */
  beforePanel?: () => void;
} & React.ComponentProps<typeof DropdownMenuContent>) {
  const t = useTranslations();
  const { isDark, toggleTheme } = useAppTheme();
  const themeLabel = isDark
    ? t("common.switchToLightMode")
    : t("common.switchToDarkMode");

  return (
    <DropdownMenuContent
      collisionPadding={12}
      className={cn(
        "max-w-[calc(100vw-1.5rem)] rounded-xl border-border/60 bg-popover/95 shadow-xl backdrop-blur",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-xs text-muted-foreground">
            {t("admin.accountMenu.myAccount")}
          </p>
          <p className="truncate text-sm" title={email}>
            {email}
          </p>
        </div>
        {/* An item rather than a plain button, so the arrow keys reach it;
            selecting it keeps the menu open. */}
        <DropdownMenuItem
          aria-label={themeLabel}
          title={themeLabel}
          onSelect={(event) => {
            event.preventDefault();
            toggleTheme();
          }}
          className="size-9 shrink-0 justify-center rounded-lg border border-border/70 p-0"
        >
          {isDark ? <Moon /> : <Sun />}
        </DropdownMenuItem>
      </div>
      <DropdownMenuSeparator />
      {links.map(({ href, label, Icon }) => (
        <DropdownMenuItem key={href} asChild>
          <Link prefetch={false} href={href}>
            <Icon />
            <span>{label}</span>
          </Link>
        </DropdownMenuItem>
      ))}
      {/* Both open drawers every dashboard header mounts, the POS terminal's
          too: the bell's, and the viewer's own preferences. */}
      <DropdownMenuItem
        onSelect={() => {
          beforePanel?.();
          openNotificationDrawer();
        }}
      >
        <Bell />
        <span>{t("common.notifications")}</span>
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          beforePanel?.();
          openPreferencesDrawer();
        }}
      >
        <SlidersHorizontal />
        <span>{t("admin.preferences.title")}</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        onSelect={() => void signOutAndReload(locale)}
      >
        <LogOut />
        <span>{t("common.logout")}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

/**
 * The signed-in person at the foot of the admin, vendor and staff sidebars.
 * The menu opens upward, or beside the rail when the sidebar is collapsed to
 * icons.
 */
export function SidebarAccountMenu({
  locale,
  user,
  links,
  isApparent,
  isRTL,
  isIconCollapsed,
}: {
  locale: string;
  user: AccountMenuUser;
  /** The person's own pages for this area (profile, settings); may be empty. */
  links: AccountMenuLink[];
  isApparent: boolean;
  isRTL: boolean;
  isIconCollapsed: boolean;
}) {
  const t = useTranslations();
  const { isMobile, setOpenMobile } = useSidebar();
  const displayName = user.name || user.email;

  return (
    <SidebarMenu className="group-data-[collapsible=icon]:items-center">
      <SidebarMenuItem className="group-data-[collapsible=icon]:w-full">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              className={cn(
                "h-auto gap-3 rounded-lg px-2 py-2 group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-1.5 group-data-[collapsible=icon]:py-2.5!",
                isApparent
                  ? "text-white hover:bg-white/10 hover:text-white active:bg-white/15 active:text-white data-[state=open]:bg-white/15 data-[state=open]:hover:bg-white/15 data-[state=open]:hover:text-white"
                  : "text-foreground hover:bg-muted/60 data-[state=open]:bg-muted/70 data-[state=open]:hover:bg-muted/70 data-[state=open]:hover:text-foreground",
              )}
            >
              <Avatar
                className={cn(
                  "size-9 border",
                  isApparent ? "border-white/30" : "border-border",
                )}
              >
                <AvatarImage src={user.image} alt={displayName} />
                <AvatarFallback
                  className={cn(
                    "text-xs font-semibold",
                    isApparent && "bg-white/20 text-white",
                  )}
                >
                  {initialsOf(displayName)}
                </AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 flex-1 text-start leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate text-[13px] font-semibold">
                  {displayName}
                </span>
                <span
                  className={cn(
                    "truncate text-xs",
                    isApparent ? "text-white/70" : "text-muted-foreground",
                  )}
                >
                  {user.email}
                </span>
              </span>
              <ChevronsUpDown className="size-4! opacity-70 group-data-[collapsible=icon]:hidden" />
              <span
                className={cn(
                  "hidden text-[11px] leading-tight group-data-[collapsible=icon]:block",
                  isApparent ? "text-white" : "text-muted-foreground",
                )}
              >
                {t("common.account")}
              </span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <AccountMenuContent
            locale={locale}
            email={user.email}
            links={links}
            // On a phone this menu sits in the sidebar's drawer, and a panel
            // opened from it would stack on that drawer — so it closes first.
            beforePanel={isMobile ? () => setOpenMobile(false) : undefined}
            side={isIconCollapsed ? (isRTL ? "left" : "right") : "top"}
            align={isIconCollapsed ? "end" : "start"}
            sideOffset={8}
            className="w-(--radix-dropdown-menu-trigger-width) min-w-60"
          />
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/**
 * The same menu behind an avatar in a dashboard header — only on the POS
 * terminal, which shows no sidebar and would otherwise leave a cashier no
 * way to sign out.
 */
export function HeaderAccountMenu({
  locale,
  user,
  links,
}: {
  locale: string;
  user: AccountMenuUser;
  links: AccountMenuLink[];
}) {
  const t = useTranslations();
  const displayName = user.name || user.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-full border border-border p-1"
          aria-label={t("admin.accountMenu.myAccount")}
        >
          <Avatar className="h-full w-full">
            <AvatarImage src={user.image} alt={displayName} />
            <AvatarFallback>{initialsOf(displayName)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <AccountMenuContent
        locale={locale}
        email={user.email}
        links={links}
        align="end"
        sideOffset={10}
        className="w-60"
      />
    </DropdownMenu>
  );
}
