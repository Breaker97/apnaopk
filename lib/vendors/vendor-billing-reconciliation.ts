import type Stripe from "stripe";
import type { ISettings } from "@/models/settings.model";
import { VendorApplication, VendorSubscription } from "@/models";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import {
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
} from "@/lib/payments/stripe";
import {
  retrieveCheckoutBillingSnapshot,
  retrieveVendorBillingSnapshot,
  type VendorBillingSnapshot,
} from "@/lib/vendors/vendor-stripe-adapter";
import {
  synchronizeVendorBilling,
  type BillingSyncResult,
} from "@/lib/vendors/vendor-billing-sync";
import { dispatchVendorBillingNotifications } from "@/lib/vendors/vendor-billing-notifications";
import { isVendorApplicationCheckoutSession } from "@/lib/vendors/vendor-stripe-billing";
import { ValidationError } from "@/lib/api/errors";

export interface StripeBillingReconciliationCandidate {
  id: string;
  applicationId: string | null;
  providerSubscriptionId: string | null;
  checkoutSessionId: string | null;
  gracePeriodEnd: Date | null;
  failedInvoiceId: string | null;
}

export interface StripeBillingReconciliationDependencies {
  listCandidates(
    query: Record<string, unknown>,
    limit: number,
  ): Promise<StripeBillingReconciliationCandidate[]>;
  retrieve(
    candidate: StripeBillingReconciliationCandidate,
  ): Promise<VendorBillingSnapshot>;
  synchronize(
    snapshot: VendorBillingSnapshot,
    candidate: StripeBillingReconciliationCandidate,
  ): Promise<BillingSyncResult>;
  cancel(subscriptionId: string): Promise<VendorBillingSnapshot>;
  notify(result: BillingSyncResult): Promise<void>;
  markSuccess(id: string, now: Date): Promise<void>;
  markError(id: string, error: unknown): Promise<void>;
}

interface StripeBillingReconciliationSummary {
  scanned: number;
  synchronized: number;
  activated: number;
  expired: number;
  deactivated: number;
  errors: number;
}

interface StripeBillingReconciliationCandidateLookup {
  listSubscriptions(
    query: Record<string, unknown>,
    limit: number,
  ): Promise<Array<Record<string, unknown>>>;
  listApplications(
    applicationIds: string[],
  ): Promise<Array<Record<string, unknown>>>;
}

export function vendorBillingReconciliationQuery(
  now: Date,
): Record<string, unknown> {
  const recent = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  return {
    provider: "stripe",
    $or: [
      { status: { $in: ["incomplete", "past_due"] } },
      {
        pendingChangeStatus: {
          $in: ["awaiting_vendor", "awaiting_payment", "scheduled", "failed"],
        },
      },
      {
        status: "active",
        currentPeriodEnd: { $lte: now },
      },
      {
        lastReconcileError: { $ne: null },
        updatedAt: { $gte: recent },
      },
      {
        providerStateUpdatedAt: { $gte: recent },
      },
      {
        paymentProviderRef: null,
      },
    ],
  };
}

export async function listStripeBillingReconciliationCandidates(
  query: Record<string, unknown>,
  limit: number,
  lookup: StripeBillingReconciliationCandidateLookup,
): Promise<StripeBillingReconciliationCandidate[]> {
  const rows = await lookup.listSubscriptions(query, limit);
  const missingApplicationIds = [
    ...new Set(
      rows
        .filter(
          (row) =>
            !row.paymentProviderRef &&
            !row.stripeCheckoutSessionId &&
            row.applicationId,
        )
        .map((row) => String(row.applicationId)),
    ),
  ];
  const applications =
    missingApplicationIds.length > 0
      ? await lookup.listApplications(missingApplicationIds)
      : [];
  const applicationSessions = new Map(
    applications.map((application) => [
      String(application._id),
      application.stripeCheckoutSessionId
        ? String(application.stripeCheckoutSessionId)
        : null,
    ]),
  );

  return rows.map((row) => {
    const applicationId = row.applicationId
      ? String(row.applicationId)
      : null;
    return {
      id: String(row._id),
      applicationId,
      providerSubscriptionId: row.paymentProviderRef
        ? String(row.paymentProviderRef)
        : null,
      checkoutSessionId: row.stripeCheckoutSessionId
        ? String(row.stripeCheckoutSessionId)
        : applicationId
          ? applicationSessions.get(applicationId) ?? null
          : null,
      gracePeriodEnd: (row.gracePeriodEnd as Date | null | undefined) || null,
      failedInvoiceId: row.failedInvoiceId
        ? String(row.failedInvoiceId)
        : null,
    };
  });
}

