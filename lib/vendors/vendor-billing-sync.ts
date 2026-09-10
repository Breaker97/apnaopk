import { Types } from "mongoose";
import {
  VENDOR_APPLICATION_PAYMENT_STATUS,
  VENDOR_APPLICATION_STATUS,
  VENDOR_STATUS,
  VENDOR_SUBSCRIPTION_STATUS,
} from "@/config/app.config";
import {
  canActivatePaidPlan,
  invoiceFailureGrace,
  type NormalizedStripeSubscription,
} from "@/lib/vendors/vendor-billing-state";
import type {
  NormalizedStripeInvoice,
  VendorBillingSnapshot,
} from "@/lib/vendors/vendor-stripe-adapter";
import {
  Vendor,
  VendorApplication,
  VendorSubscription,
  VendorSubscriptionPayment,
} from "@/models";
import { subscriptionOccupiesSlot } from "@/models/vendorSubscription.model";
import { ensureVendorOwnerRole } from "@/lib/access/user-role";

export type { VendorBillingSnapshot } from "@/lib/vendors/vendor-stripe-adapter";

interface BillingSyncSubscriptionContext {
  id: string;
  vendorId: string;
  applicationId: string | null;
  planId: string;
  status: string;
  occupiesActiveSlot?: boolean;
  providerStatus?: string | null;
  stripePriceId: string | null;
  planSnapshot: Record<string, unknown>;
  commissionRateSnapshot: number;
  firstPaymentFailedAt: Date | null;
  gracePeriodEnd?: Date | null;
  failedInvoiceId: string | null;
  pendingPlanId: string | null;
  pendingPlanSnapshot: Record<string, unknown> | null;
  pendingCommissionRateSnapshot: number | null;
  pendingChangeType: string | null;
  pendingChangeStatus: string | null;
}

interface BillingSyncApplicationContext {
  id: string;
  userId: string;
  vendorId: string | null;
  planId: string | null;
  status: string;
  paymentStatus: string;
  /** Admin-controlled price the application was approved at. Used as the trusted
   * price only when the subscription's own snapshot never recorded one. */
  stripePriceId: string | null;
}

export interface BillingSyncContext {
  subscription: BillingSyncSubscriptionContext;
  application: BillingSyncApplicationContext | null;
}

export interface SubscriptionPaymentWrite {
  vendorId: string;
  subscriptionId: string;
  applicationId: string | null;
  provider: import("@/models/vendorSubscriptionPayment.model").VendorSubscriptionPaymentProvider;
  providerSubscriptionId: string;
  providerInvoiceId: string;
  providerPaymentIntentId: string | null;
  status: "open" | "paid" | "failed" | "void" | "refunded";
  amountDue: number;
  amountPaid: number;
  amountRefunded: number;
  currency: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  attemptCount: number;
  paidAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
  providerCreatedAt: Date | null;
  providerStateUpdatedAt: Date;
}

interface VendorAccessProjection {
  planId: string;
  commissionRate: number;
  stripeCustomerId: string | null;
}

export interface BillingSyncDependencies {
  findContext(
    snapshot: VendorBillingSnapshot,
  ): Promise<BillingSyncContext | null>;
  recordPayment(
    context: BillingSyncContext,
    payment: SubscriptionPaymentWrite,
  ): Promise<void>;
  updateSubscription(
    context: BillingSyncContext,
    patch: Record<string, unknown>,
  ): Promise<void>;
  updateApplication(
    context: BillingSyncContext,
    patch: Record<string, unknown>,
  ): Promise<void>;
  activateVendor(
    context: BillingSyncContext,
    projection: VendorAccessProjection,
  ): Promise<boolean>;
  deactivateVendor(
    context: BillingSyncContext,
    revokeFinancialAccess?: boolean,
  ): Promise<boolean>;
  recordError(
    context: BillingSyncContext,
    message: string,
  ): Promise<void>;
}

