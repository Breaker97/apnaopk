import type { Types } from "mongoose";
import { User, Vendor, VendorPlan, VendorSubscription } from "@/models";
import {
  BOOST_CANCEL_REASON,
  USER_ACCOUNT_STATUS,
  USER_ROLES,
  VENDOR_APPLICATION_PAYMENT_STATUS,
  VENDOR_APPLICATION_STATUS,
  VENDOR_BILLING_INTERVAL,
  VENDOR_PAYMENT_INVITATION,
  VENDOR_STATUS,
  VENDOR_SUBSCRIPTION_STATUS,
  type VendorStatus,
} from "@/config/app.config";
import { defaultLocale } from "@/config/i18n.config";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { isValidObjectId } from "@/lib/api/validate";
import { requestEmailVerification } from "@/lib/auth/auth";
import {
  resolveAccountAccessPurpose,
  sendAccountAccessEmail,
} from "@/lib/auth/account-access";
import { ensureVendorOwnerRole, revokeVendorRole } from "@/lib/access/user-role";
import { isStaffRole } from "@/lib/access/staff-role";
import { auditUpdate, auditVendorDecision, type AuditContext } from "@/lib/audit";
import { releaseBoostInventoryForVendor } from "@/lib/boosts/boosts";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import {
  sendVendorApplicationRejectedEmail,
  sendVendorApprovedEmail,
  sendVendorPaymentRequiredEmail,
} from "@/lib/email/vendor-emails";
import { notifyVendorApplicationStatus } from "@/lib/notifications/notifications";
import { normalizeNotificationSettings } from "@/lib/notifications/notification-settings";
import { isDefaultVendorRecord } from "@/lib/vendors/multi-vendor";
import {
  findLatestVendorApplication,
  vendorDecisionBlocker,
} from "@/lib/vendors/vendor-application";
import { vendorApprovalEmail } from "@/lib/vendors/vendor-approval-email";
import { vendorAuditSnapshot, type VendorAuditSubject } from "@/lib/vendors/vendor-audit";
import { assertVendorBillingReady } from "@/lib/vendors/vendor-billing-providers";
import { cancelVendorApplicationBilling } from "@/lib/vendors/vendor-stripe-billing";
import { trialWindow } from "@/lib/vendors/vendor-subscriptions";
import type { ISettings } from "@/models/settings.model";

/**
 * An administrator's decision on a seller: approve, reject or suspend.
 *
 * Two callers, one behaviour. The admin's vendor save
 * (`PUT /api/admin/vendors/[id]`) changes a seller's status together with
 * whatever else the form holds, in one vendor write of its own, and runs the
 * steps below around that write in this order:
 *
 *   1. `prepareVendorStatusChange` — reads the application and plan, refuses
 *      what cannot be decided, and says which vendor fields the status sets;
 *   2. `assertCanChangeVendorOwnerRole` — when the status moves;
 *   3. (the caller's vendor write)
 *   4. `applyVendorStatusChange` — the owner's role, the application, the
 *      trial clock; returns what the owner's account write must add;
 *   5. (the caller's owner write)
 *   6. `notifyVendorStatusChange` — the applicant's email and notification;
 *   7. `auditVendorStatusChange`, then the caller's change diff;
 *   8. `releaseBoostsOfClosedStore` once the store has gone dark.
 *
 * The business app decides one application at a time
 * (`decideVendorApplication`): the same steps, with a vendor write that only
 * lands while the application is still waiting, so two administrators (or a
 * retry) can never decide it twice.
 */

/** What a status change will do, worked out before anything is written. */
export interface VendorStatusChange {
  /** The seller's current application, saved again by `applyVendorStatusChange`. */
  application: Awaited<ReturnType<typeof findLatestVendorApplication>>;
  /** What the status sets on the vendor, for the caller's vendor write. */
  vendorFields: { status?: VendorStatus; storeActive?: boolean };
  /** A paid plan bought without a trial and not paid yet: approval opens setup access only. */
  requiresInitialPayment: boolean;
  /** A paid plan with free days: approval starts the trial clock. */
  startsTrialOnApproval: boolean;
  approvalTrialDays: number;
}

interface VendorBeforeChange {
  _id: unknown;
  userId?: unknown;
  planId?: unknown;
  status?: string;
  storeName?: string;
  storeActive?: boolean;
}