export async function retrieveCandidateBillingSnapshot(
  stripe: Stripe,
  candidate: StripeBillingReconciliationCandidate,
): Promise<VendorBillingSnapshot> {
  if (candidate.providerSubscriptionId) {
    return retrieveVendorBillingSnapshot(
      stripe,
      candidate.providerSubscriptionId,
      candidate.failedInvoiceId,
    );
  }
  if (!candidate.checkoutSessionId) {
    throw new Error(
      "Stripe subscription and Checkout Session references are missing",
    );
  }
  const session = await stripe.checkout.sessions.retrieve(
    candidate.checkoutSessionId,
  );
  if (
    session.status !== "complete" ||
    session.mode !== "subscription" ||
    !isVendorApplicationCheckoutSession(session)
  ) {
    throw new Error(
      "Saved vendor Checkout Session is not a completed subscription",
    );
  }
  if (
    session.metadata?.applicationId !== candidate.applicationId ||
    (session.metadata.localSubscriptionId != null &&
      session.metadata.localSubscriptionId !== candidate.id)
  ) {
    throw new Error(
      "Saved vendor Checkout Session identity does not match the billing candidate",
    );
  }
  const snapshot = await retrieveCheckoutBillingSnapshot(stripe, session);
  if (!snapshot) {
    throw new Error("Completed vendor Checkout has no Stripe subscription");
  }
  if (
    snapshot.subscription.metadata.applicationId !== candidate.applicationId ||
    (snapshot.subscription.metadata.localSubscriptionId != null &&
      snapshot.subscription.metadata.localSubscriptionId !== candidate.id)
  ) {
    throw new Error(
      "Recovered Stripe subscription identity does not match the billing candidate",
    );
  }
  return snapshot;
}

const mongoCandidateLookup: StripeBillingReconciliationCandidateLookup = {
  listSubscriptions(query, limit) {
    return VendorSubscription.find(query)
      .sort({
        gracePeriodEnd: 1,
        currentPeriodEnd: 1,
        updatedAt: 1,
      })
      .limit(limit)
      .select(
        "applicationId paymentProviderRef stripeCheckoutSessionId gracePeriodEnd failedInvoiceId",
      )
      .lean<Array<Record<string, unknown>>>();
  },

  listApplications(applicationIds) {
    return VendorApplication.find({ _id: { $in: applicationIds } })
      .select("_id stripeCheckoutSessionId")
      .lean<Array<Record<string, unknown>>>();
  },
};

function createDefaultDependencies(
  settings: Partial<ISettings>,
  now: Date,
): StripeBillingReconciliationDependencies {
  const stripeSettings = settings.payment?.stripe;
  const secretKey = resolveStripeCredentials(stripeSettings).secretKey;
  const stripe =
    stripeSettings?.enabled && isStripeSecretKeyConfigured(secretKey)
      ? getStripeForSecretKey(secretKey)
      : null;

  return {
    listCandidates(query, limit) {
      return listStripeBillingReconciliationCandidates(
        query,
        limit,
        mongoCandidateLookup,
      );
    },

    retrieve(candidate) {
      if (!stripe) {
        throw new ValidationError(
          "Stripe vendor billing reconciliation requires enabled Stripe credentials",
        );
      }
      return retrieveCandidateBillingSnapshot(stripe, candidate);
    },

    synchronize(snapshot, candidate) {
      return synchronizeVendorBilling(snapshot, {
        eventType: "reconciliation",
        now,
        expectedSubscriptionId: candidate.id,
      });
    },

    async cancel(subscriptionId) {
      if (!stripe) {
        throw new ValidationError(
          "Stripe vendor billing cancellation requires enabled Stripe credentials",
        );
      }
      await stripe.subscriptions.cancel(subscriptionId, {
        invoice_now: false,
        prorate: false,
      });
      return retrieveVendorBillingSnapshot(stripe, subscriptionId);
    },

    notify(result) {
      return dispatchVendorBillingNotifications(result, settings);
    },

    async markSuccess(id, reconciledAt) {
      await VendorSubscription.updateOne(
        { _id: id },
        {
          $set: {
            lastReconciledAt: reconciledAt,
            lastReconcileError: null,
          },
        },
      );
    },

    async markError(id, error) {
      await VendorSubscription.updateOne(
        { _id: id },
        {
          $set: {
            lastReconciledAt: now,
            lastReconcileError: (
              error instanceof Error ? error.message : String(error)
            ).slice(0, 2000),
          },
        },
      );
    },
  };
}

