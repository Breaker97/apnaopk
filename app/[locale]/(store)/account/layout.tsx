import { ObjectId } from "mongodb";
import { mongoose } from "@/lib/db";
import { connectDB } from "@/lib/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { SidebarStateSync } from "@/components/layout/sidebar-state-sync";
import { CustomerSidebar } from "@/components/account/customer-sidebar";
import { CustomerHeader } from "@/components/account/customer-header";
import {
  countUnreadNotifications,
  getAccountProfile,
  getAccountSession,
} from "@/lib/customers/account-data";
import { StaffProfile } from "@/models";
import { USER_ROLES } from "@/config/app.config";
import { isStaffRole } from "@/lib/access/staff-role";
import { getRoleDashboardPath } from "@/lib/access/role-dashboard";
import { EmailVerificationNotice } from "@/components/auth/email-verification-notice";
import { RouteMessages } from "@/components/language/route-messages";
import { buildLoginUrl, returnPathFromHeaders } from "@/lib/auth/return-path";
import { localeHref } from "@/lib/i18n/locale-routing";
import { isDemoModeEnabled, PROFILE_DEMO_MODE_MESSAGE } from "@/lib/demo-mode";
import { ResourceScope } from "@/hooks/use-suspense-resource";

// Canonical, hreflang and robots from the URL being served.
export { generateMetadata } from "@/lib/storefront/request-path-metadata";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

async function getAccountStats(userId: string) {
  await connectDB();

  const [profile, user, notificationsCount] = await Promise.all([
    getAccountProfile(userId),
    mongoose.connection.db
      ?.collection("user")
      .findOne({ _id: new ObjectId(userId) }),
    countUnreadNotifications(userId),
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
  const session = await getAccountSession();

  if (!session) {
    // Send the visitor back to the exact account page (with its query — the
    // inbox arrives with product/vendor chat context) they were heading for.
    redirect(
      await localeHref(
        locale,
        buildLoginUrl(locale, returnPathFromHeaders(requestHeaders) ?? "/account"),
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
        redirect(await localeHref(locale, "/"));
      }
    }
    redirect(await localeHref(locale, dashboardPath));
  }
  if (session.user.role && session.user.role !== USER_ROLES.CUSTOMER) {
    // A future non-customer role without a dashboard mapping still stays out.
    redirect(await localeHref(locale, "/"));
  }

  // Fetch stats for sidebar
  const stats = await getAccountStats(session.user.id);
  // The avatar pickers refuse uploads in demo mode. The flag is the server's
  // env, so it is handed down here rather than asked of /api/user/profile by
  // each picker on every visit to the profile page.
  const demoMode = {
    enabled: isDemoModeEnabled(),
    message: PROFILE_DEMO_MODE_MESSAGE,
  };

  return (
    // Orders, addresses and the account's own screens: the three namespaces
    // the rest of the storefront does without.
    <RouteMessages namespaces={["account", "orders", "checkout"]}>
      {/* Pages below keep what they fetched for this user between visits (see
          useSuspenseResource), keyed by the id this session was authorised as. */}
      <ResourceScope owner={session.user.id}>
        {/* The theme's global `--radius` (1rem) makes every card here read as a
            20px-round bubble. The account area wants a tighter, more utilitarian
            surface, so it scopes the token down once: because `@theme inline`
            inlines `calc(var(--radius) ± n)` into every `rounded-*` utility, this
            single override reshapes cards, tiles, inputs and buttons throughout
            the subtree in one place — no per-card class to keep in sync. */}
        {/* The account is drawn like the admin, vendor and staff dashboards:
            a sidebar and a top bar of its own. `data-account-segment` is what
            the store layout keys on to hide its header, footer and bottom
            bar here, so the shop's chrome never sits above this one. */}
        {/* Lines are drawn at half the theme's border colour: a theme's border
            is picked for the shop (Furniture's is a dark taupe), and on a
            dashboard full of cards, rails and dividers it read too heavy.
            Two steps, because --border cannot be defined from itself on one
            element: the outer box mixes the inherited colour, the inner one
            hands it to everything below. */}
        <div
          data-account-segment=""
          className="[--account-line:color-mix(in_oklab,var(--border)_50%,transparent)] [--dashboard-header-height:4rem] [--radius:0.5rem]"
        >
          <div className="[--border:var(--account-line)]">
            <SidebarProvider>
              <SidebarStateSync />
              <CustomerSidebar locale={locale} stats={stats} />
              <SidebarInset>
                <CustomerHeader locale={locale} demoMode={demoMode} />
                <main className="isolate flex-1 min-w-0 space-y-6 overflow-x-clip p-4 md:p-6">
                  <EmailVerificationNotice
                    email={session.user.email}
                    status={session.user.emailVerificationStatus}
                    locale={locale}
                  />
                  {children}
                </main>
              </SidebarInset>
            </SidebarProvider>
          </div>
        </div>
      </ResourceScope>
    </RouteMessages>
  );
}
