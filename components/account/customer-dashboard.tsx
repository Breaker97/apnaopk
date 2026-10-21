"use client";

import { LOYALTY_CLASSES, ORDER_STATUS_CLASSES } from "@/lib/theme-colors/status";

import Link from "@/components/language/link";
import { useTranslations } from "next-intl";
import {
  Package,
  ShoppingBag,
  ChevronRight,
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
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { signOutAndReload } from "@/lib/auth/auth-client";
import { useCurrency } from "@/providers/currency-provider";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { formatCurrency } from "@/lib/intl/money";
import { resolveCurrency } from "@/lib/intl/currencies";
import { cn } from "@/lib/utils";
import type { LoyaltyTier } from "@/types";
import { isLoyaltyEnabled } from "@/lib/customers/loyalty";
import type { PendingReview } from "@/lib/catalog/review-eligibility";
import {
  EMPTY_ATTENTION,
  type OverviewAttention,
  type OverviewOrder,
} from "@/lib/customers/overview-attention";
import {
  AttentionCard,
  ProductThumb,
  orderStatusLabel,
  productTitle,
} from "./overview-attention";

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
    totalSpent?: number;
    loyaltyPoints?: number;
    loyaltyTier?: LoyaltyTier;
    memberSince?: string;
    notificationsCount?: number;
    inboxUnreadCount?: number;
  };
  /** The shopper's store credit, one entry per currency they hold. */
  storeCredit?: Array<{ currency: string; balance: number }>;
  /** What waits on the shopper; see `lib/customers/overview-attention.ts`. */
  attention?: OverviewAttention;
  /** The latest orders the attention card is not already showing. */
  recentOrders: OverviewOrder[];
  /** Delivered products still waiting for the shopper's review. */
  pendingReviews?: PendingReview[];
}

const tierColors: Record<LoyaltyTier,string> = LOYALTY_CLASSES;

/** What a stat card is made of; a card with an href is the shortcut to its page. */
interface StatCard {
  key: string;
  icon: LucideIcon;
  value: string;
  label: string;
  href?: string;
}

const statCardClassName =
  "flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm xl:gap-4 xl:p-5";

