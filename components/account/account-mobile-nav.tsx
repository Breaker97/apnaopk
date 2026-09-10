"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { ArrowLeft, Loader2, Pencil, Star } from "lucide-react";

import type { LoyaltyTier } from "@/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  dashboardLinks,
  settingsLinks,
  type AccountStats,
} from "./account-nav-links";
import { useAvatarUpload } from "./use-avatar-upload";

const tierColors: Record<LoyaltyTier, string> = {
  bronze:
    "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200",
  silver: "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-200",
  gold: "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-200",
  platinum:
    "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200",
};

interface AccountMobileNavProps {
  locale: string;
  stats?: AccountStats;
}

// Title lookup only — the strip names whichever section the visitor is in.
// Spans both sidebar groups so Preferences and Notifications resolve too
// (the old pill list stopped at seven sections and let them fall back to
// "Account").
const TITLE_SECTIONS = [...dashboardLinks, ...settingsLinks];

/**
 * Mobile chrome for the account area: a 48px sticky identity strip whose title
 * doubles as the page title, with a back arrow to the Overview on sub-pages.
 *
 * The Overview page is the account's navigation hub on phones — its stat tiles
 * and menu groups carry every destination — so this strip deliberately renders
 * no nav of its own. (It used to append a scrollable pill row, which made
 * three competing menus on one screen: pills, the Overview's settings list,
 * and the store bottom bar.) Lateral movement is back-then-tap.
 *
 * Hidden from `lg` up, where the sidebar takes over.
 */
export function AccountMobileNav({
  locale,
  stats = {},
}: AccountMobileNavProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const { user } = useAuth();
  const [avatar, fileInputRef] = useAvatarUpload(locale);

  const isOverview = pathname === `/${locale}/account`;

  const isActive = (href: string) => {
    const fullPath = `/${locale}${href}`;
    // Overview is the account root, so it would prefix-match every sub-page.
    if (href === "/account") return pathname === fullPath;
    return pathname === fullPath || pathname.startsWith(`${fullPath}/`);
  };

  const label = (section: (typeof TITLE_SECTIONS)[number]) =>
    "labelFallback" in section && section.labelFallback
      ? t.has(section.labelKey)
        ? t(section.labelKey)
        : section.labelFallback
      : t(section.labelKey);

  const activeSection = TITLE_SECTIONS.find((section) =>
    isActive(section.href),
  );

  // The strip's title carries the current section, which is why the pages no
  // longer render their own mobile heading. Deeper routes (an order detail,
  // 2FA setup) fall back to the section they live under, and anything outside
  // the known sections falls back to "Account".
  const stripTitle = isOverview
    ? t("common.overview")
    : activeSection
      ? label(activeSection)
      : t("common.account");

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  return (
    <div
      className="sticky top-[var(--storefront-header-height,0px)] z-30 -mx-4 mb-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden"
      data-testid="account-mobile-nav"
    >
      {/* Identity strip — doubles as the page title. `min-h` rather than a fixed
          height so the 44px touch targets inside cannot overflow the row and
          collide with the pills below. */}
      <div className="flex min-h-12 items-center gap-2.5 px-4 py-1">
        {!isOverview && (
          <Link
            href={`/${locale}/account`}
            // Not "Overview": the pill row already has a link by that name, and
            // two same-named links would be ambiguous to a screen reader.
            aria-label={t("common.back")}
            className="-ml-2 flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}

        {/* The profile form has no avatar field, so this stays the only way to
            change a photo on a phone — the card this strip replaced owned it. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={avatar.handleFileChange}
        />
        <button
          type="button"
          onClick={avatar.openPicker}
          disabled={avatar.isDisabled}
          title={t("account.changePhoto")}
          aria-label={t("account.changePhoto")}
          className="group relative flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Avatar className="h-8 w-8">
            <AvatarImage
              src={user?.image || undefined}
              alt={user?.name}
              referrerPolicy="no-referrer"
            />
            <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
              {user?.name ? getInitials(user.name) : "U"}
            </AvatarFallback>
          </Avatar>
          <span className="absolute right-0.5 bottom-0.5 flex h-4 w-4 items-center justify-center rounded-full border bg-background shadow-sm transition-colors group-hover:bg-muted">
            {avatar.isUploading ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <Pencil className="h-2.5 w-2.5" />
            )}
          </span>
        </button>

        <h1 className="min-w-0 flex-1 truncate text-base font-bold tracking-tight">
          {stripTitle}
        </h1>

        {stats.loyaltyTier && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
              tierColors[stats.loyaltyTier],
            )}
          >
            <Star className="h-2.5 w-2.5" />
            {t(`customerProfile.${stats.loyaltyTier}`)}
          </span>
        )}
      </div>
    </div>
  );
}
