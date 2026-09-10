import { Vendor, VendorPlan, VendorSubscription } from "@/models";
import { findLatestVendorApplication } from "@/lib/vendors/vendor-application";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { isValidObjectId, validateOptionalBody } from "@/lib/api/validate";
import { auditUpdate, createAuditContext } from "@/lib/audit";
import { getSettings, type ISettings } from "@/models/settings.model";
import { connectDB } from "@/lib/db";
import { isDefaultVendorRecord } from "@/lib/vendors/multi-vendor";
import { resolveVendorCommission } from "@/lib/vendors/vendor-commission";
import {
  VENDOR_APPLICATION_PAYMENT_STATUS,
  VENDOR_APPLICATION_STATUS,
  VENDOR_BILLING_INTERVAL,
  VENDOR_PAYMENT_INVITATION,
  VENDOR_STATUS,
  VENDOR_SUBSCRIPTION_STATUS,
} from "@/config/app.config";
import { subscriptionOccupiesSlot } from "@/models/vendorSubscription.model";
import {
  buildSubscriptionForPlan,
  supersededStripeAssignmentFilter,
  supersededStripeAssignmentPatch,
} from "@/lib/vendors/vendor-subscriptions";
import { draftExcessProducts } from "@/lib/vendors/vendor-limits";
import {
  assertVendorBillingReady,
  resolveVendorBillingProviders,
} from "@/lib/vendors/vendor-billing-providers";
import { PLATFORM_PAYMENT_PROVIDER } from "@/config/app.config";
import { recordManualSubscriptionPayment } from "@/lib/vendors/vendor-subscription-payments";
import {
  assertStripeBillingReady,
  ensureStripePriceForVendorPlan,
} from "@/lib/vendors/vendor-plan-stripe";
import { getStripeForSecretKey } from "@/lib/payments/stripe";
import {
  stageVendorPlanChange,
  type TargetVendorPlan,
} from "@/lib/vendors/vendor-subscription-changes";
import {
  cancelStripeVendorScheduledChange,
  reverseStripeVendorCancellation,
  scheduleStripeVendorCancellation,
  scheduleStripeVendorDowngrade,
} from "@/lib/vendors/vendor-stripe-adapter";
import { synchronizeVendorBilling } from "@/lib/vendors/vendor-billing-sync";
import { dispatchVendorBillingNotifications } from "@/lib/vendors/vendor-billing-notifications";
import { z } from "zod";
import type { HydratedDocument } from "mongoose";
import type { IVendor } from "@/types";
import type { IVendorPlan } from "@/models/vendorPlan.model";
import type { IVendorSubscription } from "@/models/vendorSubscription.model";

type RouteParams = { id: string };

async function assertPlansEnabled() {
  await connectDB();
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled || !settings.vendorConfig?.plansEnabled) {
    throw new NotFoundError("Vendor plans");
  }
  return settings;
}

function paidPlan(plan: { billingInterval?: string; price?: number }) {
  return (
    plan.billingInterval !== VENDOR_BILLING_INTERVAL.NONE &&
    Number(plan.price ?? 0) > 0
  );
}

/** A plan as `toObject()` hands it over, possibly merged with synced Stripe fields. */
type PlanFields = Pick<IVendorPlan, "billingInterval"> &
  Partial<
    Pick<
      IVendorPlan,
      | "name"
      | "price"
      | "stripePriceCurrency"
    | "commissionRate"
    | "features"
    | "limits"
    | "capabilities"
    | "stripePriceId"
    | "stripeProductId"
    | "status"
  >
> & { _id?: unknown };

function targetPlan(
  plan: PlanFields,
  stripePriceId?: string | null,
): TargetVendorPlan {
  return {
    id: String(plan._id),
    name: String(plan.name),
    price: Number(plan.price ?? 0),
    billingInterval: String(plan.billingInterval),
    currency: String(plan.stripePriceCurrency || "USD"),
    commissionRate: Number(plan.commissionRate ?? 0),
    features: plan.features ?? [],
    limits: plan.limits ?? {},
    capabilities: plan.capabilities ?? {},
    stripePriceId: stripePriceId ?? plan.stripePriceId ?? null,
    status: String(plan.status),
  };
}

