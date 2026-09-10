import {
  Bell,
  Heart,
  LayoutDashboard,
  MapPin,
  MessageSquare,
  Package,
  Settings2,
  Shield,
  User,
} from "lucide-react";
import type { LoyaltyTier } from "@/types";

export interface AccountStats {
  ordersCount?: number;
  wishlistCount?: number;
  addressesCount?: number;
  notificationsCount?: number;
  loyaltyTier?: LoyaltyTier;
  loyaltyPoints?: number;
}

export interface AccountNavLink {
  labelKey: string;
  labelFallback?: string;
  href: string;
  icon: typeof LayoutDashboard;
  countKey?: keyof AccountStats;
}

export const dashboardLinks: AccountNavLink[] = [
  {
    labelKey: "common.overview",
    href: "/account",
    icon: LayoutDashboard,
  },
  {
    labelKey: "account.orders",
    href: "/account/orders",
    icon: Package,
    countKey: "ordersCount",
  },
  {
    labelKey: "common.notifications",
    href: "/account/notifications",
    icon: Bell,
    countKey: "notificationsCount",
  },
  {
    // `account.inbox` is a namespace object: t.has() reports true for it but
    // t() throws INSUFFICIENT_PATH, so the raw key was rendered in the sidebar.
    labelKey: "account.inbox.title",
    labelFallback: "Inbox",
    href: "/account/inbox",
    icon: MessageSquare,
  },
  {
    labelKey: "account.wishlist",
    href: "/account/wishlist",
    icon: Heart,
    countKey: "wishlistCount",
  },
];

export const settingsLinks: AccountNavLink[] = [
  {
    labelKey: "account.profile",
    href: "/account/profile",
    icon: User,
  },
  {
    labelKey: "customerProfile.preferences",
    href: "/account/preferences",
    icon: Settings2,
  },
  {
    labelKey: "account.addresses",
    href: "/account/addresses",
    icon: MapPin,
    countKey: "addressesCount",
  },
  {
    labelKey: "account.security",
    href: "/account/security",
    icon: Shield,
  },
];

