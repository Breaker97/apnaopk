import { connectDB } from "@/lib/db";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { type Locale } from "@/config/i18n.config";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { getSettings } from "@/models/settings.model";
import { VendorHeader } from "@/components/vendor/vendor-header";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { VendorApplicationStatus } from "@/components/vendor/vendor-application-status";
import { VendorPaymentReturnVerifier } from "@/components/vendor/vendor-payment-return-verifier";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/layout/dashboard-sidebar";
import { SidebarStateSync } from "@/components/layout/sidebar-state-sync";
import { EmailVerificationNotice } from "@/components/auth/email-verification-notice";
import { VendorSubscription } from "@/models";
import {
  VENDOR_BILLING_INTERVAL,
  VENDOR_SUBSCRIPTION_STATUS,
} from "@/config/app.config";
import { VendorBillingAlert } from "@/components/vendor/vendor-billing-alert";
import { VendorRenewalDueAlert } from "@/components/vendor/vendor-renewal-due-alert";
import { RENEWAL_REMINDER_WINDOW_MS } from "@/lib/vendors/vendor-subscription-payments";
import { VendorPlanChangeAlert } from "@/components/vendor/vendor-plan-change-alert";
import { VendorPaymentRequiredAlert } from "@/components/vendor/vendor-payment-required-alert";
import { VENDOR_SETUP_ACCESS_COOKIE } from "@/lib/vendors/vendor-payment-access";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function VendorLayout({ children, params }: LayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  // The dashboards translate on the client with the whole bundle; the
  // storefront provider above this layout carries only the storefront subset.
  const messages = await getMessages();

  await connectDB();
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) {
    redirect(`/${locale}`);
  }

  const {
    session,
    vendor,
    vendorPermissions,
    isApproved,
    hasDashboardAccess,
    accessMode,
    paymentApplication,
  } =
    await requireVendorAreaAccess({
      locale,
    });

  const vendorId = String(vendor._id || "");
  const setupAccessCookie = (await cookies()).get(
    VENDOR_SETUP_ACCESS_COOKIE,
  )?.value;
  const isSetupAccess = accessMode === "setup";
  const showPaymentGate =
    !hasDashboardAccess ||
    (isSetupAccess && setupAccessCookie !== vendorId);
  const payment = paymentApplication
    ? {
        status: paymentApplication.paymentStatus,
        dueAt: paymentApplication.paymentDueAt?.toISOString() ?? null,
        planName: paymentApplication.planSnapshot?.name ?? null,
        price: paymentApplication.planSnapshot?.price ?? null,
        currency: paymentApplication.planSnapshot?.currency ?? null,
        billingInterval:
          paymentApplication.planSnapshot?.billingInterval ?? null,
      }
    : null;

  if (showPaymentGate) {
    return (
      <NextIntlClientProvider messages={messages}>
        <>
          <VendorPaymentReturnVerifier locale={locale} />
          <VendorApplicationStatus
            status={vendor.status}
            storeName={vendor.storeName}
            locale={locale}
            payment={payment}
            canContinueToDashboard={isSetupAccess}
            setupAccessExpired={
              accessMode === "payment_only" &&
              Boolean(paymentApplication?.paymentDueAt)
            }
            trialEnded={Boolean(paymentApplication?.trialEndedAt)}
          />
        </>
      </NextIntlClientProvider>
    );
  }

  const canAccessPos = Boolean(
    settings.pos?.enabled &&
      settings.pos?.allowVendorSales &&
      vendorPermissions.includes(VENDOR_PERMISSIONS.ACCESS_POS),
  );
  // Matches the repo convention for "now" in a server component: `new Date()`
  // rather than `Date.now()`, which the purity lint rejects during render.
  const now = new Date();
  const renewalWindowEnd = new Date(now.getTime() + RENEWAL_REMINDER_WINDOW_MS);
  const billingSubscription = isApproved
    ? await VendorSubscription.findOne({
        vendorId,
        $or: [
          { status: VENDOR_SUBSCRIPTION_STATUS.PAST_DUE },
          {
            pendingChangeType: "upgrade",
            pendingChangeStatus: {
              $in: ["awaiting_vendor", "awaiting_payment"],
            },
          },
          // A live one-shot plan inside the renewal-reminder window. The
          // reminder email points the vendor at this dashboard, so the renew
          // control has to be here BEFORE the lapse, not only after it.
          {
            status: VENDOR_SUBSCRIPTION_STATUS.ACTIVE,
            occupiesActiveSlot: true,
            provider: { $ne: "stripe" },
            // Mid-handover to Stripe: a card is on file and charges the day
            // this period ends, so a "renew now" banner would be asking for
            // money that is already scheduled.
            stripeTakeoverSubscriptionId: null,
            "planSnapshot.billingInterval": { $ne: VENDOR_BILLING_INTERVAL.NONE },
            "planSnapshot.price": { $gt: 0 },
            currentPeriodEnd: { $gt: now, $lte: renewalWindowEnd },
          },
        ],
      })
        .select(
          "status provider gracePeriodEnd currentPeriodEnd pendingChangeStatus pendingPlanSnapshot.name",
        )
        .lean<{
          status?: string;
          provider?: string;
          gracePeriodEnd?: Date | null;
          currentPeriodEnd?: Date | null;
          pendingChangeStatus?: "awaiting_vendor" | "awaiting_payment" | null;
          pendingPlanSnapshot?: { name?: string } | null;
        } | null>()
    : null;

  // Get vendor store name
  let storeName: string | undefined;
  let storeLogo: string | undefined;
  try {
    storeName = vendor?.storeName;
    storeLogo = vendor?.logo;
  } catch (error) {
    console.error("Failed to fetch vendor info:", error);
  }

  return (
    <NextIntlClientProvider messages={messages}>
      <SidebarProvider>
        <VendorPaymentReturnVerifier locale={locale} />
        <SidebarStateSync />
        <DashboardSidebar
          locale={locale as Locale}
          user={{
            name: session.user.name,
            email: session.user.email,
            image: session.user.image || undefined,
            role: session.user.role as string,
          }}
          vendorPermissions={vendorPermissions}
        />
        <SidebarInset className="[--dashboard-header-height:5rem]">
          <VendorHeader
            user={{
              name: session.user.name,
              email: session.user.email,
              image: session.user.image || undefined,
            }}
            locale={locale as Locale}
            storeName={storeName}
            storeLogo={storeLogo}
            posEnabled={canAccessPos}
          />
          <main className="isolate flex-1 space-y-8 p-6 md:p-6">
            <EmailVerificationNotice
              email={session.user.email}
              status={session.user.emailVerificationStatus}
              locale={locale}
            />
            {isSetupAccess ? (
              <VendorPaymentRequiredAlert
                locale={locale}
                paymentDueAt={payment?.dueAt}
              />
            ) : null}
            {billingSubscription?.status ===
            VENDOR_SUBSCRIPTION_STATUS.PAST_DUE ? (
              <VendorBillingAlert
                locale={locale}
                provider={billingSubscription.provider ?? null}
                gracePeriodEnd={
                  billingSubscription.gracePeriodEnd?.toISOString() ?? null
                }
              />
            ) : null}
            {/* Re-check the branch that matched, not just "active with a period":
                the $or above also returns pending-upgrade rows, which are ACTIVE
                and have a period end — including Stripe ones, whose renewal this
                dialog cannot collect. */}
            {billingSubscription?.status === VENDOR_SUBSCRIPTION_STATUS.ACTIVE &&
            billingSubscription.provider !== "stripe" &&
            billingSubscription.currentPeriodEnd &&
            billingSubscription.currentPeriodEnd > now &&
            billingSubscription.currentPeriodEnd <= renewalWindowEnd ? (
              <VendorRenewalDueAlert
                locale={locale}
                currentPeriodEnd={billingSubscription.currentPeriodEnd.toISOString()}
              />
            ) : null}
            {billingSubscription?.pendingChangeStatus === "awaiting_vendor" ||
            billingSubscription?.pendingChangeStatus === "awaiting_payment" ? (
              <VendorPlanChangeAlert
                locale={locale}
                planName={billingSubscription.pendingPlanSnapshot?.name}
                status={billingSubscription.pendingChangeStatus}
              />
            ) : null}
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </NextIntlClientProvider>
  );
}
