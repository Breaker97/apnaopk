import {
  Product,
  User,
  Vendor,
  VendorApplication,
  VendorPlan,
  VendorSubscription,
  VendorSubscriptionPayment,
} from "@/models";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { releaseBoostInventoryForVendor } from "@/lib/boosts/boosts";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { requestEmailVerification } from "@/lib/auth/auth";
import { defaultLocale } from "@/config/i18n.config";
import {
  USER_ACCOUNT_STATUS,
  BOOST_CANCEL_REASON,
  USER_ROLES,
  COD_COLLECTED_BY,
  COD_COLLECTED_BY_INHERIT,
  VENDOR_APPLICATION_PAYMENT_STATUS,
  VENDOR_APPLICATION_STATUS,
  VENDOR_BILLING_INTERVAL,
  VENDOR_PAYMENT_INVITATION,
  VENDOR_STATUS,
  VENDOR_SUBSCRIPTION_STATUS,
} from "@/config/app.config";
import {
  ALL_VENDOR_PACKS,
  ALL_VENDOR_PERMISSIONS,
  COMMISSION_ONLY_PACKS,
  type VendorPermission,
} from "@/config/permissions.config";
import {
  plansInForce,
  resolveVendorAccess,
  resolveVendorLifecycleMode,
  type VendorAccessOverride,
  type VendorAccessPlan,
  type VendorAccessSubject,
} from "@/lib/vendors/vendor-permissions";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import {
  addressGeocodeKey,
  geocodeAddress,
  resolveCoordinates,
} from "@/lib/intl/geocoding";
import { vendorGeoPoint } from "@/lib/locations/vendor-geo";
import { syncInheritedLocationGeo } from "@/lib/locations/location-geo";
import { ensureVendorOwnerRole, revokeVendorRole } from "@/lib/access/user-role";
import { isStaffRole } from "@/lib/access/staff-role";
import { getSettings } from "@/models/settings.model";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import {
  DEFAULT_VENDOR_SLUG,
  isDefaultVendorRecord,
  syncDefaultVendorWithSettings,
} from "@/lib/vendors/multi-vendor";
import {
  createAuditContext,
  auditDelete,
  auditVendorDecision,
  auditUpdate,
} from "@/lib/audit";
import { getEffectiveSubscription } from "@/lib/vendors/vendor-plans";
import { findLatestVendorApplication } from "@/lib/vendors/vendor-application";
import { isVendorDocumentReference } from "@/lib/vendors/vendor-documents";
import {
  sendVendorApplicationRejectedEmail,
  sendVendorApprovedEmail,
  sendVendorPaymentRequiredEmail,
} from "@/lib/email/vendor-emails";
import { notifyVendorApplicationStatus } from "@/lib/notifications/notifications";
import { normalizeNotificationSettings } from "@/lib/notifications/notification-settings";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import { withApi } from "@/lib/api/handler";
import { cancelVendorApplicationBilling } from "@/lib/vendors/vendor-stripe-billing";
import { assertStripeBillingReady } from "@/lib/vendors/vendor-plan-stripe";
import { assertVendorBillingReady } from "@/lib/vendors/vendor-billing-providers";
import { trialWindow } from "@/lib/vendors/vendor-subscriptions";
import { getStripeForSecretKey } from "@/lib/payments/stripe";
import { retrieveVendorBillingSnapshot } from "@/lib/vendors/vendor-stripe-adapter";
import {
  assertVendorBillingTerminalForDeletion,
  retireVendorBillingRecords,
} from "@/lib/vendors/vendor-billing-deletion";
import {
  areCountryValuesEquivalent,
  isCountryAllowed,
} from "@/lib/intl/country-availability";
import { z } from "zod";

interface StoredVendorOverride {
  permission: VendorPermission;
  mode: "grant" | "revoke";
  reason?: string;
  grantedBy: string;
  grantedAt: Date;
  expiresAt: Date | null;
}

/** Two overrides describe the same decision when nothing an admin chose moved. */
function sameDecision(
  a: StoredVendorOverride,
  b: VendorAccessOverride | undefined,
): boolean {
  if (!b) return false;
  const aExpiry = a.expiresAt ? new Date(a.expiresAt).getTime() : null;
  const bExpiry = b.expiresAt ? new Date(b.expiresAt).getTime() : null;
  return (
    a.mode === b.mode &&
    (a.reason ?? "") === (b.reason?.trim() ?? "") &&
    aExpiry === bExpiry
  );
}

/**
 * Sanitize the override list an admin submitted.
 *
 * Authorship is server-side: a client that could set `grantedBy` itself would
 * make the audit trail worthless, which is the one thing overrides exist to
 * provide. A row whose `expiresAt` is already past is dropped rather than
 * stored, so a stale form cannot resurrect access that had lapsed.
 *
 * But authorship is only re-stamped when the DECISION actually changed. This
 * endpoint saves the whole vendor form, so an admin editing a store name posts
 * every existing override back unchanged — blindly stamping each one would
 * rewrite who granted a months-old exception, and to the wrong person. An
 * untouched row therefore keeps its original `grantedBy`/`grantedAt`.
 */