type BillingNotificationType =
  | "payment_confirmed"
  | "plan_activated"
  | "renewal_payment_failed"
  | "renewal_due"
  | "trial_ending"
  | "trial_ended"
  | "subscription_expired"
  | "upgrade_applied"
  | "downgrade_applied";

export interface BillingTransitionNotification {
  type: BillingNotificationType;
  key: string;
}

export interface BillingSyncResult {
  subscriptionId: string | null;
  applicationId: string | null;
  vendorId: string | null;
  activated: boolean;
  deactivated: boolean;
  reason:
    | "not_found"
    | "candidate_mismatch"
    | "metadata_mismatch"
    | "provider_updated"
    | "access_revoked"
    | "payment_failed"
    | "activated"
    | "ended";
  notifications: BillingTransitionNotification[];
}

interface BillingSyncOptions {
  eventType?: string;
  now?: Date;
  expectedSubscriptionId?: string;
}

function stringId(value: unknown): string | null {
  if (!value) return null;
  return String(value);
}

/** The subscription / application fields the sync reads, as `lean()` hands them over. */
type BillingSyncContextDocument = {
  _id?: unknown;
  vendorId?: unknown;
  userId?: unknown;
  applicationId?: unknown;
  planId?: unknown;
  status?: unknown;
  paymentStatus?: unknown;
  stripePriceId?: string | null;
  planSnapshot?: (Record<string, unknown> & { stripePriceId?: unknown }) | null;
  commissionRateSnapshot?: number | null;
  firstPaymentFailedAt?: Date | null;
  gracePeriodEnd?: Date | null;
  failedInvoiceId?: string | null;
  pendingPlanId?: unknown;
  pendingPlanSnapshot?: Record<string, unknown> | null;
  pendingCommissionRateSnapshot?: number | null;
  pendingChangeType?: string | null;
  pendingChangeStatus?: string | null;
};

export interface BillingSyncContextLookup {
  findByProviderReference(
    providerSubscriptionId: string,
    limit: number,
  ): Promise<BillingSyncContextDocument[]>;
  findByLocalSubscriptionId(
    localSubscriptionId: string,
  ): Promise<BillingSyncContextDocument | null>;
  findLegacyByApplicationId(
    applicationId: string,
    limit: number,
  ): Promise<BillingSyncContextDocument[]>;
}

export async function resolveVendorBillingContextSubscription(
  snapshot: VendorBillingSnapshot,
  lookup: BillingSyncContextLookup,
): Promise<BillingSyncContextDocument | null> {
  const providerMatches = await lookup.findByProviderReference(
    snapshot.subscription.id,
    2,
  );
  if (providerMatches.length > 0) {
    return providerMatches.length === 1 ? providerMatches[0] : null;
  }

  const metadataLocalSubscriptionId =
    snapshot.subscription.metadata.localSubscriptionId;
  if (metadataLocalSubscriptionId != null) {
    return Types.ObjectId.isValid(metadataLocalSubscriptionId)
      ? lookup.findByLocalSubscriptionId(metadataLocalSubscriptionId)
      : null;
  }

  const metadataApplicationId =
    snapshot.subscription.metadata.applicationId;
  if (
    !metadataApplicationId ||
    !Types.ObjectId.isValid(metadataApplicationId)
  ) {
    return null;
  }
  const legacyMatches = await lookup.findLegacyByApplicationId(
    metadataApplicationId,
    2,
  );
  return legacyMatches.length === 1 ? legacyMatches[0] : null;
}

