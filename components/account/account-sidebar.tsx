"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, Pencil, Loader2, Star } from "lucide-react";
import type { LoyaltyTier } from "@/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { signOutAndReload } from "@/lib/auth/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  dashboardLinks,
  settingsLinks,
  type AccountNavLink,
  type AccountStats,
} from "./account-nav-links";
import { useAvatarUpload } from "./use-avatar-upload";

const tierColors: Record<LoyaltyTier, string> = {
  bronze:
    "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-500/20 dark:text-orange-200 dark:border-orange-500/30",
  silver:
    "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-500/20 dark:text-gray-200 dark:border-gray-500/30",
  gold: "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-500/20 dark:text-yellow-200 dark:border-yellow-500/30",
  platinum:
    "bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-500/20 dark:text-violet-200 dark:border-violet-500/30",
};

interface AccountSidebarProps {
  locale: string;
  stats?: AccountStats;
}

/**
 * Desktop-only account navigation. On phones and small tablets the layout
 * renders `AccountMobileNav` instead — a sticky identity strip plus a pill row —
 * so the sidebar is no longer stacked above the content it navigates to.
 */
export function AccountSidebar({ locale, stats = {} }: AccountSidebarProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const { user } = useAuth();
  const [liveStats, setLiveStats] = useState(stats);
  const [avatar, fileInputRef] = useAvatarUpload(locale);

  useEffect(() => {
    let isActive = true;

    const refresh = async () => {
      try {
        const res = await fetch("/api/user/account-stats");
        const json = await res.json().catch(() => null);
        if (!isActive) return;
        if (!res.ok || !json?.success) return;
        const nextStats = json?.data?.stats;
        if (nextStats) setLiveStats(nextStats);
      } catch {}
    };

    const onStatsChanged = () => {
      refresh();
    };

    refresh();
    window.addEventListener(
      "account:stats-changed",
      onStatsChanged as EventListener,
    );

    return () => {
      isActive = false;
      window.removeEventListener(
        "account:stats-changed",
        onStatsChanged as EventListener,
      );
    };
  }, []);

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const isActive = (href: string) => {
    const fullPath = `/${locale}${href}`;
    // Exact match for /account (Overview), prefix match for sub-pages
    if (href === "/account") {
      return pathname === fullPath;
    }
    return pathname === fullPath || pathname.startsWith(`${fullPath}/`);
  };

  const handleLogout = async () => {
    await signOutAndReload(locale);
  };

  const renderLink = (link: AccountNavLink) => {
    const Icon = link.icon;
    const count = link.countKey && liveStats[link.countKey];

    return (
      <Link
        key={link.href}
        href={`/${locale}${link.href}`}
        className={cn(
          "flex items-center justify-between px-3 py-1.5 rounded-button text-sm font-medium transition-colors",
          isActive(link.href)
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <div className="flex items-center gap-3">
          <Icon className="h-4 w-4" />
          <span>
            {link.labelFallback
              ? t.has(link.labelKey)
                ? t(link.labelKey)
                : link.labelFallback
              : t(link.labelKey)}
          </span>
        </div>
        {typeof count === "number" && count > 0 && (
          <Badge
            variant={isActive(link.href) ? "secondary" : "outline"}
            className="ml-auto"
          >
            {count}
          </Badge>
        )}
      </Link>
    );
  };

  return (
    <div className="hidden lg:block lg:w-64 lg:shrink-0">
      <div className="bg-card sticky top-[calc(var(--storefront-header-height,5rem)+1rem)] max-h-[calc(100vh-var(--storefront-header-height,5rem)-2rem)] overflow-y-auto rounded-lg border p-4">
        {/* User Info */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative shrink-0">
            <Avatar className="h-12 w-12">
              <AvatarImage
                src={user?.image || undefined}
                alt={user?.name}
                referrerPolicy="no-referrer"
              />
              <AvatarFallback className="text-base font-semibold bg-primary text-primary-foreground">
                {user?.name ? getInitials(user.name) : "U"}
              </AvatarFallback>
            </Avatar>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={avatar.handleFileChange}
            />
            <button
              onClick={avatar.openPicker}
              disabled={avatar.isDisabled}
              className="absolute -right-1 -bottom-1 p-1 rounded-full bg-background border shadow-sm hover:bg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              title={t("account.changePhoto")}
            >
              {avatar.isUploading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Pencil className="h-3 w-3" />
              )}
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm truncate">
              {user?.name || "Guest"}
            </h3>
            <p className="text-xs text-muted-foreground truncate">
              {user?.email}
            </p>
            {liveStats.loyaltyTier && (
              <Badge
                variant="outline"
                className={cn(
                  "mt-1 px-1.5 py-0 text-[10px]",
                  tierColors[liveStats.loyaltyTier],
                )}
              >
                <Star className="h-2.5 w-2.5 mr-1" />
                {t(`customerProfile.${liveStats.loyaltyTier}`)}
              </Badge>
            )}
          </div>
        </div>

        <Separator className="mb-3" />

        {/* Dashboard Section */}
        <div className="mb-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-2">
            {t("common.dashboard")}
          </p>
          <nav className="space-y-1">{dashboardLinks.map(renderLink)}</nav>
        </div>

        {/* Account Settings Section */}
        <div className="mb-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-2">
            {t("admin.settings.title")}
          </p>
          <nav className="space-y-1">{settingsLinks.map(renderLink)}</nav>
        </div>

        <Separator className="mb-3" />

        {/* Logout Button */}
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-3 text-muted-foreground hover:text-destructive hover:border-destructive"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4" />
          {t("auth.signOut")}
        </Button>
      </div>
    </div>
  );
}