function applicationPlanSnapshot(
  plan: PlanFields,
  stripePriceId: string | null,
  fallbackCurrency = "USD",
) {
  return {
    name: String(plan.name),
    price: Number(plan.price),
    // Without a Stripe price sync (non-Stripe installs) the charge is
    // denominated in the store's default currency.
    currency: String(plan.stripePriceCurrency || fallbackCurrency),
    billingInterval: plan.billingInterval,
    commissionRate: Number(plan.commissionRate ?? 0),
    trialDays: 0,
    features: plan.features ?? [],
    limits: plan.limits ?? {},
    capabilities: plan.capabilities ?? {},
    stripeProductId: plan.stripeProductId ?? null,
    stripePriceId,
  };
}

async function stageInitialPaidAssignment(input: {
  vendor: HydratedDocument<IVendor>;
  plan: IVendorPlan;
  current: IVendorSubscription | null;
  actorId: string;
  settings: ISettings;
}) {
  const { vendor, plan, current, actorId, settings } = input;
  const application = await findLatestVendorApplication({
    vendorId: vendor._id,
    userId: vendor.userId,
  });
  if (!application) {
    throw new ValidationError(
      "Paid plan assignment requires the vendor application billing record",
    );
  }
  // Stripe price sync only when Stripe can actually collect — a
  // Paystack-only install must be able to stage a paid plan without Stripe
  // credentials (the vendor pays the first period through the platform
  // one-shot rail instead of a Stripe subscription).
  const stripeAvailable = resolveVendorBillingProviders(settings).includes(
    PLATFORM_PAYMENT_PROVIDER.STRIPE,
  );
  const stripeFields = stripeAvailable
    ? await ensureStripePriceForVendorPlan(plan, settings)
    : null;
  const stripePriceId = stripeFields?.stripePriceId ?? null;
  const now = new Date();

  // Does the vendor already hold a plan they are entitled to keep selling on
  // until the new one is paid for?
  //
  // Historically this covered only the free/manual plan, because a paid
  // non-Stripe subscription could not exist — paid rows were always Stripe, and
  // Stripe rows never reach this function (they take the non-disruptive
  // stageVendorPlanChange path). The one-shot rail changed that: a Paystack /
  // Pesapal / ioTec vendor can be live and fully paid, and treating them as a
  // brand-new onboarding took their store offline instantly and forfeited every
  // prepaid day.
  const prepaidUntil: Date | null =
    current?.status === VENDOR_SUBSCRIPTION_STATUS.ACTIVE &&
    current?.currentPeriodEnd &&
    current.currentPeriodEnd > now
      ? current.currentPeriodEnd
      : null;
  const keepsExistingPlan =
    current?.status === VENDOR_SUBSCRIPTION_STATUS.ACTIVE &&
    (current.provider === "manual" || Boolean(prepaidUntil));

  application.status = VENDOR_APPLICATION_STATUS.APPROVED;
  application.planId = plan._id;
  application.planSnapshot = applicationPlanSnapshot(
    { ...plan.toObject(), ...(stripeFields || {}) },
    stripePriceId,
    settings.general?.defaultCurrency || "USD",
  );
  application.paymentStatus = VENDOR_APPLICATION_PAYMENT_STATUS.PENDING;
  // The payment invitation must never expire before the prepaid period it sits
  // on top of: the invitation sweep deactivates the store when the deadline
  // lapses, which would repossess time the vendor already paid for.
  const invitationDeadline = new Date(
    now.getTime() +
      VENDOR_PAYMENT_INVITATION.DEADLINE_DAYS * 24 * 60 * 60 * 1000,
  );
  application.paymentDueAt =
    prepaidUntil && prepaidUntil > invitationDeadline
      ? prepaidUntil
      : invitationDeadline;
  application.paymentCompletedAt = null;
  application.paymentExpiredAt = null;
  application.setupAccessExpiredAt = null;
  application.paymentReminder3SentAt = null;
  application.paymentReminder6SentAt = null;
  application.lastError = null;
  await application.save();

  const payload = {
    ...buildSubscriptionForPlan(
      vendor._id,
      {
        ...plan.toObject(),
        // An admin placing a vendor on a paid plan is staging a payment, not
        // selling a trial: this whole function writes a payment-required
        // assignment (invitation deadline, `incomplete` row, store closed
        // unless a prepaid period covers it). Honouring the plan's trial days
        // here would produce a `trialing` row underneath that gate — and one
        // that collides with the vendor's existing live subscription for the
        // single active slot. `applicationPlanSnapshot` pins the same 0, so the
        // approval path reads the assignment as untrialled too.
        trialDays: 0,
        ...(stripeFields
          ? {
              stripePriceCurrency: stripeFields.stripePriceCurrency,
              stripePriceId,
            }
          : {}),
      },
      actorId,
      // Without a synced Stripe price the plan has no currency of its own, and
      // the one-shot rail collects renewals in whatever this snapshot says.
      { storeCurrency: settings.general?.defaultCurrency },
    ),
    applicationId: application._id,
    providerStatus: "not_started",
    stripePriceId,
  };
  let subscription = await VendorSubscription.findOne({
    vendorId: vendor._id,
    status: VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE,
    provider: "stripe",
  });
  if (subscription) {
    subscription.set(payload);
    await subscription.save();
  } else {
    subscription = await VendorSubscription.create(payload);
  }

  // Staging a paid plan supersedes any other pending Stripe attempt for this
  // vendor, so an abandoned earlier assignment cannot linger and make checkout
  // ambiguous. A live plan is untouched — the vendor keeps selling on it until
  // the new subscription is paid for, and recordOneShotSubscriptionPayment
  // retires the old row when it claims the active slot.
  await VendorSubscription.updateMany(
    supersededStripeAssignmentFilter({
      vendorId: vendor._id,
      keepSubscriptionId: subscription._id,
    }),
    { $set: supersededStripeAssignmentPatch() },
  );

  if (!keepsExistingPlan) {
    vendor.status = VENDOR_STATUS.PAYMENT_REQUIRED;
    vendor.storeActive = false;
    vendor.planId = null;
    vendor.commission = resolveVendorCommission(vendor, null, settings);
    vendor.commissionSource = "default";
    await vendor.save();
  }

  return { subscription, application, keepsExistingPlan, prepaidUntil };
}