function sanitizeVendorOverrides(
  input: unknown,
  actorUserId: string,
  existing: VendorAccessOverride[] = [],
): StoredVendorOverride[] {
  if (!Array.isArray(input)) return [];
  const now = new Date();
  const previous = new Map<VendorPermission, VendorAccessOverride>(
    existing.map((override) => [override.permission, override]),
  );
  const byPermission = new Map<VendorPermission, StoredVendorOverride>();

  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const permission = row.permission;
    if (
      typeof permission !== "string" ||
      !ALL_VENDOR_PERMISSIONS.includes(permission as VendorPermission)
    ) {
      continue;
    }
    const mode = row.mode === "revoke" ? "revoke" : row.mode === "grant" ? "grant" : null;
    if (!mode) continue;

    let expiresAt: Date | null = null;
    if (row.expiresAt) {
      const parsed = new Date(String(row.expiresAt));
      if (Number.isNaN(parsed.getTime())) {
        throw new ValidationError("Override expiry is not a valid date");
      }
      if (parsed.getTime() <= now.getTime()) continue;
      expiresAt = parsed;
    }

    const reason =
      typeof row.reason === "string" && row.reason.trim()
        ? row.reason.trim().slice(0, 500)
        : undefined;

    const candidate: StoredVendorOverride = {
      permission: permission as VendorPermission,
      mode,
      reason,
      grantedBy: actorUserId,
      grantedAt: now,
      expiresAt,
    };

    const prior = previous.get(candidate.permission);
    if (sameDecision(candidate, prior)) {
      candidate.grantedBy = prior?.grantedBy || actorUserId;
      candidate.grantedAt = prior?.grantedAt
        ? new Date(prior.grantedAt)
        : now;
    }

    byPermission.set(candidate.permission, candidate);
  }

  return Array.from(byPermission.values());
}

/**
 * Comparable form of the override set for the audit diff.
 *
 * Sorted and flattened to strings so `auditUpdate` reports "this permission
 * moved" rather than "the array changed", and so a save that touched nothing
 * still writes nothing.
 */
function overridesAuditValue(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const expiry = row.expiresAt
        ? new Date(String(row.expiresAt)).toISOString()
        : "never";
      return `${String(row.permission)}:${String(row.mode)}:${expiry}`;
    })
    .sort();
}

/**
 * Keep an identifier auditable without storing it.
 *
 * Bank and tax numbers must show up in the change log — "who moved the payout
 * account" is exactly what an audit trail is for — but the log is a long-lived,
 * broadly-readable table, so only enough to recognise a value is retained.
 */
function maskIdentifier(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length <= 4 ? "••••" : `••••${text.slice(-4)}`;
}

interface VendorAuditSubject {
  status?: unknown;
  verified?: unknown;
  commission?: unknown;
  storeName?: unknown;
  slug?: unknown;
  description?: unknown;
  logo?: unknown;
  banner?: unknown;
  notes?: unknown;
  permissionOverrides?: unknown;
  address?: Record<string, unknown> | null;
  bankDetails?: Record<string, unknown> | null;
  documents?: Record<string, unknown> | null;
}

/**
 * Comparable snapshot of everything this endpoint can change.
 *
 * `auditUpdate` diffs the two snapshots and skips writing when nothing moved,
 * so this can be built unconditionally. Derived address fields (coordinates,
 * geo) are left out: they follow the address rather than being edited, and
 * including them would report a change on every re-geocode.
 */
function vendorAuditSnapshot(
  vendor: VendorAuditSubject,
  owner: { name?: unknown; email?: unknown; phone?: unknown; status?: unknown },
): Record<string, unknown> {
  const address = (vendor.address ?? {}) as Record<string, unknown>;
  const bank = (vendor.bankDetails ?? {}) as Record<string, unknown>;
  const documents = (vendor.documents ?? {}) as Record<string, unknown>;
  // Access deviations, not the legacy grant list. "Who gave this vendor POS,
  // and when" is only answerable from the change log if the log records the
  // field the decision is actually stored in.
  const permissionOverrides = overridesAuditValue(vendor.permissionOverrides);

  return {
    status: vendor.status ?? "",
    // Who awarded or withdrew the storefront badge, and when, is exactly the
    // kind of decision the change log exists for.
    verified: vendor.verified === true,
    commission: Number(vendor.commission ?? 0),
    storeName: vendor.storeName ?? "",
    slug: vendor.slug ?? "",
    description: vendor.description ?? "",
    logo: vendor.logo ?? "",
    banner: vendor.banner ?? "",
    notes: vendor.notes ?? "",
    permissionOverrides,
    address: {
      street: address.street ?? "",
      city: address.city ?? "",
      state: address.state ?? "",
      postalCode: address.postalCode ?? "",
      country: address.country ?? "",
      phone: address.phone ?? "",
    },
    bankDetails: {
      accountName: bank.accountName ?? "",
      accountNumber: maskIdentifier(bank.accountNumber),
      bankName: bank.bankName ?? "",
      routingNumber: maskIdentifier(bank.routingNumber),
      swiftCode: bank.swiftCode ?? "",
    },
    documents: {
      businessLicense: documents.businessLicense ?? "",
      taxId: maskIdentifier(documents.taxId),
      taxCertificate: documents.taxCertificate ?? "",
      governmentId: documents.governmentId ?? "",
    },
    ownerName: owner.name ?? "",
    ownerEmail: owner.email ?? "",
    ownerPhone: owner.phone ?? "",
    ownerStatus: owner.status ?? "",
  };
}

async function assertCanChangeVendorOwnerRole(userId: unknown) {
  const owner = await User.findById(userId).select("role roles").lean();
  const roles = Array.isArray((owner as { roles?: unknown } | null)?.roles)
    ? ((owner as { roles?: string[] }).roles || [])
    : [];
  const role = (owner as { role?: string } | null)?.role;

  if (
    role === USER_ROLES.ADMIN ||
    isStaffRole(role) ||
    roles.includes(USER_ROLES.ADMIN) ||
    roles.some(isStaffRole)
  ) {
    throw new ValidationError(
      "Admin and staff accounts cannot be converted through vendor updates",
    );
  }
}