function contextFromDocuments(
  subscription: BillingSyncContextDocument,
  application: BillingSyncContextDocument | null,
): BillingSyncContext {
  return {
    subscription: {
      id: String(subscription._id),
      vendorId: String(subscription.vendorId),
      applicationId: stringId(subscription.applicationId),
      planId: String(subscription.planId),
      status: String(subscription.status),
      stripePriceId:
        subscription.stripePriceId ||
        (typeof subscription.planSnapshot?.stripePriceId === "string"
          ? subscription.planSnapshot.stripePriceId
          : null),
      planSnapshot: subscription.planSnapshot || {},
      commissionRateSnapshot: Number(
        subscription.commissionRateSnapshot ?? 0,
      ),
      firstPaymentFailedAt: subscription.firstPaymentFailedAt || null,
      gracePeriodEnd: subscription.gracePeriodEnd || null,
      failedInvoiceId: subscription.failedInvoiceId || null,
      pendingPlanId: stringId(subscription.pendingPlanId),
      pendingPlanSnapshot: subscription.pendingPlanSnapshot || null,
      pendingCommissionRateSnapshot:
        subscription.pendingCommissionRateSnapshot ?? null,
      pendingChangeType: subscription.pendingChangeType || null,
      pendingChangeStatus: subscription.pendingChangeStatus || null,
    },
    application: application
      ? {
          id: String(application._id),
          userId: String(application.userId),
          vendorId: stringId(application.vendorId),
          planId: stringId(application.planId),
          status: String(application.status),
          paymentStatus: String(application.paymentStatus),
          stripePriceId:
            typeof application.planSnapshot?.stripePriceId === "string"
              ? application.planSnapshot.stripePriceId
              : null,
        }
      : null,
  };
}

const mongoBillingSyncContextLookup: BillingSyncContextLookup = {
  findByProviderReference(providerSubscriptionId, limit) {
    return VendorSubscription.find({
      provider: "stripe",
      paymentProviderRef: providerSubscriptionId,
    })
      .limit(limit)
      .lean<BillingSyncContextDocument[]>();
  },

  findByLocalSubscriptionId(localSubscriptionId) {
    return VendorSubscription.findOne({
      _id: localSubscriptionId,
      provider: "stripe",
    }).lean<BillingSyncContextDocument | null>();
  },

  findLegacyByApplicationId(applicationId, limit) {
    return VendorSubscription.find({
      applicationId,
      provider: "stripe",
      status: VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE,
    })
      .limit(limit)
      .lean<BillingSyncContextDocument[]>();
  },
};

