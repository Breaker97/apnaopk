import { Suspense } from "react";
import { connectDB } from "@/lib/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { buildLoginUrl, returnPathFromHeaders } from "@/lib/auth/return-path";
import { Conversation } from "@/models";
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
import { getAccountOverview } from "@/lib/customers/account-overview";
import { storeCreditSummary } from "@/lib/store-credit/store-credit";
import { localeHref } from "@/lib/i18n/locale-routing";

interface PageProps {
  params: Promise<{ locale: string }>;
}

async function getCustomerStats(userId: string) {
  await connectDB();

  const [profile, notificationsCount, inboxUnreadCount] =
    await Promise.all([
      // Shared with the account layout's sidebar stats within one request.
      getAccountProfile(userId),
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
    wishlistCount: profile?.stats?.totalWishlistItems ?? 0,
    totalSpent: profile?.stats?.totalSpent ?? 0,
    loyaltyPoints: profile?.loyaltyPoints ?? 0,
    loyaltyTier: profile?.loyaltyTier ?? "bronze",
    memberSince: profile?.createdAt?.toISOString(),
    notificationsCount,
    inboxUnreadCount,
  };
}

async function getStoreCredit(userId: string) {
  await connectDB();

  // A figure on a card, not the page: if the read fails the card says none.
  return storeCreditSummary(userId)
    .then((rows) => rows.map(({ currency, balance }) => ({ currency, balance })))
    .catch((error) => {
      console.error("Failed to load store credit:", error);
      return [];
    });
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
  const [stats, overview, pendingReviews, storeCredit] = await Promise.all([
    getCustomerStats(user.id),
    getAccountOverview(user.id),
    getPendingReviews(user.id),
    getStoreCredit(user.id),
  ]);

  return (
    <CustomerDashboard
      locale={locale}
      user={{ name: user.name, email: user.email, image: user.image }}
      stats={stats}
      storeCredit={storeCredit}
      attention={overview.attention}
      recentOrders={overview.recentOrders}
      pendingReviews={pendingReviews}
    />
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Stats skeleton. Mirrors the dashboard: a 2×2 card grid on phones and
          up to `xl`, one row of four from there. */}
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4 xl:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl xl:h-[92px]" />
        ))}
      </div>

      {/* Recent orders skeleton */}
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