// Shape check for the admin vendor editor. The nested documents (address,
// bank details, documents, commission, permission overrides) keep their own
// normalisers below; every status transition is validated there too.
const AdminVendorUpdateSchema = z.object({
  status: z.string().max(40).optional(),
  userStatus: z.string().max(40).optional(),
  storeName: z.string().max(200).optional(),
  slug: z.string().max(120).optional(),
  ownerName: z.string().max(200).optional(),
  ownerEmail: z.string().max(320).optional(),
  ownerPhone: z.string().max(50).optional(),
  description: z.string().max(5000).optional(),
  logo: z.string().max(2048).optional(),
  banner: z.string().max(2048).optional(),
  notes: z.string().max(5000).optional(),
  rejectionReason: z.string().max(1000).optional(),
  verified: z.boolean().optional(),
  codCollectedBy: z.string().max(40).optional(),
  address: z.any().optional(),
  bankDetails: z.any().optional(),
  documents: z.any().optional(),
  commission: z.any().optional(),
  permissionOverrides: z.any().optional(),
});

/**
 * GET /api/admin/vendors/[id]
 * Get single vendor
 */
export const GET = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ params, session }) => {
    const { id } = params;

    if (!isValidObjectId(id)) {
      return notFoundResponse("Vendor");
    }

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    await syncDefaultVendorWithSettings(session.user.id, settings);

    // Lazily reconcile an expired trial/period before reading the vendor, so the
    // returned commission and subscription status are current.
    const effective = settings.vendorConfig?.plansEnabled
      ? await getEffectiveSubscription(id, { settings })
      : { subscription: null, status: null };
    const latestSubscription = settings.vendorConfig?.plansEnabled
      ? await VendorSubscription.findOne({ vendorId: id })
          .sort({ createdAt: -1 })
          .lean<
            | (Record<string, unknown> & {
                _id?: unknown;
                status?: string;
                pendingChangeStatus?: string | null;
              })
            | null
          >()
      : null;
    const subscription =
      latestSubscription &&
      (latestSubscription.status === "incomplete" ||
        latestSubscription.pendingChangeStatus)
        ? latestSubscription
        : effective.subscription || latestSubscription;
    const lastSubscriptionPayment = subscription?._id
      ? await VendorSubscriptionPayment.findOne({
          subscriptionId: subscription._id,
        })
          .sort({ providerCreatedAt: -1, createdAt: -1 })
          .lean<Record<string, unknown> | null>()
      : null;

    const vendor = await Vendor.findById(id)
      .populate("user", "name email image phone status")
      .lean();

    if (!vendor) {
      return notFoundResponse("Vendor");
    }
    if (isDefaultVendorRecord(vendor)) {
      return notFoundResponse("Vendor");
    }

    // The review record, for the Status card: the reason an admin gave when
    // rejecting, editable there without a second status change.
    const latestApplication = await findLatestVendorApplication({
      vendorId: vendor._id,
      userId: vendor.userId,
    })
      .select("status rejectionReason rejectedAt")
      .lean<{
        status?: string;
        rejectionReason?: string | null;
        rejectedAt?: Date | null;
      } | null>();

    // Resolve access server-side and ship the layers the Access tab cannot
    // edit (policy, entitlement) alongside the overrides it can. Sending the
    // resolution rather than the raw flags is what keeps the grid from
    // disagreeing with the guards — the failure the old two-table setup had.
    const accessPlan = vendor.planId
      ? await VendorPlan.findById(vendor.planId)
          .select("name capabilities")
          .lean<({ name?: string } & VendorAccessPlan) | null>()
      : null;
    const accessSubject = vendor as unknown as VendorAccessSubject;
    const vendorAccessMode = await resolveVendorLifecycleMode(accessSubject);
    const access = resolveVendorAccess({
      vendor: accessSubject,
      plan: accessPlan,
      settings,
      // Resolved the same way the vendor's own guard resolves it, so the tab
      // does not show a setup-window vendor as holding packs the lifecycle
      // layer is currently withholding.
      accessMode: vendorAccessMode,
    });
    const plansOn = plansInForce(settings);
    const entitledCount = access.entitledPacks.length;

    return successResponse({
      ...vendor,
      subscription: subscription
        ? {
            ...subscription,
            lastPayment: lastSubscriptionPayment,
          }
        : null,
      subscriptionStatus:
        String(subscription?.status || effective.status || "") || null,
      application: latestApplication
        ? {
            status: latestApplication.status ?? null,
            rejectionReason: latestApplication.rejectionReason ?? null,
            rejectedAt: latestApplication.rejectedAt ?? null,
          }
        : null,
      // The RESOLVED overrides, not the raw field. For a vendor the migration
      // has not reached these are derived from their legacy grant list, so the
      // form loads the deviations that list encodes — and saving writes them
      // down instead of an empty array. Sending the raw (absent) field meant an
      // admin editing a store name silently restored every permission a
      // previous admin had unchecked.
      permissionOverrides: access.overrides.map((override) => ({
        permission: override.permission,
        mode: override.mode,
        reason: override.reason,
        grantedBy: override.grantedBy,
        grantedAt: override.grantedAt,
        expiresAt: override.expiresAt ?? null,
      })),
      packLayers: access.packs.map((pack) => ({
        pack: pack.pack,
        label: pack.label,
        policy: pack.policy,
        entitled: pack.entitled,
        lifecycle: pack.lifecycle,
      })),
      entitlementNote: buildEntitlementNote({
        plansOn,
        planName: accessPlan?.name ?? null,
        entitledCount,
      }),
      // A paid plan that sells less than the free commission-only baseline is an
      // inversion worth flagging where an admin is looking at one vendor.
      // Which lifecycle state is withholding, so the tab can say "on hold
      // until paid" only when a payment is actually what is outstanding — a
      // pending vendor is waiting on approval, not on money.
      accessMode: vendorAccessMode,
      entitlementWarning:
        plansOn &&
        Boolean(vendor.planId) &&
        entitledCount < COMMISSION_ONLY_PACKS.length,
    });
  },
);

