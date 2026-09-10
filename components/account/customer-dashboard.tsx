"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Package,
  ShoppingBag,
  ChevronRight,
  Clock,
  Heart,
  Star,
  DollarSign,
  Bell,
  LogOut,
  MapPin,
  MessageSquare,
  Settings2,
  Shield,
  User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { signOutAndReload } from "@/lib/auth/auth-client";
import { useCurrency } from "@/providers/currency-provider";
import type { LoyaltyTier } from "@/types";

interface CustomerDashboardProps {
  locale: string;
  user: {
    name: string;
    email: string;
    image?: string;
  };
  stats: {
    totalOrders: number;
    wishlistCount: number;
    pendingOrders: number;
    totalSpent?: number;
    loyaltyPoints?: number;
    loyaltyTier?: LoyaltyTier;
    memberSince?: string;
    notificationsCount?: number;
    inboxUnreadCount?: number;
  };
  recentOrders: Array<{
    _id: string;
    orderNumber: string;
    status: string;
    totalAmount: number;
    createdAt: string;
  }>;
}

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  processing: "bg-blue-100 text-blue-800",
  shipped: "bg-purple-100 text-purple-800",
  delivered: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

const tierColors: Record<LoyaltyTier, string> = {
  bronze: "bg-orange-100 text-orange-800 border-orange-300",
  silver: "bg-gray-100 text-gray-700 border-gray-300",
  gold: "bg-yellow-100 text-yellow-800 border-yellow-300",
  platinum: "bg-violet-100 text-violet-800 border-violet-300",
};

// Statuses where the shopper is still waiting on something. These promote the
// newest such order into the hero line at the top of the mobile overview.
const IN_FLIGHT_STATUSES = new Set([
  "pending",
  "processing",
  "shipped",
  "out_for_delivery",
]);

