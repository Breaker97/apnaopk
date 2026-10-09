import type { VendorBillingSnapshot } from "@/lib/vendors/vendor-billing-sync";
import type { NormalizedStripeInvoice } from "@/lib/vendors/vendor-stripe-adapter";

interface VendorBillingMigrationRow {
  id: string;
  vendorId: string;
  applicationId: string | null;
  providerSubscriptionId: string | null;
}

interface VendorBillingMigrationPayment {
  row: VendorBillingMigrationRow;
  invoice: NormalizedStripeInvoice;
  providerSubscriptionId: string;
  providerStateUpdatedAt: Date;
}

export interface VendorBillingMigrationDependencies {
  listSubscriptions(
    cursor: string | null,
    limit: number,
  ): Promise<{
    rows: VendorBillingMigrationRow[];
    nextCursor: string | null;
  }>;
  retrieveSnapshot(
    providerSubscriptionId: string,
  ): Promise<VendorBillingSnapshot>;
  listInvoices(
    providerSubscriptionId: string,
  ): Promise<NormalizedStripeInvoice[]>;
  updateSubscription(
    row: VendorBillingMigrationRow,
    patch: Record<string, unknown>,
  ): Promise<void>;
  upsertPayment(payment: VendorBillingMigrationPayment): Promise<void>;
}

interface VendorBillingMigrationReport {
  dryRun: boolean;
  scanned: number;
  subscriptionsNeedingUpdate: number;
  updated: number;
  invoicesFound: number;
  paymentsUpserted: number;
  missingProviderReferences: string[];
  errors: Array<{ subscriptionId: string; message: string }>;
}

export async function backfillVendorBilling(input: {
  dryRun: boolean;
  dependencies: VendorBillingMigrationDependencies;
  batchSize?: number;
  after?: string | null;
}): Promise<VendorBillingMigrationReport> {
  const { dependencies, dryRun } = input;
  const batchSize = Math.min(Math.max(input.batchSize ?? 100, 1), 500);
  const report: VendorBillingMigrationReport = {
    dryRun,
    scanned: 0,
    subscriptionsNeedingUpdate: 0,
    updated: 0,
    invoicesFound: 0,
    paymentsUpserted: 0,
    missingProviderReferences: [],
    errors: [],
  };
  let cursor = input.after ?? null;

  do {
    const page = await dependencies.listSubscriptions(cursor, batchSize);
    for (const row of page.rows) {
      report.scanned += 1;
      if (!row.providerSubscriptionId) {
        report.missingProviderReferences.push(row.id);
        continue;
      }
      try {
        const snapshot = await dependencies.retrieveSnapshot(
          row.providerSubscriptionId,
        );
        const now = new Date();
        const patch = {
          stripeCustomerId: snapshot.subscription.customerId,
          stripeSubscriptionItemId:
            snapshot.subscription.subscriptionItemId,
          stripePriceId: snapshot.subscription.priceId,
          stripeLatestInvoiceId:
            snapshot.invoice?.id ||
            snapshot.subscription.latestInvoiceId,
          providerStatus: snapshot.subscription.status,
          providerStateUpdatedAt: now,
          currentPeriodStart:
            snapshot.subscription.currentPeriodStart,
          currentPeriodEnd: snapshot.subscription.currentPeriodEnd,
          trialStart: snapshot.subscription.trialStart,
          trialEnd: snapshot.subscription.trialEnd,
          cancelAtPeriodEnd:
            snapshot.subscription.cancelAtPeriodEnd,
          lastReconciledAt: now,
          lastReconcileError: null,
        };
        report.subscriptionsNeedingUpdate += 1;
        if (!dryRun) {
          await dependencies.updateSubscription(row, patch);
          report.updated += 1;
        }

        const invoices = await dependencies.listInvoices(
          row.providerSubscriptionId,
        );
        report.invoicesFound += invoices.length;
        if (!dryRun) {
          for (const invoice of invoices) {
            await dependencies.upsertPayment({
              row,
              invoice,
              providerSubscriptionId: row.providerSubscriptionId,
              providerStateUpdatedAt: now,
            });
            report.paymentsUpserted += 1;
          }
        }
      } catch (error) {
        report.errors.push({
          subscriptionId: row.id,
          message: (
            error instanceof Error ? error.message : String(error)
          ).slice(0, 2000),
        });
      }
    }
    cursor = page.nextCursor;
  } while (cursor);

  return report;
}