function buildEntitlementNote({
  plansOn,
  planName,
  entitledCount,
}: {
  plansOn: boolean;
  planName: string | null;
  entitledCount: number;
}): string {
  const baseline = COMMISSION_ONLY_PACKS.length;
  if (!plansOn) {
    return `Plans are not enforced on this marketplace, so every vendor runs on the commission-only baseline — ${baseline} of ${ALL_VENDOR_PACKS.length} packs.`;
  }
  if (!planName) {
    return `This vendor holds no plan and trades on commission terms. Entitlement is the commission-only baseline — ${baseline} of ${ALL_VENDOR_PACKS.length} packs.`;
  }
  const suffix =
    entitledCount < baseline
      ? ` Commission-only vendors here hold ${baseline}, so this plan grants less than no plan at all.`
      : "";
  return `Entitlement comes from the ${planName} plan: ${entitledCount} of ${ALL_VENDOR_PACKS.length} packs.${suffix}`;
}

/**
 * PUT /api/admin/vendors/[id]
 * Update vendor status or details
 */
export const PUT = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params, session }) => {
    const { id } = params;

    if (!isValidObjectId(id)) {
      return notFoundResponse("Vendor");
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:vendors:update",
      "moderate",
      session.user.role,
    );

    const body = await validateBody(request, AdminVendorUpdateSchema);

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    await syncDefaultVendorWithSettings(session.user.id, settings);

    // `phone` is selected so the audit snapshot below can tell an owner-phone
    // edit from a field that was simply never loaded.
    const vendorBefore = await Vendor.findById(id)
      .populate("user", "name email phone status")
      .lean();

    if (!vendorBefore) {
      return notFoundResponse("Vendor");
    }
    if (isDefaultVendorRecord(vendorBefore)) {
      throw new ValidationError(
        "The default store vendor is managed from General Settings",
      );
    }

    const application = await findLatestVendorApplication({
      vendorId: vendorBefore._id,
      userId: vendorBefore.userId,
    });
    const selectedPlan =
      !application?.planSnapshot && vendorBefore.planId
        ? await VendorPlan.findById(vendorBefore.planId)
            .select("price billingInterval")
            .lean<{ price?: number; billingInterval?: string } | null>()
        : null;
    if (
      body.status === VENDOR_STATUS.PAYMENT_REQUIRED &&
      vendorBefore.status !== VENDOR_STATUS.PAYMENT_REQUIRED
    ) {
      throw new ValidationError(
        "Payment Required is a system-managed status. Approve the paid application to create setup access.",
      );
    }
    const paidApplication = Boolean(
      (application?.planSnapshot || selectedPlan) &&
        (application?.planSnapshot?.billingInterval ||
          selectedPlan?.billingInterval) !==
          VENDOR_BILLING_INTERVAL.NONE &&
        Number(
          application?.planSnapshot?.price || selectedPlan?.price || 0,
        ) > 0,
    );
    // A paid plan sold with trial days collects nothing at approval: the vendor
    // sells for the trial and is handed to the payment rail only when it lapses
    // (see `getEffectiveSubscription`).
    //
    // Read from the APPLICATION snapshot alone, never from `selectedPlan`. The
    // live plan is only consulted for a vendor placed on a plan by an admin,
    // and that endpoint writes `trialDays: 0` deliberately — treating its row
    // as a trial would waive the first payment of an admin assignment that is
    // sitting in `incomplete` waiting for exactly that payment.
    const approvalTrialDays = Math.max(
      0,
      Math.floor(Number(application?.planSnapshot?.trialDays ?? 0) || 0),
    );
    const startsTrialOnApproval = paidApplication && approvalTrialDays > 0;
    const requiresInitialPayment = Boolean(
      body.status === VENDOR_STATUS.APPROVED &&
        paidApplication &&
        !startsTrialOnApproval &&
        application?.paymentStatus !==
          VENDOR_APPLICATION_PAYMENT_STATUS.PAID,
    );
    if (
      requiresInitialPayment ||
      (startsTrialOnApproval && body.status === VENDOR_STATUS.APPROVED)
    ) {
      if (!application) {
        throw new ValidationError(
          "Paid vendor approval requires a submitted application billing record",
        );
      }
      // Any enabled subscription gateway can collect the first period —
      // approving a paid vendor no longer requires Stripe specifically.
      //
      // Checked for a TRIAL too, even though it collects nothing today: a trial
      // that starts on a marketplace with no enabled gateway ends in a store
      // the vendor has no way to reopen. Failing here puts that in front of the
      // admin who can fix it, days before the vendor meets it.
      assertVendorBillingReady(settings);
    }

    const updates: Record<string, unknown> = {};
    const unsetFields: Record<string, "" | 1> = {};
    const userUpdates: Record<string, unknown> = {};

    if (
      body.status &&
      (Object.values(VENDOR_STATUS) as string[]).includes(body.status)
    ) {
      updates.status = requiresInitialPayment
        ? VENDOR_STATUS.PAYMENT_REQUIRED
        : body.status;
      if (body.status === VENDOR_STATUS.APPROVED) {
        updates.storeActive = !requiresInitialPayment;
      }
      if (
        body.status === VENDOR_STATUS.REJECTED ||
        body.status === VENDOR_STATUS.SUSPENDED
      ) {
        updates.storeActive = false;
      }
    }

    // The storefront badge. Deliberately its own field and its own decision:
    // nothing in the approval, document-upload or subscription paths may set it,
    // so the only way a store becomes "Verified" to buyers is an admin saying so
    // here — which the audit entry below records.
    if (body.verified !== undefined) {
      updates.verified = body.verified === true;
    }

    if (body.commission !== undefined) {
      updates.commission = body.commission;
      // Typed by an admin for this one vendor, so a later change to the store
      // default must leave it alone. See `lib/commission-reprojection.ts`.
      updates.commissionSource = "manual";
    }

    // Deliberately admin-only, and deliberately NOT on the vendor's own
    // settings page. It decides which way money moves on this vendor's cash
    // sales — and a vendor who could set it to "vendor" would be granting
    // themselves the right to mark their own COD orders paid. That is the
    // platform's side of a commercial arrangement, not a store preference.
    if (body.codCollectedBy !== undefined) {
      const value = String(body.codCollectedBy);
      const allowed: string[] = [
        ...Object.values(COD_COLLECTED_BY),
        COD_COLLECTED_BY_INHERIT,
      ];
      if (!allowed.includes(value)) {
        throw new ValidationError("Invalid cash-on-delivery collection setting");
      }
      updates["shipping.codCollectedBy"] = value;
    }

    // Access is DERIVED from the plan's packs; what an admin edits here is the
    // set of deviations from it. An explicit empty array is meaningful — it says
    // "this vendor holds exactly their entitlement" — so `[]` is accepted and
    // written, unlike the old permission list which could not be empty.
    if (body.permissionOverrides !== undefined) {
      updates.permissionOverrides = sanitizeVendorOverrides(
        body.permissionOverrides,
        session.user.id,
        (vendorBefore as { permissionOverrides?: VendorAccessOverride[] })
          .permissionOverrides ?? [],
      );
    }

    if (body.storeName !== undefined && String(body.storeName).trim()) {
      updates.storeName = String(body.storeName).trim();
    }

    if (body.description !== undefined) {
      updates.description = String(body.description || "").trim() || undefined;
    }

    // Kept on the application rather than the vendor: that is the record the
    // become-vendor page reads back, and the one a re-application resets.
    const rejectionReason = body.rejectionReason?.trim();

    if (body.notes !== undefined) {
      const normalizedNotes = String(body.notes || "").trim();
      if (normalizedNotes) {
        updates.notes = normalizedNotes;
      } else {
        unsetFields.notes = "";
      }
    }

    if (body.logo !== undefined) {
      const normalizedLogo = String(body.logo || "").trim();
      if (normalizedLogo) {
        updates.logo = normalizedLogo;
      } else {
        unsetFields.logo = "";
      }
    }

    if (body.banner !== undefined) {
      const normalizedBanner = String(body.banner || "").trim();
      if (normalizedBanner) {
        updates.banner = normalizedBanner;
      } else {
        unsetFields.banner = "";
      }
    }

    if (body.address !== undefined) {
      const address = (body.address ?? {}) as Record<string, unknown>;
      const normalizedAddress = {
        street: String(address.street || "").trim(),
        city: String(address.city || "").trim(),
        state: String(address.state || "").trim(),
        postalCode: String(address.postalCode || "").trim(),
        country: String(address.country || "").trim(),
        phone: String(address.phone || "").trim(),
      };
      const previousCountry =
        (vendorBefore as { address?: { country?: unknown } }).address?.country ||
        "";
      const countryChanged = !areCountryValuesEquivalent(
        normalizedAddress.country,
        previousCountry,
      );
      if (
        normalizedAddress.country &&
        countryChanged &&
        !isCountryAllowed(
          normalizedAddress.country,
          settings.general?.countryAvailability,
        )
      ) {
        throw new ValidationError({
          "address.country": ["Selected country is not available"],
        });
      }
      const hasAnyAddressValue = Object.values(normalizedAddress).some(Boolean);
      if (hasAnyAddressValue) {
        // This write replaces the whole address subdocument, so the geocoded
        // point has to be carried across explicitly or an admin edit would wipe
        // it — dropping the vendor out of the storefront's radius search with
        // nothing to show for it. A changed address is geocoded here too, so
        // the admin edit path cannot leave a vendor on its former map point.
        const previousAddress = (vendorBefore?.address ?? {}) as Record<
          string,
          unknown
        >;
        const addressUnchanged =
          addressGeocodeKey(normalizedAddress) ===
          addressGeocodeKey(previousAddress);
        const coordinates = addressUnchanged
          ? resolveCoordinates(previousAddress.coordinates)
          : await geocodeAddress(normalizedAddress);

        updates.address = {
          ...normalizedAddress,
          coordinates,
          geo: vendorGeoPoint({ coordinates }),
        };
      } else {
        unsetFields.address = "";
      }
    }

    if (body.bankDetails !== undefined) {
      const bank = (body.bankDetails ?? {}) as Record<string, unknown>;
      const normalizedBank = {
        accountName: String(bank.accountName || "").trim(),
        accountNumber: String(bank.accountNumber || "").trim(),
        bankName: String(bank.bankName || "").trim(),
        routingNumber: String(bank.routingNumber || "").trim(),
        swiftCode: String(bank.swiftCode || "").trim(),
      };
      const hasAnyBankValue = Object.values(normalizedBank).some(Boolean);
      if (hasAnyBankValue) {
        updates.bankDetails = normalizedBank;
      } else {
        unsetFields.bankDetails = "";
      }
    }

    if (body.documents !== undefined) {
      const docs = (body.documents ?? {}) as Record<string, unknown>;
      const normalizedDocs = {
        businessLicense: String(docs.businessLicense || "").trim(),
        taxId: String(docs.taxId || "").trim(),
        taxCertificate: String(docs.taxCertificate || "").trim(),
        governmentId: String(docs.governmentId || "").trim(),
      };
      // File fields must be a private storage key or a legacy URL — the
      // admin UI renders them as "View" links, so free-text junk (or a
      // javascript: href) must not reach the record.
      for (const [field, value] of Object.entries(normalizedDocs)) {
        if (field === "taxId" || !value) continue;
        if (!isVendorDocumentReference(value)) {
          throw new ValidationError(`${field} is not a valid document reference`);
        }
      }
      const hasAnyDocValue = Object.values(normalizedDocs).some(Boolean);
      if (hasAnyDocValue) {
        updates.documents = normalizedDocs;
      } else {
        unsetFields.documents = "";
      }
    }

    if (body.slug !== undefined && String(body.slug).trim()) {
      const slug = String(body.slug)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      if (!slug) throw new ValidationError("Invalid store slug");
      if (slug === DEFAULT_VENDOR_SLUG) {
        throw new ValidationError("This store slug is reserved for the default store");
      }

      const existingSlug = await Vendor.findOne({ slug, _id: { $ne: id } })
        .select("_id")
        .lean();
      if (existingSlug) {
        throw new ValidationError("Store slug already exists");
      }

      updates.slug = slug;
    }

    if (body.ownerName !== undefined && String(body.ownerName).trim()) {
      userUpdates.name = String(body.ownerName).trim();
    }

    if (body.ownerPhone !== undefined) {
      userUpdates.phone = String(body.ownerPhone || "").trim() || undefined;
    }

    if (body.ownerEmail !== undefined) {
      const normalizedEmail = String(body.ownerEmail).trim().toLowerCase();
      if (!normalizedEmail) throw new ValidationError("Owner email is required");

      const existingEmailUser = await User.findOne({
        email: normalizedEmail,
        _id: { $ne: vendorBefore.userId },
      })
        .select("_id")
        .lean();

      if (existingEmailUser) {
        throw new ValidationError("Another user already uses this email");
      }

      userUpdates.email = normalizedEmail;
    }

    if (
      body.userStatus &&
      (Object.values(USER_ACCOUNT_STATUS) as string[]).includes(body.userStatus)
    ) {
      userUpdates.status = body.userStatus;
    }

    if (body.status && body.status !== vendorBefore.status && vendorBefore.userId) {
      await assertCanChangeVendorOwnerRole(vendorBefore.userId);
    }

    const vendor = await Vendor.findByIdAndUpdate(
      id,
      {
        $set: updates,
        ...(Object.keys(unsetFields).length ? { $unset: unsetFields } : {}),
      },
      { returnDocument: "after" },
    ).populate("user", "name email status emailVerified");

    if (!vendor) {
      return notFoundResponse("Vendor");
    }

    // Branches that never had their own pin follow the store when an admin
    // moves it. Skipped entirely when this save did not touch the address, so
    // an unrelated edit never rewrites a merchant's collection points.
    if (body.address !== undefined) {
      await syncInheritedLocationGeo(
        vendor._id,
        vendorGeoPoint(vendor.address),
      );
    }

    // The promotion is deliberately NOT gated on a status transition, unlike
    // everything else this save does. A vendor brought back by a billing
    // webhook already reads `approved`, so a transition-only repair can never
    // reach an owner the suspension before it demoted: the admin re-saves, the
    // audit trail says `approved -> approved`, and the merchant stays locked
    // out. `ensureVendorOwnerRole` is idempotent and skips admin/staff owners,
    // so an ordinary edit to an untouched vendor costs one indexed read.
    if (body.status === VENDOR_STATUS.APPROVED && vendor.userId) {
      await ensureVendorOwnerRole(vendor.userId);
    }

    if (body.status && body.status !== vendorBefore.status && vendor.userId) {
      if (body.status === VENDOR_STATUS.APPROVED) {
        // The verification clock and the account reactivation stay on the
        // transition. Re-stamping them on every save would ask a live vendor
        // to verify their email again each time an admin touches their logo.
        if (settings.security?.emailVerificationForVendors) {
          userUpdates.emailVerificationRequiredAt = new Date();
        }
        if (!body.userStatus) {
          userUpdates.status = USER_ACCOUNT_STATUS.ACTIVE;
        }
      } else if (
        body.status === VENDOR_STATUS.REJECTED ||
        body.status === VENDOR_STATUS.SUSPENDED
      ) {
        // Only the vendor membership goes. `setUserRole(CUSTOMER)` rewrote
        // the whole set, so a seller or staff member whose application was
        // rejected walked away a plain customer — the promotion above guards
        // exactly that, and the demotion did not.
        await revokeVendorRole(vendor.userId);
        if (!body.userStatus) {
          userUpdates.status = USER_ACCOUNT_STATUS.ACTIVE;
        }
      }
    }

    if (body.status && body.status !== vendorBefore.status && vendor.userId) {
      if (application) {
        if (body.status === VENDOR_STATUS.APPROVED) {
          application.status = VENDOR_APPLICATION_STATUS.APPROVED;
          const approvedAt = new Date();
          application.approvedAt = approvedAt;
          application.rejectedAt = null;
          application.rejectionReason = null;
          if (requiresInitialPayment) {
            application.paymentStatus =
              VENDOR_APPLICATION_PAYMENT_STATUS.PENDING;
            application.paymentDueAt = new Date(
              approvedAt.getTime() +
                VENDOR_PAYMENT_INVITATION.DEADLINE_DAYS * 24 * 60 * 60 * 1000,
            );
            application.paymentExpiredAt = null;
            application.setupAccessExpiredAt = null;
            application.paymentReminder3SentAt = null;
            application.paymentReminder6SentAt = null;
          } else {
            application.paymentDueAt = null;
          }
          application.lastError = null;
          await application.save();
        } else if (body.status === VENDOR_STATUS.REJECTED) {
          application.status = VENDOR_APPLICATION_STATUS.REJECTED;
          application.rejectedAt = new Date();
          // What the applicant reads on /become-vendor before applying
          // again. A rejection without one just produces the same
          // application a second time.
          application.rejectionReason = rejectionReason || null;
          application.lastError = null;
          await application.save();
          if (
            application.paymentStatus ===
            VENDOR_APPLICATION_PAYMENT_STATUS.PAID
          ) {
            await cancelVendorApplicationBilling(
              application,
              settings,
            ).catch((error) =>
              console.error(
                "Failed to cancel rejected vendor billing:",
                error,
              ),
            );
          }
        }
      }
    }

    // Start the trial clock at APPROVAL, not at submission: a wizard sent on
    // Monday and reviewed on Friday must not arrive with four of its trial days
    // already spent. The row was written `trialing` with null dates by
    // `buildSubscriptionForPlan`, and a null `trialEnd` is what keeps the lazy
    // expiry clock parked until here. Guarded on `trialEnd: null` so a re-save
    // of an already-approved vendor cannot restart a trial that is running.
    if (
      startsTrialOnApproval &&
      body.status === VENDOR_STATUS.APPROVED &&
      body.status !== vendorBefore.status
    ) {
      const { trialStart, trialEnd } = trialWindow(
        approvalTrialDays,
        new Date(),
      );
      await VendorSubscription.updateOne(
        {
          vendorId: vendor._id,
          status: VENDOR_SUBSCRIPTION_STATUS.TRIALING,
          trialEnd: null,
        },
        { $set: { trialStart, trialEnd } },
      );
    }

    // An admin rewording an already-rejected application. The transition
    // block above only runs when the status actually moves.
    if (
      rejectionReason !== undefined &&
      application &&
      application.status === VENDOR_APPLICATION_STATUS.REJECTED &&
      (!body.status || body.status === vendorBefore.status)
    ) {
      const nextReason = rejectionReason || null;
      if ((application.rejectionReason ?? null) !== nextReason) {
        application.rejectionReason = nextReason;
        await application.save();
      }
    }

    if (Object.keys(userUpdates).length > 0 && vendor.userId) {
      await User.updateOne({ _id: vendor.userId }, { $set: userUpdates });
    }

    if (
      body.status === VENDOR_STATUS.APPROVED &&
      body.status !== vendorBefore.status &&
      vendor.userId
    ) {
      const notificationSettings = normalizeNotificationSettings(
        settings.notifications,
      );
      const vendorApplicationChannels =
        notificationSettings.vendor.applicationStatus;
      const vendorUser = vendor.user as {
        name?: string;
        email?: string;
        emailVerified?: boolean;
      } | null;
      const vendorEmail = String(userUpdates.email || vendorUser?.email || "");
      if (
        settings.security?.emailVerificationForVendors &&
        vendorEmail &&
        !vendorUser?.emailVerified
      ) {
        await requestEmailVerification(
          vendorEmail,
          `/${defaultLocale}/email-verified`,
        ).catch(
          (error) => {
            console.error("Failed to request vendor email verification:", error);
          },
        );
      }
      if (vendorApplicationChannels.email && vendorEmail) {
        if (
          requiresInitialPayment &&
          application?.planSnapshot &&
          application.paymentDueAt
        ) {
          await sendVendorPaymentRequiredEmail({
            vendorEmail,
            vendorName: String(userUpdates.name || vendorUser?.name || ""),
            storeName: vendor.storeName,
            planName: application.planSnapshot.name,
            price: application.planSnapshot.price,
            currency: application.planSnapshot.currency,
            billingInterval: application.planSnapshot.billingInterval,
            paymentDueAt: application.paymentDueAt,
            settings,
          });
        } else {
          await sendVendorApprovedEmail({
            vendorEmail,
            vendorName: String(userUpdates.name || vendorUser?.name || ""),
            storeName: vendor.storeName,
            settings,
          });
        }
      }
      await notifyVendorApplicationStatus(
        vendor.userId.toString(),
        requiresInitialPayment
          ? VENDOR_STATUS.PAYMENT_REQUIRED
          : VENDOR_STATUS.APPROVED,
        { settings, channels: vendorApplicationChannels },
      );
    }

    if (
      body.status === VENDOR_STATUS.REJECTED &&
      body.status !== vendorBefore.status &&
      vendor.userId
    ) {
      // A rejection used to go out silently — no mail, no notification — so
      // the applicant learned of it by loading /become-vendor. Same channels
      // and gating as the approval above; the email is not allowed to fail a
      // status change that is already persisted.
      const vendorApplicationChannels = normalizeNotificationSettings(
        settings.notifications,
      ).vendor.applicationStatus;
      const vendorUser = vendor.user as {
        name?: string;
        email?: string;
      } | null;
      const vendorEmail = String(userUpdates.email || vendorUser?.email || "");
      if (vendorApplicationChannels.email && vendorEmail) {
        await sendVendorApplicationRejectedEmail({
          vendorEmail,
          vendorName: String(userUpdates.name || vendorUser?.name || ""),
          storeName: vendor.storeName,
          reason: rejectionReason || null,
          settings,
        }).catch((error) =>
          console.error("Failed to send vendor rejection email:", error),
        );
      }
      await notifyVendorApplicationStatus(
        vendor.userId.toString(),
        VENDOR_STATUS.REJECTED,
        {
          settings,
          channels: vendorApplicationChannels,
          reason: rejectionReason || null,
        },
      );
    }

    const auditContext = createAuditContext(request, session);

    // An approve/reject/suspend is a decision and keeps its own action, so the
    // Activity timeline can badge it. Everything else this endpoint can write —
    // address, bank details, documents, permissions, notes, owner account — was
    // previously logged by nothing at all: the old branch only ever recorded a
    // status change or, failing that, a commission change. One diff of the full
    // payload now covers the rest; `auditUpdate` no-ops when nothing moved.
    const ownerBefore = (vendorBefore.user ?? {}) as {
      name?: unknown;
      email?: unknown;
      phone?: unknown;
      status?: unknown;
    };
    const ownerAfter = {
      name: userUpdates.name ?? ownerBefore.name,
      email: userUpdates.email ?? ownerBefore.email,
      phone: "phone" in userUpdates ? userUpdates.phone : ownerBefore.phone,
      status: userUpdates.status ?? ownerBefore.status,
    };

    if (
      body.status &&
      body.status !== vendorBefore.status &&
      (body.status === VENDOR_STATUS.APPROVED ||
        body.status === VENDOR_STATUS.REJECTED ||
        body.status === VENDOR_STATUS.SUSPENDED)
    ) {
      await auditVendorDecision(
        auditContext,
        id,
        body.status as "approved" | "rejected" | "suspended",
        vendorBefore.storeName,
      );
    }

    await auditUpdate(
      auditContext,
      "vendor",
      id,
      vendorAuditSnapshot(vendorBefore as VendorAuditSubject, ownerBefore),
      vendorAuditSnapshot(vendor.toObject() as VendorAuditSubject, ownerAfter),
      vendorBefore.storeName,
    );

    revalidateProductContent();

    // A store that has gone dark is already rendering a filler in every rung it
    // holds — the sponsored pool requires `storeActive` — so leaving the days
    // booked would keep global inventory off the market with nothing shown in
    // it. Release is scoped to the transition: re-saving an already-inactive
    // vendor has nothing left to release and sends nothing.
    if (vendorBefore.storeActive !== false && vendor.storeActive === false) {
      await releaseBoostInventoryForVendor(
        id,
        BOOST_CANCEL_REASON.VENDOR_INACTIVE,
      ).catch((error) =>
        console.error("Failed to release boost inventory for vendor", id, error),
      );
    }

    return successResponse(vendor);
  },
);