export function CustomerDashboard({
  locale,
  stats,
  recentOrders,
}: CustomerDashboardProps) {
  const t = useTranslations();
  const { formatPrice } = useCurrency();
  const hasRecentOrders = recentOrders.length > 0;

  // The single most common reason a shopper opens this page is "where is my
  // order" — so on phones that answer leads, above the counters.
  const inFlightOrder = recentOrders.find((order) =>
    IN_FLIGHT_STATUSES.has(order.status),
  );

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const handleLogout = async () => {
    await signOutAndReload(locale);
  };

  // On phones this page is the account's whole map (the pill row is gone), so
  // each destination gets exactly one home: the stat tiles carry Orders and
  // Wishlist, and everything else lands in these two groups. "Activity" is the
  // pair a shopper checks (with their unread counts); "Settings" is
  // configuration only — no more Profile living in two lists at once.
  const activityLinks = [
    {
      href: "/account/inbox",
      icon: MessageSquare,
      // Same fallback as the sidebar: `account.inbox` is a namespace object,
      // so only the .title leaf is safe to translate.
      label: t.has("account.inbox.title") ? t("account.inbox.title") : "Inbox",
      count: stats.inboxUnreadCount ?? 0,
    },
    {
      href: "/account/notifications",
      icon: Bell,
      label: t("common.notifications"),
      count: stats.notificationsCount ?? 0,
    },
  ];
  const settingsMenuLinks = [
    { href: "/account/profile", icon: User, label: t("account.profile") },
    {
      href: "/account/addresses",
      icon: MapPin,
      label: t("account.addresses"),
    },
    { href: "/account/security", icon: Shield, label: t("account.security") },
    {
      href: "/account/preferences",
      icon: Settings2,
      label: t("customerProfile.preferences"),
    },
  ];
  const activityLabel = t.has("common.activity")
    ? t("common.activity")
    : "Activity";

  // A tile without an href (Total Spent) is a plain read-out — every other
  // number doubles as the shortcut to its page, which is why Orders and
  // Wishlist need no row in the menus below.
  const statTiles = [
    {
      key: "orders",
      icon: ShoppingBag,
      value: String(stats.totalOrders),
      label: t("account.totalOrders"),
      href: `/${locale}/account/orders`,
    },
    {
      key: "spent",
      icon: DollarSign,
      value: formatPrice(stats.totalSpent ?? 0),
      label: t("customerProfile.totalSpent"),
    },
    {
      key: "pending",
      icon: Clock,
      value: String(stats.pendingOrders),
      label: t("account.pendingOrders"),
      href: `/${locale}/account/orders`,
    },
    {
      key: "wishlist",
      icon: Heart,
      value: String(stats.wishlistCount),
      label: t("account.wishlistItems"),
      href: `/${locale}/account/wishlist`,
    },
  ];
  // One shell for every tile at every width — see the grid below.
  const statTileShell =
    "flex items-start justify-between gap-2 rounded-xl border bg-card p-3 shadow-sm lg:p-5";

  return (
    <div className="space-y-6">
      {/* Page Header — desktop only; the mobile identity strip carries the title
          and the loyalty tier badge. */}
      <div className="hidden items-center justify-between lg:flex">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">
            {t("common.overview")}
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            {t("account.overviewDesc")}
          </p>
        </div>
        {stats.loyaltyTier && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={tierColors[stats.loyaltyTier]}>
              <Star className="h-3 w-3 mr-1" />
              {t(`customerProfile.${stats.loyaltyTier}`)}
            </Badge>
            {typeof stats.loyaltyPoints === "number" && (
              <span className="text-sm text-muted-foreground">
                {stats.loyaltyPoints.toLocaleString(locale)}{" "}
                {t("customerProfile.loyaltyPoints")}
              </span>
            )}
          </div>
        )}
      </div>

      {/* In-flight order — the lead answer on phones. */}
      {inFlightOrder && (
        <Link
          href={`/${locale}/account/orders/${inFlightOrder._id}`}
          className="flex min-h-[72px] items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 transition-colors hover:bg-primary/10 lg:hidden"
        >
          <div className="rounded-lg bg-background p-2.5">
            <Package className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
              {t("orders.trackOrder")}
            </p>
            <p className="truncate text-sm font-semibold">
              #{inFlightOrder.orderNumber}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {formatDate(inFlightOrder.createdAt)} ·{" "}
              {formatPrice(inFlightOrder.totalAmount)}
            </p>
          </div>
          <Badge
            variant="secondary"
            className={`shrink-0 ${statusColors[inFlightOrder.status] || ""}`}
          >
            {inFlightOrder.status}
          </Badge>
        </Link>
      )}

      {/* Stat tiles — one design at every width, 2×2 on phones and a row of
          four from `lg`. The number leads, its label captions it, and a single
          muted icon sits top-right the way the admin dashboard cards do: no
          tinted pills, no per-tile colour. Tiles with an href are the page's
          shortcuts, which is why Orders and Wishlist need no row in the menus
          below. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {statTiles.map((tile) => {
          const Icon = tile.icon;
          const inner = (
            <>
              {/* Formatted currency can be a long non-breaking string, so the
                  wrapper needs a constrained width — `min-w-0` alone leaves
                  the intrinsic width intact and the value overflows. */}
              <div className="min-w-0">
                <p className="break-words text-lg font-bold leading-tight tabular-nums lg:text-2xl">
                  {tile.value}
                </p>
                <p className="mt-1 break-words text-xs text-muted-foreground lg:text-sm">
                  {tile.label}
                </p>
              </div>
              <Icon className="size-5 shrink-0 text-muted-foreground" />
            </>
          );
          return tile.href ? (
            <Link
              key={tile.key}
              href={tile.href}
              className={`${statTileShell} transition-colors hover:bg-muted/50 active:bg-muted/50`}
            >
              {inner}
            </Link>
          ) : (
            <div key={tile.key} className={statTileShell}>
              {inner}
            </div>
          );
        })}
      </div>

      {/* Recent Orders */}
      <Card
        className={
          hasRecentOrders
            ? "border-0 bg-transparent py-0 shadow-none sm:border sm:bg-card sm:py-6 sm:shadow-sm"
            : undefined
        }
      >
        <CardHeader
          className={`flex flex-row items-center justify-between${hasRecentOrders ? " px-0 sm:px-6" : ""}`}
        >
          <CardTitle>{t("account.recentOrders")}</CardTitle>
          <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" asChild>
            <Link href={`/${locale}/account/orders`}>
              {t("common.viewAll")}
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className={hasRecentOrders ? "px-0 sm:px-6" : undefined}>
          {recentOrders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>{t("account.noOrders")}</p>
              <Button variant="outline" className="mt-4" asChild>
                <Link href={`/${locale}/products`}>
                  {t("account.startShopping")}
                </Link>
              </Button>
            </div>
          ) : (
            <div className="divide-y overflow-hidden rounded-lg border sm:space-y-4 sm:divide-y-0 sm:overflow-visible sm:rounded-none sm:border-0">
              {recentOrders.map((order) => (
                <Link
                  key={order._id}
                  href={`/${locale}/account/orders/${order._id}`}
                  className="block"
                >
                  <div className="flex min-h-[72px] items-center justify-between gap-3 px-3 py-3 transition-colors hover:bg-muted/50 sm:min-h-0 sm:gap-4 sm:rounded-lg sm:border sm:p-4">
                    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                      <div className="rounded-lg bg-muted p-1.5 sm:p-2">
                        <Package className="h-4 w-4 text-muted-foreground sm:h-5 sm:w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium sm:text-base">
                          #{order.orderNumber}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs text-muted-foreground sm:text-sm">
                            {formatDate(order.createdAt)}
                          </p>
                          <Badge
                            variant="secondary"
                            className={`px-1.5 text-[10px] sm:hidden ${statusColors[order.status] || ""}`}
                          >
                            {order.status}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 sm:gap-4">
                      <Badge
                        variant="secondary"
                        className={`hidden sm:inline-flex ${statusColors[order.status] || ""}`}
                      >
                        {order.status}
                      </Badge>
                      <span className="shrink-0 whitespace-nowrap text-sm font-semibold sm:text-base">
                        {formatPrice(order.totalAmount)}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground sm:h-5 sm:w-5" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mobile menus. Activity holds the two rows a shopper checks, with
          their unread counts; Settings holds configuration only. Sign out gets
          its own card at the end so the destructive row can't be mis-tapped as
          part of a list. */}
      <div className="space-y-5 lg:hidden">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {activityLabel}
          </p>
          <div className="divide-y overflow-hidden rounded-lg border bg-card">
            {activityLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={`/${locale}${link.href}`}
                  className="flex min-h-11 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50"
                >
                  <span className="rounded-md bg-primary/10 p-1.5 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {link.label}
                  </span>
                  {link.count > 0 && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-primary">
                      {link.count > 99 ? "99+" : link.count}
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {t("common.settings")}
          </p>
          <div className="divide-y overflow-hidden rounded-lg border bg-card">
            {settingsMenuLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={`/${locale}${link.href}`}
                  className="flex min-h-11 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50"
                >
                  <span className="rounded-md bg-primary/10 p-1.5 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {link.label}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              );
            })}
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border bg-card">
          <button
            type="button"
            onClick={handleLogout}
            className="flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
          >
            <span className="rounded-md bg-destructive/10 p-1.5 text-destructive">
              <LogOut className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-destructive">
              {t("auth.signOut")}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