function createMongoBillingSyncDependencies(): BillingSyncDependencies {
  return {
    async findContext(snapshot) {
      const metadataApplicationId =
        snapshot.subscription.metadata.applicationId;
      const subscription =
        await resolveVendorBillingContextSubscription(
          snapshot,
          mongoBillingSyncContextLookup,
        );
      if (!subscription) return null;

      const applicationId =
        stringId(subscription.applicationId) || metadataApplicationId;
      const application =
        applicationId && Types.ObjectId.isValid(applicationId)
          ? await VendorApplication.findById(applicationId).lean<
              BillingSyncContextDocument | null
            >()
          : null;
      if (
        applicationId != null &&
        (!application ||
          application.status !== VENDOR_APPLICATION_STATUS.APPROVED)
      ) {
        return null;
      }
      return contextFromDocuments(subscription, application);
    },

    async recordPayment(context, payment) {
      const saved = await VendorSubscriptionPayment.findOneAndUpdate(
        {
          provider: payment.provider,
          providerInvoiceId: payment.providerInvoiceId,
        },
        {
          $setOnInsert: {
            vendorId: context.subscription.vendorId,
            subscriptionId: context.subscription.id,
            applicationId: context.subscription.applicationId,
            provider: payment.provider,
            providerSubscriptionId: payment.providerSubscriptionId,
            providerInvoiceId: payment.providerInvoiceId,
          },
          $set: {
            providerPaymentIntentId: payment.providerPaymentIntentId,
            status: payment.status,
            amountDue: payment.amountDue,
            amountPaid: payment.amountPaid,
            amountRefunded: payment.amountRefunded,
            currency: payment.currency,
            periodStart: payment.periodStart,
            periodEnd: payment.periodEnd,
            attemptCount: payment.attemptCount,
            paidAt: payment.paidAt,
            failureCode: payment.failureCode,
            failureMessage: payment.failureMessage,
            providerCreatedAt: payment.providerCreatedAt,
            providerStateUpdatedAt: payment.providerStateUpdatedAt,
          },
        },
        { upsert: true, new: true },
      ).lean<{ _id: unknown } | null>();

      // Plan revenue. A subscription billed by the provider's own engine never
      // becomes a `PlatformPayment`, so without this every renewal on a store
      // using Stripe Billing was invisible to the profit and loss. Keyed on the
      // row this upsert just settled, so a re-delivered webhook posts nothing.
      if (!saved?._id) return;
      const { postSubscriptionInvoiceSafely } = await import(
        "@/lib/finance/post-events"
      );
      postSubscriptionInvoiceSafely({
        _id: saved._id,
        vendorId: context.subscription.vendorId,
        providerInvoiceId: payment.providerInvoiceId,
        status: payment.status,
        amountPaid: payment.amountPaid,
        amountRefunded: payment.amountRefunded,
        currency: payment.currency,
        paidAt: payment.paidAt,
        providerCreatedAt: payment.providerCreatedAt,
      });
    },

    async updateSubscription(context, patch) {
      if (patch.occupiesActiveSlot === true) {
        await VendorSubscription.updateMany(
          {
            _id: { $ne: context.subscription.id },
            vendorId: context.subscription.vendorId,
            occupiesActiveSlot: true,
          },
          {
            $set: {
              status: VENDOR_SUBSCRIPTION_STATUS.CANCELLED,
              occupiesActiveSlot: false,
            },
          },
        );
      }
      await VendorSubscription.updateOne(
        { _id: context.subscription.id },
        { $set: patch },
      );
      Object.assign(context.subscription, patch);
    },

    async updateApplication(context, patch) {
      if (!context.application) return;
      await VendorApplication.updateOne(
        { _id: context.application.id },
        { $set: patch },
      );
      Object.assign(context.application, patch);
    },

    async activateVendor(context, projection) {
      const result = await Vendor.updateOne(
        {
          _id: context.subscription.vendorId,
          $or: [
            { status: { $ne: VENDOR_STATUS.APPROVED } },
            { storeActive: { $ne: true } },
            { planId: { $ne: projection.planId } },
            { commission: { $ne: projection.commissionRate } },
          ],
        },
        {
          $set: {
            status: VENDOR_STATUS.APPROVED,
            storeActive: true,
            planId: projection.planId,
            commission: projection.commissionRate,
            stripeCustomerId: projection.stripeCustomerId,
          },
        },
      );

      // The owner's role is repaired on every activation, not only when the
      // vendor document above actually moved. Suspending a store demotes its
      // owner to customer; an activation that restored the vendor alone left
      // them locked out of /vendor/* while the storefront kept taking orders —
      // and since the vendor then read `approved` on both sides of every later
      // admin save, nothing downstream could ever heal it.
      //
      // Deliberately NOT mirrored in `deactivateVendor`: a lapsed payment has
      // to leave the role intact, or the vendor could not reach the payment
      // gate that fixes it. Losing the store is the payment-access layer's
      // decision (`resolveVendorPaymentAccess`), not the role's.
      const owner = await Vendor.findById(context.subscription.vendorId)
        .select("userId")
        .lean<{ userId?: unknown } | null>();
      await ensureVendorOwnerRole(owner?.userId).catch((error) => {
        console.error("Failed to sync vendor owner role on activation:", error);
      });

      return (result.modifiedCount ?? 0) > 0;
    },

    async deactivateVendor(context, revokeFinancialAccess = false) {
      const result = await Vendor.updateOne(
        {
          _id: context.subscription.vendorId,
          planId: context.subscription.planId,
        },
        {
          $set: {
            storeActive: false,
            planId: null,
            ...(revokeFinancialAccess
              ? { status: VENDOR_STATUS.SUSPENDED }
              : {}),
          },
        },
      );
      return (result.modifiedCount ?? 0) > 0;
    },

    async recordError(context, message) {
      await VendorSubscription.updateOne(
        { _id: context.subscription.id },
        { $set: { lastReconcileError: message.slice(0, 2000) } },
      );
    },
  };
}