/**
 * DELETE /api/admin/vendors/[id]
 * Delete vendor and revert user role
 */
export const DELETE = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:vendors:delete", preset: "strict" },
  },
  async ({ request, params, session }) => {
    const { id } = params;
    if (!isValidObjectId(id)) {
      return notFoundResponse("Vendor");
    }

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    await syncDefaultVendorWithSettings(session.user.id, settings);

    const vendor = await Vendor.findById(id)
      .populate("user", "name email")
      .lean();

    if (!vendor) {
      return notFoundResponse("Vendor");
    }
    if (isDefaultVendorRecord(vendor)) {
      throw new ValidationError(
        "The default store vendor is managed from General Settings",
      );
    }

    const stripeSubscription = await VendorSubscription.findOne({
      vendorId: id,
      provider: "stripe",
      paymentProviderRef: { $ne: null },
    })
      .sort({ createdAt: -1 })
      .select("paymentProviderRef providerStatus")
      .lean<{
        paymentProviderRef?: string | null;
        providerStatus?: string | null;
      } | null>();
    if (stripeSubscription?.paymentProviderRef) {
      const stripe = getStripeForSecretKey(assertStripeBillingReady(settings));
      try {
        const snapshot = await retrieveVendorBillingSnapshot(
          stripe,
          stripeSubscription.paymentProviderRef,
        );
        assertVendorBillingTerminalForDeletion({
          provider: "stripe",
          providerSubscriptionId: stripeSubscription.paymentProviderRef,
          providerStatus: snapshot.subscription.status,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        if (!/No such subscription/i.test(message)) throw error;
      }
    }

    const productCount = await Product.countDocuments({ vendorId: id });
    if (productCount > 0) {
      throw new ValidationError(
        "Cannot delete vendor with existing products. Reassign or delete products first.",
      );
    }

    if (vendor.userId) {
      await assertCanChangeVendorOwnerRole(vendor.userId);
    }

    await Vendor.deleteOne({ _id: id });

    // Retire the billing rows. They outlive the vendor on purpose (the payment
    // rows are the financial record), but they must not keep occupying the
    // vendor's active subscription slot or counting as live plan usage.
    await retireVendorBillingRecords({
      retireSubscriptions: async (patch) =>
        (await VendorSubscription.updateMany({ vendorId: id }, { $set: patch }))
          .modifiedCount ?? 0,
      retireApplications: async (patch) =>
        (
          await VendorApplication.updateMany(
            {
              vendorId: id,
              status: { $ne: VENDOR_APPLICATION_STATUS.REJECTED },
            },
            { $set: patch },
          )
        ).modifiedCount ?? 0,
    }).catch((err) =>
      console.error("Failed to retire billing records for deleted vendor:", err),
    );

    // Deactivate the deleted vendor's coupons so they can't keep being
    // redeemed against a vendor that no longer exists.
    const { Coupon } = await import("@/models");
    const { CouponStatus } = await import("@/models/coupon.model");
    await Coupon.updateMany(
      { vendorId: id },
      { $set: { status: CouponStatus.INACTIVE } },
    ).catch((err) =>
      console.error("Failed to deactivate coupons for deleted vendor:", err),
    );

    // Messaging connections hold live encrypted Meta access tokens plus the
    // phoneNumberId/pageId the inbound webhook routes on. Leaving them behind
    // means Storify keeps receiving and sending on behalf of a store that no
    // longer exists, and keeps custody of credentials nobody can revoke here.
    const { ChannelConnection, WhatsAppTemplate } = await import("@/models");
    try {
      // Templates are keyed by connection, not by vendor, so they have to be
      // collected before the connections go away.
      const connectionIds = (
        await ChannelConnection.find({ ownerKey: `vendor:${id}` })
          .select("_id")
          .lean<Array<{ _id: Types.ObjectId }>>()
      ).map((connection) => connection._id);
      if (connectionIds.length) {
        await WhatsAppTemplate.deleteMany({
          channelConnectionId: { $in: connectionIds },
        });
        await ChannelConnection.deleteMany({ _id: { $in: connectionIds } });
      }
    } catch (err) {
      console.error(
        "Failed to remove messaging connections for deleted vendor:",
        err,
      );
    }

    if (vendor.userId) {
      await revokeVendorRole(vendor.userId);
      await User.updateOne(
        { _id: vendor.userId },
        { $set: { status: USER_ACCOUNT_STATUS.ACTIVE } },
      );
    }

    const auditContext = createAuditContext(request, session);
    await auditDelete(
      auditContext,
      "vendor",
      id,
      { storeName: vendor.storeName, userId: String(vendor.userId || "") },
      vendor.storeName,
    );

    revalidateProductContent();

    return successResponse({ message: "Vendor deleted successfully" });
  },
);