const AssignPlanSchema = z.object({
  planId: z.string().max(64).optional(),
  activationMode: z.string().max(40).optional(),
});

export const POST = withApi<RouteParams>(
  {
    auth: "admin",
    rateLimit: { action: "admin:vendorSub:assign", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const settings = await assertPlansEnabled();
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Vendor");
    const body = await validateOptionalBody(request, AssignPlanSchema);
    const planId = typeof body.planId === "string" ? body.planId : "";
    if (!isValidObjectId(planId)) {
      throw new ValidationError({ planId: ["A valid plan is required"] });
    }

    const [vendor, plan] = await Promise.all([
      Vendor.findById(id),
      VendorPlan.findById(planId),
    ]);
    if (!vendor) return notFoundResponse("Vendor");
    if (!plan) return notFoundResponse("Plan");
    if (isDefaultVendorRecord(vendor)) {
      throw new ValidationError("The default store cannot be assigned a plan");
    }
    if (plan.status !== "active") {
      throw new ValidationError("This plan is archived and cannot be assigned");
    }

    const current = await VendorSubscription.findOne({
      vendorId: vendor._id,
      occupiesActiveSlot: true,
    }).sort({ createdAt: -1 });
    if (current && String(current.planId) === String(plan._id)) {
      throw new ValidationError("The vendor is already on this plan");
    }

    if (current?.provider === "stripe") {
      const stripe = getStripeForSecretKey(assertStripeBillingReady(settings));
      const target = targetPlan(plan.toObject());
      const staged = await stageVendorPlanChange(
        {
          id: String(current._id),
          planId: String(current.planId),
          provider: current.provider,
          providerSubscriptionId: current.paymentProviderRef,
          subscriptionItemId: current.stripeSubscriptionItemId ?? null,
          stripePriceId: current.stripePriceId ?? null,
          currentPeriodEnd: current.currentPeriodEnd ?? null,
          planSnapshot: {
            name: current.planSnapshot.name,
            price: current.planSnapshot.price,
            billingInterval: current.planSnapshot.billingInterval,
            currency: current.planSnapshot.currency,
            features: current.planSnapshot.features,
            limits: current.planSnapshot.limits,
            capabilities: current.planSnapshot.capabilities,
            stripePriceId: current.planSnapshot.stripePriceId,
          },
          commissionRateSnapshot: current.commissionRateSnapshot,
        },
        target,
        {
          async ensurePrice() {
            const fields = await ensureStripePriceForVendorPlan(plan, settings);
            return fields.stripePriceId;
          },
          async scheduleDowngrade(change) {
            if (!current.currentPeriodStart) {
              throw new ValidationError(
                "Stripe current period start is missing; run billing reconciliation first",
              );
            }
            return scheduleStripeVendorDowngrade(stripe, {
              subscriptionId: change.providerSubscriptionId,
              currentPriceId: change.currentPriceId,
              targetPriceId: change.targetPriceId,
              currentPeriodStart: current.currentPeriodStart,
              effectiveAt: change.effectiveAt,
              targetPlanId: change.targetPlanId,
            });
          },
          async scheduleFreePlanAtPeriodEnd(change) {
            await scheduleStripeVendorCancellation(
              stripe,
              change.providerSubscriptionId,
            );
            return { scheduleId: null };
          },
          async savePending(patch) {
            current.set(patch);
            await current.save();
          },
        },
      );
      return successResponse(
        { subscription: current.toObject(), staged },
        staged.changeType === "upgrade"
          ? "Upgrade staged. The vendor must confirm and pay before access changes."
          : "Downgrade scheduled for the current paid period end.",
      );
    }

    if (paidPlan(plan)) {
      // Any enabled subscription gateway may collect the first period.
      assertVendorBillingReady(settings);
      const staged = await stageInitialPaidAssignment({
        vendor,
        plan,
        current,
        actorId: session.user.id,
        settings,
      });
      return successResponse(
        {
          subscription: staged.subscription,
          paymentRequired: true,
          keepsExistingPlan: staged.keepsExistingPlan,
          prepaidUntil: staged.prepaidUntil
            ? staged.prepaidUntil.toISOString()
            : null,
        },
        staged.keepsExistingPlan
          ? staged.prepaidUntil
            ? "Paid plan staged. The vendor keeps their current plan until the prepaid period ends or the new plan is paid."
            : "Paid plan staged. The existing free plan remains active until payment."
          : "Paid plan assigned. The vendor must complete payment.",
        201,
      );
    }

    if (current) {
      current.status = VENDOR_SUBSCRIPTION_STATUS.CANCELLED;
      current.occupiesActiveSlot = false;
      await current.save();
    }
    const before = vendor.toObject();
    vendor.commission = resolveVendorCommission(vendor, plan, settings);
    // The plan states the rate now; a store-default sweep must not touch it.
    vendor.commissionSource = "plan";
    vendor.planId = plan._id;
    vendor.storeActive = true;
    await vendor.save();
    const subscription = await VendorSubscription.create(
      buildSubscriptionForPlan(vendor._id, plan, session.user.id, {
        activationMode:
          body.activationMode === "auto" || body.activationMode === "manual"
            ? body.activationMode
            : undefined,
        storeCurrency: settings.general?.defaultCurrency,
      }),
    );
    const draftResult = await draftExcessProducts(
      vendor._id,
      plan.limits?.products ?? null,
    );
    await auditUpdate(
      createAuditContext(request, session),
      "vendor",
      String(vendor._id),
      before as unknown as Record<string, unknown>,
      vendor.toObject() as unknown as Record<string, unknown>,
    );
    return successResponse(
      {
        subscription,
        vendor: vendor.toObject(),
        draftedProducts: draftResult.drafted,
      },
      "Free plan assigned",
      201,
    );
  },
);

export const DELETE = withApi<RouteParams>(
  {
    auth: "admin",
    rateLimit: { action: "admin:vendorSub:cancel", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const settings = await assertPlansEnabled();
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Vendor");
    const vendor = await Vendor.findById(id);
    if (!vendor) return notFoundResponse("Vendor");
    const subscription = await VendorSubscription.findOne({
      vendorId: vendor._id,
      occupiesActiveSlot: true,
    }).sort({ createdAt: -1 });
    if (!subscription) {
      return successResponse(
        { vendor: vendor.toObject() },
        "No active subscription to cancel",
      );
    }

    if (
      subscription.provider === "stripe" &&
      subscription.paymentProviderRef
    ) {
      const stripe = getStripeForSecretKey(assertStripeBillingReady(settings));
      const { snapshot, releasedScheduleId } =
        await scheduleStripeVendorCancellation(
          stripe,
          subscription.paymentProviderRef,
        );
      const result = await synchronizeVendorBilling(snapshot, {
        eventType: "admin.cancellation_scheduled",
      });
      await dispatchVendorBillingNotifications(result, settings);
      subscription.pendingChangeType = "cancel";
      subscription.pendingChangeStatus = "scheduled";
      subscription.pendingChangeEffectiveAt =
        snapshot.subscription.currentPeriodEnd;
      subscription.cancelAtPeriodEnd = true;
      // Cancelling at the period end supersedes anything staged to happen
      // after it, and the schedule describing it has just been released at
      // Stripe. Keeping the pending fields would advertise a plan change that
      // can no longer arrive.
      if (releasedScheduleId || subscription.pendingPlanId) {
        subscription.pendingPlanId = null;
        subscription.pendingPlanSnapshot = null;
        subscription.pendingCommissionRateSnapshot = null;
        subscription.stripeScheduleId = null;
      }
      await subscription.save();
      return successResponse(
        { subscription: subscription.toObject() },
        "Cancellation scheduled for the current paid period end",
      );
    }

    const before = vendor.toObject();
    subscription.status = VENDOR_SUBSCRIPTION_STATUS.CANCELLED;
    subscription.occupiesActiveSlot = subscriptionOccupiesSlot(
      VENDOR_SUBSCRIPTION_STATUS.CANCELLED,
    );
    await subscription.save();
    vendor.commission = resolveVendorCommission(vendor, null, settings);
    vendor.commissionSource = "default";
    vendor.planId = null;
    await vendor.save();
    await auditUpdate(
      createAuditContext(request, session),
      "vendor",
      String(vendor._id),
      before as unknown as Record<string, unknown>,
      vendor.toObject() as unknown as Record<string, unknown>,
    );
    return successResponse(
      { vendor: vendor.toObject() },
      "Free/manual subscription cancelled",
    );
  },
);

export const PATCH = withApi<RouteParams>(
  {
    auth: "admin",
    rateLimit: { action: "admin:vendorSub:cancelReverse", preset: "moderate" },
    demo: "block-mutations",
  },
  async ({ request, params, session }) => {
    const settings = await assertPlansEnabled();
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Vendor");

    const body = (await request.json().catch(() => null)) as {
      action?: string;
    } | null;

    // Offline payment / comp-extend: advance the period exactly the way a
    // gateway payment would, with a paid "manual" PlatformPayment behind it.
    if (body?.action === "record_payment") {
      const selection =
        "provider paymentProviderRef planSnapshot.billingInterval";
      type SubscriptionLookup = {
        _id: unknown;
        provider?: string;
        paymentProviderRef?: string | null;
        planSnapshot?: { billingInterval?: string } | null;
      } | null;
      // Must resolve to the SAME row the Subscription tab is displaying, or
      // the admin extends a plan they are not looking at. GET /admin/vendors/[id]
      // prefers the newest row when it is still incomplete (a freshly staged
      // plan awaiting its first payment) and otherwise shows the live one —
      // mirror that precedence exactly.
      //
      // Filtering on occupiesActiveSlot alone would also miss the single case
      // this lever exists for: an incomplete row does not occupy the slot, so a
      // vendor whose FIRST period is settled by bank transfer was unreachable.
      const latest = await VendorSubscription.findOne({ vendorId: id })
        .sort({ createdAt: -1 })
        .select(selection + " status")
        .lean<(SubscriptionLookup & { status?: string }) | null>();
      const subscription =
        latest?.status === VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE
          ? latest
          : ((await VendorSubscription.findOne({
              vendorId: id,
              occupiesActiveSlot: true,
            })
              .sort({ createdAt: -1 })
              .select(selection)
              .lean<SubscriptionLookup>()) ?? latest);
      if (!subscription) {
        throw new ValidationError("No subscription to extend");
      }
      // Refuse only when Stripe is genuinely billing this vendor. A paid
      // incomplete row also carries provider "stripe" as a placeholder (see
      // buildSubscriptionForPlan) with no Stripe subscription behind it —
      // that is exactly the first-period bank transfer this lever is for.
      if (subscription.provider === "stripe" && subscription.paymentProviderRef) {
        throw new ValidationError(
          "Stripe subscriptions bill through Stripe — record offline payments only for non-Stripe plans",
        );
      }
      if (
        !subscription.planSnapshot?.billingInterval ||
        subscription.planSnapshot.billingInterval === "none"
      ) {
        throw new ValidationError("Free plans have no billing period to extend");
      }
      const periodBefore = await VendorSubscription.findById(subscription._id)
        .select("currentPeriodEnd")
        .lean<{ currentPeriodEnd?: Date | null } | null>()
        .then((row) => row?.currentPeriodEnd ?? null);
      const { periodEnd } = await recordManualSubscriptionPayment({
        subscriptionId: String(subscription._id),
        adminUserId: session.user.id,
      });
      // Filed against the subscription, with its real id — not against the
      // vendor with a fabricated "before" state. `vendorSubscription` exists in
      // the audit enum precisely for this.
      await auditUpdate(
        createAuditContext(request, session),
        "vendorSubscription",
        String(subscription._id),
        {
          vendorId: id,
          currentPeriodEnd: periodBefore ? periodBefore.toISOString() : null,
        },
        {
          vendorId: id,
          action: "subscription_record_payment",
          currentPeriodEnd: periodEnd ? periodEnd.toISOString() : null,
        },
      );
      return successResponse(
        { periodEnd: periodEnd ? periodEnd.toISOString() : null },
        "Payment recorded — the subscription period was extended",
      );
    }

    // Drop a staged plan change and leave the vendor on the plan they are
    // paying for. Distinct from reversing a cancellation below: a downgrade to
    // a free plan is staged as a period-end cancellation, so the flag alone
    // cannot tell "the vendor is leaving" from "the vendor is moving to a
    // cheaper plan", and undoing the wrong one strands them on a plan the
    // admin already replaced.
    if (body?.action === "cancel_scheduled_change") {
      const staged = await VendorSubscription.findOne({
        vendorId: id,
        occupiesActiveSlot: true,
        pendingChangeType: "downgrade",
        pendingChangeStatus: "scheduled",
      }).sort({ createdAt: -1 });
      if (!staged) {
        throw new ValidationError("No scheduled plan change was found");
      }
      if (staged.provider === "stripe" && staged.paymentProviderRef) {
        const stripe = getStripeForSecretKey(assertStripeBillingReady(settings));
        const snapshot = await cancelStripeVendorScheduledChange(
          stripe,
          staged.paymentProviderRef,
        );
        await synchronizeVendorBilling(snapshot, {
          eventType: "admin.scheduled_change_cancelled",
        });
      }
      staged.pendingPlanId = null;
      staged.pendingPlanSnapshot = null;
      staged.pendingCommissionRateSnapshot = null;
      staged.pendingChangeType = null;
      staged.pendingChangeStatus = null;
      staged.pendingChangeEffectiveAt = null;
      staged.stripeScheduleId = null;
      staged.cancelAtPeriodEnd = false;
      await staged.save();
      return successResponse(
        { subscription: staged.toObject() },
        "Scheduled plan change cancelled — the vendor stays on their current plan",
      );
    }

    const subscription = await VendorSubscription.findOne({
      vendorId: id,
      provider: "stripe",
      occupiesActiveSlot: true,
      cancelAtPeriodEnd: true,
    });
    if (!subscription?.paymentProviderRef) {
      throw new ValidationError("No scheduled Stripe cancellation was found");
    }
    if (
      subscription.pendingChangeType === "downgrade" &&
      subscription.pendingChangeStatus === "scheduled"
    ) {
      throw new ValidationError(
        "A plan downgrade is scheduled for this vendor, not a cancellation — cancel the scheduled change instead",
      );
    }
    const stripe = getStripeForSecretKey(assertStripeBillingReady(settings));
    const snapshot = await reverseStripeVendorCancellation(
      stripe,
      subscription.paymentProviderRef,
    );
    await synchronizeVendorBilling(snapshot, {
      eventType: "admin.cancellation_reversed",
    });
    subscription.cancelAtPeriodEnd = false;
    subscription.pendingChangeType = null;
    subscription.pendingChangeStatus = null;
    subscription.pendingChangeEffectiveAt = null;
    await subscription.save();
    return successResponse(
      { subscription: subscription.toObject() },
      "Scheduled cancellation reversed",
    );
  },
);
