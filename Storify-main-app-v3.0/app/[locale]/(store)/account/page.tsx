import { Suspense } from "react";
import { connectDB } from "@/lib/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { buildLoginUrl, returnPathFromHeaders } from "@/lib/auth/return-path";
import { Conversation, Order } from "@/models";
import { CONVERSATION_STATUSES } from "@/models/conversation.model";
import { setRequestLocale } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";
import { CustomerDashboard } from "@/components/account/customer-dashboard";
import {
  countUnreadNotifications,
  getAccountProfile,
  getAccountSession,
} from "@/lib/customers/account-data";
import { listPendingReviews } from "@/lib/catalog/review-eligibility";
import { localeHref } from "@/lib/i18n/locale-routing";

interface PageProps {
  params: Promise<{ locale: string }>;
}

async function getCustomerStats(userId: string) {
  await connectDB();

  const [profile, pendingOrders, notificationsCount, inboxUnreadCount] =
    await Promise.all([
      // Shared with the account layout's sidebar stats within one request.
      getAccountProfile(userId),
      // Pending orders is a real-time transient status — keep as live query
      Order.countDocuments({
        customerId: userId,
        status: { $in: ["pending", "processing"] },
      }),
      // Unread badges for the mobile Activity menu — the same count the
      // layout shows in the sidebar, read once for both.
      countUnreadNotifications(userId),
      // Threads with a reply waiting, not total unread messages — "2" should
      // read as "two conversations to open".
      Conversation.countDocuments({
        customerUserId: userId,
        unreadForCustomer: { $gt: 0 },
        status: { $ne: CONVERSATION_STATUSES.SPAM },
      }),
    ]);

  return {
    totalOrders: profile?.stats?.totalOrders ?? 0,
    pendingOrders,
    wishlistCount: profile?.stats?.totalWishlistItems ?? 0,
    totalSpent: profile?.stats?.totalSpent ?? 0,
    loyaltyPoints: profile?.loyaltyPoints ?? 0,
    loyaltyTier: profile?.loyaltyTier ?? "bronze",
    memberSince: profile?.createdAt?.toISOString(),
    notificationsCount,
    inboxUnreadCount,
  };
}

async function getRecentOrders(userId: string) {
  await connectDB();

  const orders = await Order.find({ customerId: userId })
    .sort({ createdAt: -1 })
    .limit(3)
    .select("orderNumber status total createdAt")
    .lean();

  return orders.map((order) => ({
    _id: order._id.toString(),
    orderNumber: order.orderNumber,
    status: order.status,
    totalAmount: order.total,
    createdAt: order.createdAt.toISOString(),
  }));
}

async function getPendingReviews(userId: string) {
  await connectDB();

  // A prompt, not the page: if it fails, the overview renders without it.
  return listPendingReviews(userId).catch((error) => {
    console.error("Failed to load pending reviews:", error);
    return [];
  });
}

export default async function AccountPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const requestHeaders = await headers();
  // The layout asked the same question for this request; this is its answer.
  const session = await getAccountSession();

  // The layout redirects anonymous visitors, but Next renders a page in
  // parallel with its layout, so this still runs for a logged-out request.
  // Redirecting here too (instead of `session!`) keeps every anonymous hit on
  // /account from throwing a TypeError into the error log while the layout's
  // redirect wins the response.
  if (!session) {
    redirect(
      await localeHref(
        locale,
        buildLoginUrl(locale, returnPathFromHeaders(requestHeaders) ?? "/account"),
      ),
    );
  }
  const user = session.user;

  // The data is read inside the boundary, so the page streams its skeleton
  // straight away and the dashboard follows. (The boundary used to wrap a
  // component whose data had already been awaited above it, so its fallback
  // could never show.)
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <AccountOverview
        locale={locale}
        user={{
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image || undefined,
        }}
      />
    </Suspense>
  );
}

async function AccountOverview({
  locale,
  user,
}: {
  locale: string;
  user: { id: string; name: string; email: string; image?: string };
}) {
  const [stats, recentOrders, pendingReviews] = await Promise.all([
    getCustomerStats(user.id),
    getRecentOrders(user.id),
    getPendingReviews(user.id),
  ]);

  return (
    <CustomerDashboard
      locale={locale}
      user={{ name: user.name, email: user.email, image: user.image }}
      stats={stats}
      recentOrders={recentOrders}
      pendingReviews={pendingReviews}
    />
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      {/* Stats skeleton. Mirrors the dashboard: a 2×2 tile grid on phones,
          one row of four from `lg` up. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>

      {/* Recent orders skeleton */}
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}