function isUnpaidFailedInvoice(
  candidate: StripeBillingReconciliationCandidate,
  snapshot: VendorBillingSnapshot,
  now: Date,
): boolean {
  return Boolean(
    candidate.gracePeriodEnd &&
      candidate.gracePeriodEnd <= now &&
      candidate.failedInvoiceId &&
      snapshot.invoice?.id === candidate.failedInvoiceId &&
      snapshot.invoice.status !== "paid" &&
      snapshot.subscription.status !== "canceled" &&
      snapshot.subscription.status !== "incomplete_expired",
  );
}

function assertTrustedCandidateSynchronization(
  candidate: StripeBillingReconciliationCandidate,
  result: BillingSyncResult,
): void {
  const trustedReasons: BillingSyncResult["reason"][] = [
    "provider_updated",
    "access_revoked",
    "payment_failed",
    "activated",
    "ended",
  ];
  if (
    result.subscriptionId !== candidate.id ||
    !trustedReasons.includes(result.reason)
  ) {
    throw new Error(
      `Stripe billing synchronization did not resolve trusted candidate ${candidate.id}`,
    );
  }
}

export async function reconcileStripeVendorSubscriptions(
  settings: Partial<ISettings>,
  limit = 100,
  now: Date = new Date(),
  dependencies?: StripeBillingReconciliationDependencies,
): Promise<StripeBillingReconciliationSummary> {
  const deps = dependencies ?? createDefaultDependencies(settings, now);
  const candidates = await deps.listCandidates(
    vendorBillingReconciliationQuery(now),
    limit,
  );
  const summary: StripeBillingReconciliationSummary = {
    scanned: candidates.length,
    synchronized: 0,
    activated: 0,
    expired: 0,
    deactivated: 0,
    errors: 0,
  };

  for (const candidate of candidates) {
    try {
      const current = await deps.retrieve(candidate);
      const currentResult = await deps.synchronize(current, candidate);
      let preserveReconcileDiagnostic =
        currentResult.reason === "access_revoked";
      assertTrustedCandidateSynchronization(candidate, currentResult);
      await deps.notify(currentResult);
      summary.synchronized += 1;
      if (currentResult.activated) summary.activated += 1;
      if (currentResult.deactivated) summary.deactivated += 1;

      if (isUnpaidFailedInvoice(candidate, current, now)) {
        const latest = await deps.retrieve(candidate);
        const latestResult = await deps.synchronize(latest, candidate);
        preserveReconcileDiagnostic =
          preserveReconcileDiagnostic ||
          latestResult.reason === "access_revoked";
        assertTrustedCandidateSynchronization(candidate, latestResult);
        await deps.notify(latestResult);
        if (latestResult.activated) summary.activated += 1;
        if (latestResult.deactivated) summary.deactivated += 1;

        if (isUnpaidFailedInvoice(candidate, latest, now)) {
          const cancelled = await deps.cancel(latest.subscription.id);
          const cancelledResult = await deps.synchronize(
            cancelled,
            candidate,
          );
          assertTrustedCandidateSynchronization(
            candidate,
            cancelledResult,
          );
          await deps.notify(cancelledResult);
          summary.expired += 1;
          if (cancelledResult.deactivated) summary.deactivated += 1;
        }
      }

      if (!preserveReconcileDiagnostic) {
        await deps.markSuccess(candidate.id, now);
      }
    } catch (error) {
      summary.errors += 1;
      await deps.markError(candidate.id, error);
      console.error(
        "Vendor Stripe billing reconciliation failed",
        candidate.id,
        error,
      );
    }
  }

  return summary;
}