export function CustomerDashboard({
  locale,
  user,
  stats,
  storeCredit = [],
  attention = EMPTY_ATTENTION,
  recentOrders,
  pendingReviews = [],
}: CustomerDashboardProps) {
  const t = useTranslations();
  const tf = useFallbackTranslator(t);
  const { currency, formatPrice } = useCurrency();
  const plusMore = (count: number) =>
    tf("account.overview.plusMore", "+{count} more", { count });

  const firstName =
    user.name?.trim().split(/\s+/)[0] || user.email.split("@")[0] || "";

  // The orders the attention card already carries must not read as "no
  // orders" when it is all that is left of the list below it.
  const hasAttentionOrder = Boolean(
    attention.addressHold || attention.payment || attention.inFlight,
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

  // Credit is held per currency and never converted. The store's own currency
  // leads; credit left in another one still shows rather than reading as none.
  const storeCurrency = String(currency?.code ?? "").toUpperCase();
  const heldCredit =
    storeCredit.find(
      (entry) =>
        entry.balance > 0 && entry.currency.toUpperCase() === storeCurrency,
    ) ?? storeCredit.find((entry) => entry.balance > 0);
  const creditValue = heldCredit
    ? heldCredit.currency.toUpperCase() === storeCurrency
      ? formatPrice(heldCredit.balance)
      : formatCurrency(
          heldCredit.balance,
          heldCredit.currency,
          resolveCurrency(heldCredit.currency).locale,
        )
    : formatPrice(0);

  // On phones this page is the account's whole map (the pill row is gone), so
  // each destination gets exactly one home: the stat cards carry Orders,
  // Wishlist and Store credit, and everything else lands in these two groups.
  // "Activity" is the pair a shopper checks (with their unread counts);
  // "Settings" is configuration only — no more Profile living in two lists at
  // once.
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

  // A card without an href (Total Spent) is a plain read-out — every other
  // number doubles as the shortcut to its page, which is why Orders, Wishlist
  // and Store credit need no row in the menus below. The count of orders still
  // on their way is not a card any more: the order itself is in the attention
  // card above.
  const statCards: StatCard[] = [
    {
      key: "orders",
      icon: ShoppingBag,
      value: String(stats.totalOrders),
      label: t("account.totalOrders"),
      href: "/account/orders",
    },
    {
      key: "spent",
      icon: DollarSign,
      value: formatPrice(stats.totalSpent ?? 0),
      label: t("customerProfile.totalSpent"),
    },
    {
      key: "wishlist",
      icon: Heart,
      value: String(stats.wishlistCount),
      label: t("account.wishlistItems"),
      href: "/account/wishlist",
    },
    {
      key: "credit",
      icon: Wallet,
      value: creditValue,
      label: tf("account.storeCredit", "Store credit"),
      href: "/account/store-credit",
    },
  ];

  return (
    // Like Preferences, a column rather than the full width: on a wide screen
    // a list row stretched edge to edge leaves its name and its price a
    // thousand pixels apart.
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Page Header — desktop only; the top bar carries the title on phones. */}
      <div className="hidden items-center justify-between lg:flex">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">
            {t("account.welcome", { name: firstName })}
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            {t("account.overviewDesc")}
          </p>
        </div>
        {/* Hidden with the rest of loyalty (see `isLoyaltyEnabled`). */}
        {isLoyaltyEnabled() && stats.loyaltyTier && (
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

      {/* Only what waits on the shopper — and not on the page at all when
          nothing does. "Where is my order" is the most common reason this page
          is opened, so the order on its way is in it at every width. */}
      <AttentionCard
        locale={locale}
        attention={attention}
        pendingReviews={pendingReviews}
      />

      {/* Stat cards — one design at every width: 2×2 until `xl`, where the
          column is wide enough for four. The icon sits in the brand tint (the
          chip the phone menus below use), the number leads and its label
          captions it. */}
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4 xl:gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          const inner = (
            <>
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-store-link xl:size-11">
                <Icon className="size-4 xl:size-5" aria-hidden />
              </div>
              {/* Formatted currency can be a long non-breaking string, so the
                  wrapper needs a constrained width — `min-w-0` alone leaves
                  the intrinsic width intact and the value overflows. */}
              <div className="min-w-0 flex-1">
                <p className="break-words text-lg font-bold leading-6 tabular-nums xl:text-2xl xl:leading-8">
                  {card.value}
                </p>
                <p className="break-words text-xs text-muted-foreground xl:text-[13px]">
                  {card.label}
                </p>
              </div>
            </>
          );
          return card.href ? (
            <Link
              key={card.key}
              href={card.href}
              className={cn(
                statCardClassName,
                "transition-colors hover:bg-muted/50 active:bg-muted/50",
              )}
            >
              {inner}
            </Link>
          ) : (
            <div key={card.key} className={statCardClassName}>
              {inner}
            </div>
          );
        })}
      </div>

      {/* Recent Orders. Not asked about twice: an order the attention card
          shows is left out, so a shopper whose only order is in it has no list
          here — which is not the same as having no orders. */}
      {recentOrders.length > 0 || !hasAttentionOrder ? (
        <section aria-labelledby="recent-orders-title">
          <div className="mb-1 flex items-center justify-between sm:mb-3">
            <h2 id="recent-orders-title" className="text-base font-semibold">
              {t("account.recentOrders")}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              className="-mr-2 min-h-11 sm:mr-0 sm:min-h-8"
              asChild
            >
              <Link href="/account/orders">
                {t("common.viewAll")}
                <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
          {recentOrders.length === 0 ? (
            <div className="rounded-xl border bg-card py-8 text-center text-muted-foreground shadow-sm">
              <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>{t("account.noOrders")}</p>
              <Button variant="outline" className="mt-4" asChild>
                <Link href="/products">{t("account.startShopping")}</Link>
              </Button>
            </div>
          ) : (
            <div className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
              {recentOrders.map((order) => (
                <Link
                  key={order._id}
                  href={`/account/orders/${order._id}`}
                  className="flex min-h-[72px] items-center gap-3 px-3 py-3 transition-colors hover:bg-muted/50 sm:gap-4 sm:px-5 sm:py-3.5"
                >
                  <ProductThumb product={order.product} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-5">
                      {productTitle(
                        order.product,
                        order.orderNumber,
                        order.moreItems,
                        plusMore,
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground sm:text-[13px] sm:leading-[18px]">
                      #{order.orderNumber} · {formatDate(order.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5 sm:flex-row sm:items-center sm:gap-4">
                    {/* Delivered is the normal case, so it is a quiet word;
                        the status that needs a look gets the badge. */}
                    {order.status === "delivered" ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground sm:text-[13px]">
                        <span
                          className="size-1.5 rounded-full bg-status-on-positive"
                          aria-hidden
                        />
                        {orderStatusLabel(t, order.status)}
                      </span>
                    ) : (
                      <Badge
                        variant="secondary"
                        className={ORDER_STATUS_CLASSES[order.status]}
                      >
                        {orderStatusLabel(t, order.status)}
                      </Badge>
                    )}
                    <span className="whitespace-nowrap text-sm font-semibold tabular-nums max-sm:order-first sm:w-24 sm:text-right">
                      {formatPrice(order.totalAmount)}
                    </span>
                  </div>
                  <ChevronRight
                    className="hidden size-4 shrink-0 text-muted-foreground sm:block"
                    aria-hidden
                  />
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}

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
                  href={`${link.href}`}
                  className="flex min-h-11 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50"
                >
                  <span className="rounded-md bg-primary/10 p-1.5 text-store-link">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {link.label}
                  </span>
                  {link.count > 0 && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-store-link">
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
                  href={`${link.href}`}
                  className="flex min-h-11 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50"
                >
                  <span className="rounded-md bg-primary/10 p-1.5 text-store-link">
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