interface VendorAfterChange {
  _id: Types.ObjectId;
  userId?: unknown;
  storeName: string;
  storeActive?: boolean;
  /** The owner, populated with at least `name email emailVerified`. */
  user?: unknown;
}

const isVendorStatus = (value: string): value is VendorStatus =>
  (Object.values(VENDOR_STATUS) as string[]).includes(value);

const vendorApplicationOf = (vendor: VendorBeforeChange) => ({
  vendorId: vendor._id,
  userId: vendor.userId,
});

/**
 * Step 1: read the seller's application and plan, refuse a status the store
 * cannot reach, and say which vendor fields `status` sets. `status` is the
 * one the admin asked for, exactly as sent; an unknown word sets nothing.
 */
export async function prepareVendorStatusChange({
  vendor,
  status,
  settings,
  application: loaded,
}: {
  vendor: VendorBeforeChange;
  status: string | undefined;
  settings: ISettings;
  /** The application, when the caller has already read it (null: there is none). */
  application?: VendorStatusChange["application"];
}): Promise<VendorStatusChange> {
  const application =
    loaded !== undefined ? loaded : await findLatestVendorApplication(vendorApplicationOf(vendor));
  const selectedPlan =
    !application?.planSnapshot && vendor.planId
      ? await VendorPlan.findById(vendor.planId)
          .select("price billingInterval")
          .lean<{ price?: number; billingInterval?: string } | null>()
      : null;
  if (
    status === VENDOR_STATUS.PAYMENT_REQUIRED &&
    vendor.status !== VENDOR_STATUS.PAYMENT_REQUIRED
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
    status === VENDOR_STATUS.APPROVED &&
      paidApplication &&
      !startsTrialOnApproval &&
      application?.paymentStatus !== VENDOR_APPLICATION_PAYMENT_STATUS.PAID,
  );
  if (
    requiresInitialPayment ||
    (startsTrialOnApproval && status === VENDOR_STATUS.APPROVED)
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

  const vendorFields: VendorStatusChange["vendorFields"] = {};
  if (status && isVendorStatus(status)) {
    vendorFields.status = requiresInitialPayment
      ? VENDOR_STATUS.PAYMENT_REQUIRED
      : status;
    if (status === VENDOR_STATUS.APPROVED) {
      vendorFields.storeActive = !requiresInitialPayment;
    }
    if (
      status === VENDOR_STATUS.REJECTED ||
      status === VENDOR_STATUS.SUSPENDED
    ) {
      vendorFields.storeActive = false;
    }
  }

  return {
    application,
    vendorFields,
    requiresInitialPayment,
    startsTrialOnApproval,
    approvalTrialDays,
  };
}

/**
 * Step 2, when the status moves: an administrator's or staff member's
 * account is never turned into (or out of) a seller by a vendor decision.
 */
export async function assertCanChangeVendorOwnerRole(userId: unknown) {
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

/**
 * Step 4, after the vendor write: the owner's role, the application's review
 * and billing state, and the trial clock. Returns the fields the owner's
 * account write must add (`emailVerificationRequiredAt`, `status`).
 *
 * `rejectionReason` is the trimmed reason, or undefined when none was sent;
 * `explicitUserStatus` the account status the same save set by hand, which
 * the decision then leaves alone.
 */
export async function applyVendorStatusChange({
  change,
  before,
  vendor,
  status,
  rejectionReason,
  explicitUserStatus,
  settings,
}: {
  change: VendorStatusChange;
  before: VendorBeforeChange;
  vendor: VendorAfterChange;
  status: string | undefined;
  rejectionReason: string | undefined;
  explicitUserStatus?: string;
  settings: ISettings;
}): Promise<Record<string, unknown>> {
  const ownerUpdates: Record<string, unknown> = {};
  const { application } = change;

  // The promotion is deliberately NOT gated on a status transition, unlike
  // everything else this save does. A vendor brought back by a billing
  // webhook already reads `approved`, so a transition-only repair can never
  // reach an owner the suspension before it demoted: the admin re-saves, the
  // audit trail says `approved -> approved`, and the merchant stays locked
  // out. `ensureVendorOwnerRole` is idempotent and skips admin/staff owners,
  // so an ordinary edit to an untouched vendor costs one indexed read.
  if (status === VENDOR_STATUS.APPROVED && vendor.userId) {
    await ensureVendorOwnerRole(vendor.userId);
  }

  if (status && status !== before.status && vendor.userId) {
    if (status === VENDOR_STATUS.APPROVED) {
      // The verification clock and the account reactivation stay on the
      // transition. Re-stamping them on every save would ask a live vendor
      // to verify their email again each time an admin touches their logo.
      if (settings.security?.emailVerificationForVendors) {
        ownerUpdates.emailVerificationRequiredAt = new Date();
      }
      if (!explicitUserStatus) {
        ownerUpdates.status = USER_ACCOUNT_STATUS.ACTIVE;
      }
    } else if (
      status === VENDOR_STATUS.REJECTED ||
      status === VENDOR_STATUS.SUSPENDED
    ) {
      // Only the vendor membership goes. `setUserRole(CUSTOMER)` rewrote
      // the whole set, so a seller or staff member whose application was
      // rejected walked away a plain customer — the promotion above guards
      // exactly that, and the demotion did not.
      await revokeVendorRole(vendor.userId);
      if (!explicitUserStatus) {
        ownerUpdates.status = USER_ACCOUNT_STATUS.ACTIVE;
      }
    }

    if (application) {
      if (status === VENDOR_STATUS.APPROVED) {
        application.status = VENDOR_APPLICATION_STATUS.APPROVED;
        const approvedAt = new Date();
        application.approvedAt = approvedAt;
        application.rejectedAt = null;
        application.rejectionReason = null;
        if (change.requiresInitialPayment) {
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
      } else if (status === VENDOR_STATUS.REJECTED) {
        application.status = VENDOR_APPLICATION_STATUS.REJECTED;
        application.rejectedAt = new Date();
        // What the applicant reads on /become-vendor before applying
        // again. A rejection without one just produces the same
        // application a second time.
        application.rejectionReason = rejectionReason || null;
        application.lastError = null;
        await application.save();
        if (
          application.paymentStatus === VENDOR_APPLICATION_PAYMENT_STATUS.PAID
        ) {
          await cancelVendorApplicationBilling(application, settings).catch(
            (error) =>
              console.error("Failed to cancel rejected vendor billing:", error),
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
    change.startsTrialOnApproval &&
    status === VENDOR_STATUS.APPROVED &&
    status !== before.status
  ) {
    const { trialStart, trialEnd } = trialWindow(
      change.approvalTrialDays,
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
    (!status || status === before.status)
  ) {
    const nextReason = rejectionReason || null;
    if ((application.rejectionReason ?? null) !== nextReason) {
      application.rejectionReason = nextReason;
      await application.save();
    }
  }

  return ownerUpdates;
}

/**
 * Step 6, after the owner's account write: tell the applicant. `owner` is
 * the name and email the same save gave the owner, when it changed them.
 */
export async function notifyVendorStatusChange({
  change,
  before,
  vendor,
  status,
  rejectionReason,
  owner = {},
  settings,
}: {
  change: VendorStatusChange;
  before: VendorBeforeChange;
  vendor: VendorAfterChange;
  status: string | undefined;
  rejectionReason: string | undefined;
  owner?: { name?: unknown; email?: unknown };
  settings: ISettings;
}) {
  if (!status || status === before.status || !vendor.userId) return;
  const { application, requiresInitialPayment } = change;

  if (status === VENDOR_STATUS.APPROVED) {
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
    const vendorEmail = String(owner.email || vendorUser?.email || "");
    const paymentRequired = Boolean(
      requiresInitialPayment && application?.planSnapshot && application.paymentDueAt,
    );
    const approvalEmail = vendorApprovalEmail({
      paymentRequired,
      ownerHasPassword:
        paymentRequired ||
        (await resolveAccountAccessPurpose(String(vendor.userId))) === "reset",
    });
    // A suspended store brought back is told so, not welcomed as a new
    // seller — unless it still owes its first payment or has no password,
    // whose emails are the way back in.
    const reinstated =
      before.status === VENDOR_STATUS.SUSPENDED &&
      !requiresInitialPayment &&
      approvalEmail !== "set-password";
    if (
      approvalEmail !== "set-password" &&
      settings.security?.emailVerificationForVendors &&
      vendorEmail &&
      !vendorUser?.emailVerified
    ) {
      await requestEmailVerification(
        vendorEmail,
        `/${defaultLocale}/email-verified`,
      ).catch((error) => {
        console.error("Failed to request vendor email verification:", error);
      });
    }
    if (vendorApplicationChannels.email && vendorEmail && !reinstated) {
      if (
        requiresInitialPayment &&
        application?.planSnapshot &&
        application.paymentDueAt
      ) {
        await sendVendorPaymentRequiredEmail({
          vendorEmail,
          vendorName: String(owner.name || vendorUser?.name || ""),
          storeName: vendor.storeName,
          planName: application.planSnapshot.name,
          price: application.planSnapshot.price,
          currency: application.planSnapshot.currency,
          billingInterval: application.planSnapshot.billingInterval,
          paymentDueAt: application.paymentDueAt,
          settings,
        });
      } else if (approvalEmail === "set-password") {
        // An owner with no password (an imported store) could not sign in
        // from a plain approval email; this one is the approval and the way in.
        await sendAccountAccessEmail({
          userId: String(vendor.userId),
          purpose: "invite",
          copy: "vendor-approved",
        }).catch((error) =>
          console.error("Failed to send the vendor's set-password invitation:", error),
        );
      } else {
        await sendVendorApprovedEmail({
          vendorEmail,
          vendorName: String(owner.name || vendorUser?.name || ""),
          storeName: vendor.storeName,
          settings,
        });
      }
    }
    await notifyVendorApplicationStatus(
      String(vendor.userId),
      reinstated
        ? "reinstated"
        : requiresInitialPayment
          ? VENDOR_STATUS.PAYMENT_REQUIRED
          : VENDOR_STATUS.APPROVED,
      { settings, channels: vendorApplicationChannels },
    );
  }

  if (status === VENDOR_STATUS.SUSPENDED) {
    // A suspension used to go out silently: the seller found their store
    // dark and their dashboard gone with nothing to say why.
    await notifyVendorApplicationStatus(
      String(vendor.userId),
      VENDOR_STATUS.SUSPENDED,
      {
        settings,
        channels: normalizeNotificationSettings(settings.notifications).vendor
          .applicationStatus,
      },
    ).catch((error) =>
      console.error("Failed to notify the vendor of the suspension:", error),
    );
  }

  if (status === VENDOR_STATUS.REJECTED) {
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
    const vendorEmail = String(owner.email || vendorUser?.email || "");
    if (vendorApplicationChannels.email && vendorEmail) {
      await sendVendorApplicationRejectedEmail({
        vendorEmail,
        vendorName: String(owner.name || vendorUser?.name || ""),
        storeName: vendor.storeName,
        reason: rejectionReason || null,
        settings,
      }).catch((error) =>
        console.error("Failed to send vendor rejection email:", error),
      );
    }
    await notifyVendorApplicationStatus(
      String(vendor.userId),
      VENDOR_STATUS.REJECTED,
      {
        settings,
        channels: vendorApplicationChannels,
        reason: rejectionReason || null,
      },
    );
  }
}

/**
 * Step 7: an approve, reject or suspend is a decision and keeps its own
 * Activity Log action, so the timeline can badge it. The caller's change
 * diff follows it.
 */
export async function auditVendorStatusChange(
  context: AuditContext,
  vendorId: string,
  before: VendorBeforeChange,
  status: string | undefined,
) {
  if (
    status &&
    status !== before.status &&
    (status === VENDOR_STATUS.APPROVED ||
      status === VENDOR_STATUS.REJECTED ||
      status === VENDOR_STATUS.SUSPENDED)
  ) {
    await auditVendorDecision(context, vendorId, status, before.storeName);
  }
}

/**
 * Step 8. A store that has gone dark is already rendering a filler in every
 * rung it holds — the sponsored pool requires `storeActive` — so leaving the
 * days booked would keep global inventory off the market with nothing shown
 * in it. Release is scoped to the transition: re-saving an already-inactive
 * vendor has nothing left to release and sends nothing.
 */
export async function releaseBoostsOfClosedStore(
  vendorId: string,
  before: { storeActive?: boolean },
  after: { storeActive?: boolean },
) {
  if (before.storeActive !== false && after.storeActive === false) {
    await releaseBoostInventoryForVendor(
      vendorId,
      BOOST_CANCEL_REASON.VENDOR_INACTIVE,
    ).catch((error) =>
      console.error("Failed to release boost inventory for vendor", vendorId, error),
    );
  }
}

// --- one application at a time (the business app) --------------------------

function refusal(blocker: "ALREADY_DECIDED" | "NOT_SUBMITTED"): ConflictError {
  return blocker === "ALREADY_DECIDED"
    ? new ConflictError("This application has already been decided.", {
        reason: "ALREADY_DECIDED",
      })
    : new ConflictError("The applicant has not finished applying.", {
        reason: "NOT_SUBMITTED",
      });
}

/**
 * Approve or reject one waiting application, with everything the admin's
 * vendor save does for the same status change (`PUT {status}` there): the
 * shop opens, waits for its first payment or starts its trial; the applicant
 * becomes a seller or loses the role; they are emailed and notified; the
 * Activity Log records the decision and the change.
 *
 * Only a `pending` seller is decided, and the vendor write itself only lands
 * while it still is: a second decision, from another administrator or the
 * website at the same moment, is refused `ALREADY_DECIDED` (409) and changes
 * nothing. `NotFoundError` for an unknown id or the store's own vendor.
 */
export async function decideVendorApplication({
  vendorId,
  decision,
  reason,
  settings,
  auditContext,
}: {
  vendorId: string;
  decision: "approve" | "reject";
  /** What the applicant is told on a rejection; ignored on an approval. */
  reason?: string;
  settings: ISettings;
  auditContext: AuditContext;
}): Promise<{ vendorStatus: string }> {
  if (!isValidObjectId(vendorId)) throw new NotFoundError("Vendor application");
  const before = await Vendor.findById(vendorId)
    .populate("user", "name email phone status")
    .lean();
  if (!before || isDefaultVendorRecord(before)) {
    throw new NotFoundError("Vendor application");
  }

  const status =
    decision === "approve" ? VENDOR_STATUS.APPROVED : VENDOR_STATUS.REJECTED;
  const rejectionReason =
    decision === "reject" ? reason?.trim() || undefined : undefined;

  const application = await findLatestVendorApplication(vendorApplicationOf(before));
  const blocker = vendorDecisionBlocker(before, application);
  if (blocker) throw refusal(blocker);
  const change = await prepareVendorStatusChange({
    vendor: before,
    status,
    settings,
    application,
  });
  if (before.userId) await assertCanChangeVendorOwnerRole(before.userId);

  const vendor = await Vendor.findOneAndUpdate(
    { _id: before._id, status: VENDOR_STATUS.PENDING },
    { $set: change.vendorFields },
    { returnDocument: "after" },
  ).populate("user", "name email status emailVerified");
  if (!vendor) {
    const now = await Vendor.exists({ _id: before._id });
    throw now ? refusal("ALREADY_DECIDED") : new NotFoundError("Vendor application");
  }

  const ownerUpdates = await applyVendorStatusChange({
    change,
    before,
    vendor,
    status,
    rejectionReason,
    settings,
  });
  if (Object.keys(ownerUpdates).length > 0 && vendor.userId) {
    await User.updateOne({ _id: vendor.userId }, { $set: ownerUpdates });
  }

  await notifyVendorStatusChange({
    change,
    before,
    vendor,
    status,
    rejectionReason,
    settings,
  });

  const ownerBefore = (before.user ?? {}) as {
    name?: unknown;
    email?: unknown;
    phone?: unknown;
    status?: unknown;
  };
  await auditVendorStatusChange(auditContext, vendorId, before, status);
  await auditUpdate(
    auditContext,
    "vendor",
    vendorId,
    vendorAuditSnapshot(before as VendorAuditSubject, ownerBefore),
    vendorAuditSnapshot(vendor.toObject() as VendorAuditSubject, {
      ...ownerBefore,
      status: ownerUpdates.status ?? ownerBefore.status,
    }),
    before.storeName,
  );

  revalidateProductContent();
  await releaseBoostsOfClosedStore(vendorId, before, vendor);

  return { vendorStatus: vendor.status };
}
