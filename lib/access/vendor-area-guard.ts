import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { USER_ACCOUNT_STATUS, USER_ROLES, VENDOR_STATUS } from "@/config/app.config";
import { connectDB } from "@/lib/db";
import { User, Vendor, VendorApplication, VendorPlan } from "@/models";
import { getSettings } from "@/models/settings.model";
import type { VendorPermission } from "@/config/permissions.config";
import {
  VENDOR_ACCESS_FIELDS,
  primaryDenial,
  resolveVendorAccess,
  vendorLockedPath,
  type VendorAccessOverride,
  type VendorAccessPlan,
  type VendorAccessResolution,
} from "@/lib/vendors/vendor-permissions";
import {
  resolveVendorPaymentAccess,
  type VendorPaymentAccessMode,
} from "@/lib/vendors/vendor-payment-access";
import { buildLoginUrl, returnPathFromHeaders } from "@/lib/auth/return-path";
import { ensureVendorOwnerRole } from "@/lib/access/user-role";
import {
  VENDOR_APPLICATION_LATEST_SORT,
  vendorApplicationLookupQuery,
} from "@/lib/vendors/vendor-application";

interface VendorPaymentApplicationSummary {
  status?: string;
  paymentStatus?: string;
  paymentDueAt?: Date | null;
  /** Set when a paid plan's free trial lapsed unpaid — the payment gate says
   * "your trial ended", not "your setup window ended". */
  trialEndedAt?: Date | null;
  planSnapshot?: {
    name?: string;
    price?: number;
    currency?: string;
    billingInterval?: string;
  } | null;
}

type VendorAreaAccess = {
  session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
  vendor: {
    _id?: unknown;
    userId?: unknown;
    storeName?: string;
    logo?: string;
    status?: string;
    isDefault?: boolean;
    planId?: unknown;
    permissions?: VendorPermission[];
    permissionOverrides?: VendorAccessOverride[];
  };
  /** Effective permissions — policy ∩ entitlement ± overrides ∩ lifecycle. */
  vendorPermissions: VendorPermission[];
  /**
   * The full four-layer resolution, so a page can render partial UI (and say
   * WHY something is missing) instead of only knowing that it is.
   */
  access: VendorAccessResolution | null;
  isApproved: boolean;
  hasDashboardAccess: boolean;
  accessMode: VendorPaymentAccessMode;
  paymentApplication: VendorPaymentApplicationSummary | null;
};

export async function requireVendorAreaAccess(params: {
  locale: string;
  required?: VendorPermission[];
  mode?: "any" | "all";
}): Promise<VendorAreaAccess> {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    redirect(
      buildLoginUrl(
        params.locale,
        returnPathFromHeaders(requestHeaders) ??
          `/${params.locale}/vendor/dashboard`,
      ),
    );
  }

  if (session.user.role === USER_ROLES.ADMIN) {
    redirect(`/${params.locale}/admin/dashboard`);
  }

  await connectDB();
  const [vendor, user, settings] = await Promise.all([
    Vendor.findOne({ userId: session.user.id })
      .select(`${VENDOR_ACCESS_FIELDS} storeName logo`)
      .lean<VendorAreaAccess["vendor"] | null>(),
    User.findById(session.user.id).select("status").lean(),
    getSettings(),
  ]);

  const userStatus = (user as { status?: string } | null)?.status;
  if (userStatus && userStatus !== USER_ACCOUNT_STATUS.ACTIVE) {
    redirect(`/${params.locale}/forbidden`);
  }

  if (!vendor) {
    redirect(`/${params.locale}/become-vendor`);
  }

  const paymentApplication =
    vendor.status === VENDOR_STATUS.PAYMENT_REQUIRED
      ? await VendorApplication.findOne(
          vendorApplicationLookupQuery({
            vendorId: String(vendor._id),
            userId: session.user.id,
          }),
        )
          .sort(VENDOR_APPLICATION_LATEST_SORT)
          .select(
            "status paymentStatus paymentDueAt trialEndedAt planSnapshot",
          )
          .lean<VendorPaymentApplicationSummary | null>()
      : null;
  const accessMode = resolveVendorPaymentAccess({
    vendorStatus: vendor.status,
    applicationStatus: paymentApplication?.status,
    paymentDueAt: paymentApplication?.paymentDueAt,
  });
  const isApproved = accessMode === "approved";
  const hasDashboardAccess =
    accessMode === "approved" || accessMode === "setup";

  // The plan is the entitlement layer. Loaded here, once, so the resolver and
  // every guard call on this request read the same thing.
  const plan = vendor.planId
    ? await VendorPlan.findById(vendor.planId)
        .select("capabilities")
        .lean<VendorAccessPlan | null>()
    : null;

  const access = resolveVendorAccess({
    vendor,
    plan,
    settings,
    accessMode: hasDashboardAccess
      ? accessMode === "setup"
        ? "setup"
        : "approved"
      : "blocked",
  });
  const vendorPermissions = Array.from(access.effective);

  if (!hasDashboardAccess) {
    // The vendor layout calls this with no `required` so it can render the
    // payment gate instead of a dashboard. A caller that did name permissions
    // is a real page, though, and must not get a "granted" result it would go
    // on to fetch data with — send it to the dashboard, where the same layout
    // shows why access is on hold.
    if (params.required?.length) {
      redirect(`/${params.locale}/vendor/dashboard`);
    }

    return {
      session,
      vendor,
      vendorPermissions: [],
      access,
      isApproved,
      hasDashboardAccess,
      accessMode,
      paymentApplication,
    };
  }

  if (session.user.role !== USER_ROLES.VENDOR) {
    // A live vendor record whose owner is not a vendor is drift, not a
    // trespasser. Suspending a store demotes its owner, and the billing
    // reactivation that follows restores only the vendor document — so the
    // merchant was sent to `/become-vendor`, which renders the signup wizard
    // for the store they already pay for, and `POST /api/vendor/apply` then
    // refuses it as a duplicate. There was no way out but a support ticket.
    //
    // Repaired here instead of redirected, and only for a vendor the payment
    // gate has already cleared — a blocked or unpaid store still falls through
    // to the redirect. Nothing is spent on the happy path: this runs solely on
    // the request that is already drifted.
    const repaired =
      hasDashboardAccess && (await ensureVendorOwnerRole(vendor.userId));
    if (!repaired) {
      redirect(`/${params.locale}/become-vendor`);
    }
    // The database now says vendor; this request is still holding the copy
    // that says customer, and callers read the role off the session they are
    // handed rather than re-reading it.
    session.user.role = USER_ROLES.VENDOR;
  }

  const required = params.required || [];
  if (required.length) {
    const mode = params.mode || "any";
    const ok =
      mode === "all"
        ? required.every((permission) => access.has(permission))
        : required.some((permission) => access.has(permission));

    // Not `/forbidden`. A permission miss has a reason and usually a next step
    // — upgrade the plan, ask the owner, finish the payment — and the gate page
    // reads them off the query. The redirect is kept (rather than returning a
    // typed denial) precisely because there are 31 call sites: a caller that
    // forgot to handle a new return value would fail OPEN.
    if (!ok) {
      redirect(vendorLockedPath(params.locale, primaryDenial(access, required)));
    }
  }

  return {
    session,
    vendor,
    vendorPermissions,
    access,
    isApproved,
    hasDashboardAccess,
    accessMode,
    paymentApplication,
  };
}