function metadataMatches(
  context: BillingSyncContext,
  subscription: NormalizedStripeSubscription,
): boolean {
  const metadata = subscription.metadata;
  const applicationBacked = context.subscription.applicationId != null;
  const applicationMatches = applicationBacked
    ? context.application != null &&
      context.application.id === context.subscription.applicationId &&
      context.application.status === VENDOR_APPLICATION_STATUS.APPROVED &&
      metadata.applicationId === context.subscription.applicationId
    : metadata.applicationId == null;
  const userMatches = applicationBacked
    ? context.application != null &&
      metadata.userId === context.application.userId
    : metadata.userId != null;
  const vendorMatches =
    metadata.vendorId === context.subscription.vendorId &&
    (context.application?.vendorId == null ||
      metadata.vendorId === context.application.vendorId);
  const acceptedPlanIds = [
    context.subscription.planId,
    context.subscription.pendingPlanId,
  ].filter(Boolean);
  const planMatches =
    metadata.planId != null && acceptedPlanIds.includes(metadata.planId);
  const localSubscriptionMatches =
    metadata.localSubscriptionId == null ||
    metadata.localSubscriptionId === context.subscription.id;

  return (
    applicationMatches &&
    userMatches &&
    vendorMatches &&
    planMatches &&
    localSubscriptionMatches
  );
}

function paymentStatus(
  invoice: NormalizedStripeInvoice,
  failed: boolean,
): SubscriptionPaymentWrite["status"] {
  if (invoice.amountRefunded > 0 && invoice.amountRefunded >= invoice.amountPaid) {
    return "refunded";
  }
  if (invoice.status === "paid") return "paid";
  if (invoice.status === "void" || invoice.status === "uncollectible") {
    return "void";
  }
  return failed ? "failed" : "open";
}

function providerPatch(
  snapshot: VendorBillingSnapshot,
  now: Date,
  options: { preserveStripePriceId?: boolean } = {},
) {
  const subscription = snapshot.subscription;
  return {
    provider: "stripe",
    paymentProviderRef: subscription.id,
    stripeCustomerId: subscription.customerId,
    stripeSubscriptionItemId: subscription.subscriptionItemId,
    ...(options.preserveStripePriceId
      ? {}
      : { stripePriceId: subscription.priceId }),
    stripeLatestInvoiceId:
      snapshot.invoice?.id || subscription.latestInvoiceId,
    providerStatus: subscription.status,
    providerStateUpdatedAt: now,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    trialStart: subscription.trialStart,
    trialEnd: subscription.trialEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    lastReconciledAt: now,
    lastReconcileError: null,
  };
}

function paymentWrite(
  context: BillingSyncContext,
  snapshot: VendorBillingSnapshot,
  now: Date,
  failed: boolean,
): SubscriptionPaymentWrite | null {
  const invoice = snapshot.invoice;
  if (!invoice) return null;
  return {
    vendorId: context.subscription.vendorId,
    subscriptionId: context.subscription.id,
    applicationId: context.subscription.applicationId,
    provider: "stripe",
    providerSubscriptionId: snapshot.subscription.id,
    providerInvoiceId: invoice.id,
    providerPaymentIntentId: invoice.paymentIntentId,
    status: paymentStatus(invoice, failed),
    amountDue: invoice.amountDue,
    amountPaid: invoice.amountPaid,
    amountRefunded: invoice.amountRefunded,
    currency: invoice.currency,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    attemptCount: invoice.attemptCount,
    paidAt: invoice.paidAt,
    failureCode: invoice.failureCode,
    failureMessage: invoice.failureMessage,
    providerCreatedAt: invoice.providerCreatedAt,
    providerStateUpdatedAt: now,
  };
}

function emptyResult(reason: BillingSyncResult["reason"]): BillingSyncResult {
  return {
    subscriptionId: null,
    applicationId: null,
    vendorId: null,
    activated: false,
    deactivated: false,
    reason,
    notifications: [],
  };
}

