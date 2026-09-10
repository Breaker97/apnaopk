import { auth } from "@/lib/auth/auth";
import { ObjectId } from "mongodb";
import { mongoose } from "@/lib/db";
import { connectDB } from "@/lib/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccountSidebar } from "@/components/account/account-sidebar";
import { AccountMobileNav } from "@/components/account/account-mobile-nav";
import { AccountBreadcrumb } from "@/components/account/account-breadcrumb";
import { ensureCustomerProfile } from "@/lib/customers/customer";
import { Notification, StaffProfile } from "@/models";
import { USER_ROLES } from "@/config/app.config";
import { isStaffRole } from "@/lib/access/staff-role";
import { getRoleDashboardPath } from "@/lib/access/role-dashboard";
import { EmailVerificationNotice } from "@/components/auth/email-verification-notice";
import { buildLoginUrl, returnPathFromHeaders } from "@/lib/auth/return-path";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

async function getAccountStats(userId: string) {
  await connectDB();

  const [profile, user, notificationsCount] = await Promise.all([
    ensureCustomerProfile(userId),
    mongoose.connection.db
      ?.collection("user")
      .findOne({ _id: new ObjectId(userId) }),
    Notification.countDocuments({
      userId,
      isRead: false,
      isArchived: { $ne: true },
    }),
  ]);

  return {
    ordersCount: profile?.stats?.totalOrders ?? 0,
    wishlistCount: profile?.stats?.totalWishlistItems ?? 0,
    addressesCount: user?.addresses?.length || 0,
    notificationsCount,
    loyaltyTier: profile?.loyaltyTier ?? "bronze",
    loyaltyPoints: profile?.loyaltyPoints ?? 0,
  };
}

export default async function AccountLayout({ children, params }: LayoutProps) {
  const { locale } = await params;

  // Check authentication
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session) {
    // Send the visitor back to the exact account page (with its query — the
    // inbox arrives with product/vendor chat context) they were heading for.
    redirect(
      buildLoginUrl(
        locale,
        returnPathFromHeaders(requestHeaders) ?? `/${locale}/account`,
      ),
    );
  }

  // The account area is customer-only. Every staff-side role has its own
  // dashboard; letting them in here would silently create a customer profile
  // for them (getAccountStats → ensureCustomerProfile below).
  const dashboardPath = getRoleDashboardPath(locale, session.user.role);
  if (dashboardPath) {
    if (isStaffRole(session.user.role)) {
      // Deactivated staff keep their role but lose their StaffProfile (or its
      // isActive flag) — the staff area would bounce them to /forbidden. Send
      // them home instead of chaining every /account URL into a 403.
      await connectDB();
      const activeStaff = await StaffProfile.exists({
        userId: session.user.id,
        isActive: true,
      });
      if (!activeStaff) {
        redirect(`/${locale}`);
      }
    }
    redirect(dashboardPath);
  }
  if (session.user.role && session.user.role !== USER_ROLES.CUSTOMER) {
    // A future non-customer role without a dashboard mapping still stays out.
    redirect(`/${locale}`);
  }

  // Fetch stats for sidebar
  const stats = await getAccountStats(session.user.id);

  return (
    // The theme's global `--radius` (1rem) makes every card here read as a
    // 20px-round bubble. The account area wants a tighter, more utilitarian
    // surface, so it scopes the token down once: because `@theme inline` inlines
    // `calc(var(--radius) ± n)` into every `rounded-*` utility, this single
    // override reshapes cards, tiles, inputs and buttons throughout the subtree
    // in one place — no per-card class to keep in sync.
    <div className="container mx-auto px-4 pb-8 lg:py-8 [--dashboard-header-height:var(--storefront-header-height,4rem)] [--radius:0.5rem]">
      {/* Mobile chrome: sticky identity strip + section pills. Renders here (not
          per page) so it stays put while the content below it scrolls, and so
          every page inherits the same nav without repeating a back link. */}
      <AccountMobileNav locale={locale} stats={stats} />

      {/* Desktop only: on phones the sticky strip above already names the
          section and carries the way back, so a second trail under it would be
          the same navigation twice. */}
      <AccountBreadcrumb locale={locale} className="hidden lg:block" />

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar */}
        <AccountSidebar locale={locale} stats={stats} />

        {/* Main Content */}
        <div className="flex-1 min-w-0 space-y-6">
          <EmailVerificationNotice
            email={session.user.email}
            status={session.user.emailVerificationStatus}
            locale={locale}
          />
          {children}
        </div>
      </div>
    </div>
  );
}