export async function synchronizeVendorBilling(
  snapshot: VendorBillingSnapshot,
  options: BillingSyncOptions = {},
  dependencies: BillingSyncDependencies = createMongoBillingSyncDependencies(),
): Promise<BillingSyncResult> {
  const now = options.now ?? new Date();
  const context = await dependencies.findContext(snapshot);
  if (!context) return emptyResult("not_found");
  if (
    options.expectedSubscriptionId &&
    context.subscription.id !== options.expectedSubscriptionId
  ) {
    return emptyResult("candidate_mismatch");
  }

  const baseResult: BillingSyncResult = {
    subscriptionId: context.subscription.id,
    applicationId: context.subscription.applicationId,
    vendorId: context.subscription.vendorId,
    activated: false,
    deactivated: false,
    reason: "provider_updated",
    notifications: [],
  };

  if (!metadataMatches(context, snapshot.subscription)) {
    const hadAccess = subscriptionOccupiesSlot(
      context.subscription.status,
    );
    await dependencies.recordError(
      context,
      `Stripe subscription metadata mismatch for ${snapshot.subscription.id}`,
    );
    if (hadAccess) {
      await dependencies.updateSubscription(context, {
        status: VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE,
        occupiesActiveSlot: false,
      });
    }
    const deactivated = hadAccess
      ? await dependencies.deactivateVendor(context, true)
      : false;
    return {
      ...baseResult,
      deactivated,
      reason: "metadata_mismatch",
    };
  }

  const failed =
    options.eventType === "invoice.payment_failed" ||
    options.eventType === "invoice.payment_action_required" ||
    (snapshot.subscription.localStatus ===
      VENDOR_SUBSCRIPTION_STATUS.PAST_DUE &&
      snapshot.invoice?.status !== "paid");
  const payment = paymentWrite(context, snapshot, now, failed);
  if (payment) {
    await dependencies.recordPayment(context, payment);
  }

  const terminal =
    snapshot.subscription.localStatus ===
      VENDOR_SUBSCRIPTION_STATUS.CANCELLED ||
    snapshot.subscription.localStatus === VENDOR_SUBSCRIPTION_STATUS.EXPIRED;
  if (terminal) {
    const scheduledFreeDowngrade =
      context.subscription.pendingChangeType === "downgrade" &&
      context.subscription.pendingChangeStatus === "scheduled" &&
      context.subscription.pendingPlanId != null &&
      context.subscription.pendingPlanSnapshot?.billingInterval === "none";
    if (scheduledFreeDowngrade) {
      const freePlanId = context.subscription.pendingPlanId!;
      const freeSnapshot = context.subscription.pendingPlanSnapshot!;
      const freeCommission =
        context.subscription.pendingCommissionRateSnapshot ??
        context.subscription.commissionRateSnapshot;
      await dependencies.updateSubscription(context, {
        ...providerPatch(snapshot, now),
        provider: "manual",
        paymentProviderRef: null,
        stripePriceId: null,
        stripeSubscriptionItemId: null,
        providerStatus: "stripe_downgrade_completed",
        status: VENDOR_SUBSCRIPTION_STATUS.ACTIVE,
        occupiesActiveSlot: true,
        planId: freePlanId,
        planSnapshot: freeSnapshot,
        commissionRateSnapshot: freeCommission,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        pendingPlanId: null,
        pendingPlanSnapshot: null,
        pendingCommissionRateSnapshot: null,
        pendingChangeStatus: "applied",
        pendingChangeEffectiveAt: now,
      });
      await dependencies.activateVendor(context, {
        planId: freePlanId,
        commissionRate: freeCommission,
        stripeCustomerId: snapshot.subscription.customerId,
      });
      return {
        ...baseResult,
        reason: "activated",
        notifications: [
          {
            type: "downgrade_applied",
            key: `subscription:${snapshot.subscription.id}:downgrade:${freePlanId}`,
          },
        ],
      };
    }

    await dependencies.updateSubscription(context, {
      ...providerPatch(snapshot, now),
      status: snapshot.subscription.localStatus,
      occupiesActiveSlot: false,
      pendingChangeStatus:
        context.subscription.pendingChangeStatus === "scheduled"
          ? "expired"
          : context.subscription.pendingChangeStatus,
    });
    const deactivated = await dependencies.deactivateVendor(context);
    return {
      ...baseResult,
      deactivated,
      reason: "ended",
      notifications: [
        {
          type: "subscription_expired",
          key: `subscription:${snapshot.subscription.id}:ended`,
        },
      ],
    };
  }

  if (failed && snapshot.invoice) {
    const sameInvoice =
      context.subscription.failedInvoiceId === snapshot.invoice.id;
    const grace = invoiceFailureGrace(
      sameInvoice
        ? context.subscription.firstPaymentFailedAt
        : null,
      now,
    );
    await dependencies.updateSubscription(context, {
      ...providerPatch(snapshot, now),
      status: VENDOR_SUBSCRIPTION_STATUS.PAST_DUE,
      occupiesActiveSlot: subscriptionOccupiesSlot(
        VENDOR_SUBSCRIPTION_STATUS.PAST_DUE,
      ),
      firstPaymentFailedAt: grace.firstPaymentFailedAt,
      failedInvoiceId: snapshot.invoice.id,
      gracePeriodEnd: grace.gracePeriodEnd,
      nextRetryAt: null,
    });
    if (
      context.application &&
      context.application.paymentStatus !==
        VENDOR_APPLICATION_PAYMENT_STATUS.PAID
    ) {
      await dependencies.updateApplication(context, {
        paymentStatus: VENDOR_APPLICATION_PAYMENT_STATUS.FAILED,
        stripeLatestInvoiceId: snapshot.invoice.id,
        stripePaymentIntentId: snapshot.invoice.paymentIntentId,
        lastError: snapshot.invoice.failureMessage || "Stripe invoice payment failed",
      });
    }
    return {
      ...baseResult,
      reason: "payment_failed",
      notifications: [
        {
          type: "renewal_payment_failed",
          key: `invoice:${snapshot.invoice.id}:failed`,
        },
      ],
    };
  }

  const pendingPriceId =
    typeof context.subscription.pendingPlanSnapshot?.stripePriceId === "string"
      ? context.subscription.pendingPlanSnapshot.stripePriceId
      : null;
  // The trusted price is the one WE recorded when the plan was assigned — never
  // the price Stripe reports, or the price check would validate nothing.
  //
  // Vendor-initiated checkout resolves the Stripe price lazily (the plan may not
  // have had one at apply time) and writes it to the application snapshot. Older
  // rows created before that write reached the subscription snapshot have a null
  // here, which would strand a genuinely paid vendor as `incomplete`. The
  // application snapshot is admin-controlled and set at approval, so it is a
  // safe second source of the same trusted value.
  const assignedPriceId =
    typeof context.subscription.planSnapshot.stripePriceId === "string"
      ? context.subscription.planSnapshot.stripePriceId
      : context.application?.planId === context.subscription.planId
        ? context.application.stripePriceId
        : null;
  const applyingPending =
    Boolean(context.subscription.pendingPlanId) &&
    Boolean(pendingPriceId) &&
    pendingPriceId === snapshot.subscription.priceId;
  const expectedPriceId = applyingPending
    ? pendingPriceId
    : assignedPriceId;
  const priceMismatch =
    !expectedPriceId || expectedPriceId !== snapshot.subscription.priceId;
  const accessAllowed = canActivatePaidPlan({
    invoiceStatus: snapshot.invoice?.status,
    subscriptionStatus: snapshot.subscription.status,
    expectedPriceId,
    actualPriceId: snapshot.subscription.priceId,
    allowLegacyTrial:
      context.subscription.status === VENDOR_SUBSCRIPTION_STATUS.TRIALING,
  });

  if (!accessAllowed) {
    const hadAccess = subscriptionOccupiesSlot(context.subscription.status);
    const safeStatus = VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE;
    await dependencies.updateSubscription(context, {
      ...providerPatch(snapshot, now, {
        preserveStripePriceId: priceMismatch,
      }),
      status: safeStatus,
      occupiesActiveSlot: false,
    });
    const evidenceError = priceMismatch
      ? `Stripe subscription price ${snapshot.subscription.priceId || "missing"} does not match trusted price ${expectedPriceId || "missing"} for ${snapshot.subscription.id}`
      : `Stripe subscription ${snapshot.subscription.id} does not have paid activation evidence`;
    await dependencies.recordError(context, evidenceError);
    const deactivated = hadAccess
      ? await dependencies.deactivateVendor(context, true)
      : false;
    return {
      ...baseResult,
      deactivated,
      reason: hadAccess ? "access_revoked" : "provider_updated",
    };
  }

  const activePlanId = applyingPending
    ? context.subscription.pendingPlanId!
    : context.subscription.planId;
  const activeSnapshot = applyingPending
    ? context.subscription.pendingPlanSnapshot!
    : context.subscription.planSnapshot;
  const activeCommission =
    applyingPending &&
    context.subscription.pendingCommissionRateSnapshot != null
      ? context.subscription.pendingCommissionRateSnapshot
      : context.subscription.commissionRateSnapshot;
  const pendingType = context.subscription.pendingChangeType;

  await dependencies.updateSubscription(context, {
    ...providerPatch(snapshot, now),
    status: VENDOR_SUBSCRIPTION_STATUS.ACTIVE,
    occupiesActiveSlot: true,
    planId: activePlanId,
    planSnapshot: activeSnapshot,
    commissionRateSnapshot: activeCommission,
    lastPaymentAt: snapshot.invoice?.paidAt || now,
    firstPaymentFailedAt: null,
    failedInvoiceId: null,
    gracePeriodEnd: null,
    retryCount: 0,
    nextRetryAt: null,
    ...(applyingPending
      ? {
          pendingPlanId: null,
          pendingPlanSnapshot: null,
          pendingCommissionRateSnapshot: null,
          pendingChangeStatus: "applied",
          pendingChangeEffectiveAt: now,
          pendingStripeInvoiceId: snapshot.invoice?.id || null,
        }
      : {}),
  });
  if (context.application && snapshot.invoice) {
    await dependencies.updateApplication(context, {
      paymentStatus: VENDOR_APPLICATION_PAYMENT_STATUS.PAID,
      stripeSubscriptionId: snapshot.subscription.id,
      stripeLatestInvoiceId: snapshot.invoice.id,
      stripePaymentIntentId: snapshot.invoice.paymentIntentId,
      stripeProviderStatus: snapshot.subscription.status,
      paymentCompletedAt: snapshot.invoice.paidAt || now,
      paymentExpiredAt: null,
      setupAccessExpiredAt: null,
      trialEndedAt: null,
      lastError: null,
    });
  }
  const activated = await dependencies.activateVendor(context, {
    planId: activePlanId,
    commissionRate: activeCommission,
    stripeCustomerId: snapshot.subscription.customerId,
  });
  const notifications: BillingTransitionNotification[] = snapshot.invoice
    ? [
        {
          type: "payment_confirmed",
          key: `invoice:${snapshot.invoice.id}:paid`,
        },
      ]
    : [];
  if (activated) {
    notifications.push({
      type: "plan_activated",
      key: `subscription:${snapshot.subscription.id}:activated`,
    });
  }
  if (applyingPending && pendingType === "upgrade") {
    notifications.push({
      type: "upgrade_applied",
      key: `subscription:${snapshot.subscription.id}:upgrade:${activePlanId}`,
    });
  }
  if (applyingPending && pendingType === "downgrade") {
    notifications.push({
      type: "downgrade_applied",
      key: `subscription:${snapshot.subscription.id}:downgrade:${activePlanId}`,
    });
  }

  return {
    ...baseResult,
    activated,
    reason: "activated",
    notifications,
  };
}
