import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import {
  VendorSubscription,
  VendorSubscriptionPayment,
} from "@/models";
import { getSettings } from "@/models/settings.model";
import { assertStripeBillingReady } from "@/lib/vendors/vendor-plan-stripe";
import { getStripeForSecretKey } from "@/lib/payments/stripe";
import {
  normalizeStripeInvoice,
  retrieveVendorBillingSnapshot,
} from "@/lib/vendors/vendor-stripe-adapter";
import {
  backfillVendorBilling,
  type VendorBillingMigrationDependencies,
} from "@/lib/vendors/vendor-billing-migration";

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function paymentStatus(invoice: {
  status: string | null;
  amountPaid: number;
  amountRefunded: number;
}) {
  if (
    invoice.amountRefunded > 0 &&
    invoice.amountRefunded >= invoice.amountPaid
  ) {
    return "refunded";
  }
  if (invoice.status === "paid") return "paid";
  if (invoice.status === "void" || invoice.status === "uncollectible") {
    return "void";
  }
  return "open";
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const batchSize = Number(argument("batch-size") || 100);
  const after = argument("after");

  await connectDB();
  const settings = await getSettings();
  const stripe = getStripeForSecretKey(assertStripeBillingReady(settings));

  const dependencies: VendorBillingMigrationDependencies = {
    async listSubscriptions(cursor, limit) {
      const query: Record<string, unknown> = { provider: "stripe" };
      if (cursor && Types.ObjectId.isValid(cursor)) {
        query._id = { $gt: new Types.ObjectId(cursor) };
      }
      const rows = await VendorSubscription.find(query)
        .sort({ _id: 1 })
        .limit(limit)
        .select("vendorId applicationId paymentProviderRef")
        .lean<
          Array<{
            _id: unknown;
            vendorId: unknown;
            applicationId?: unknown;
            paymentProviderRef?: string | null;
          }>
        >();
      return {
        rows: rows.map((row) => ({
          id: String(row._id),
          vendorId: String(row.vendorId),
          applicationId: row.applicationId
            ? String(row.applicationId)
            : null,
          providerSubscriptionId: row.paymentProviderRef || null,
        })),
        nextCursor:
          rows.length === limit
            ? String(rows[rows.length - 1]._id)
            : null,
      };
    },

    retrieveSnapshot(providerSubscriptionId) {
      return retrieveVendorBillingSnapshot(
        stripe,
        providerSubscriptionId,
      );
    },

    async listInvoices(providerSubscriptionId) {
      const invoices = [];
      let startingAfter: string | undefined;
      do {
        const page = await stripe.invoices.list({
          subscription: providerSubscriptionId,
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        invoices.push(...page.data.map(normalizeStripeInvoice));
        startingAfter =
          page.has_more && page.data.length > 0
            ? page.data[page.data.length - 1].id
            : undefined;
      } while (startingAfter);
      return invoices;
    },

    async updateSubscription(row, patch) {
      await VendorSubscription.updateOne(
        { _id: row.id },
        { $set: patch },
      );
    },

    async upsertPayment(payment) {
      const invoice = payment.invoice;
      await VendorSubscriptionPayment.updateOne(
        {
          provider: "stripe",
          providerInvoiceId: invoice.id,
        },
        {
          $setOnInsert: {
            vendorId: payment.row.vendorId,
            subscriptionId: payment.row.id,
            applicationId: payment.row.applicationId,
            provider: "stripe",
            providerSubscriptionId:
              payment.providerSubscriptionId,
            providerInvoiceId: invoice.id,
          },
          $set: {
            providerPaymentIntentId: invoice.paymentIntentId,
            status: paymentStatus(invoice),
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
            providerStateUpdatedAt:
              payment.providerStateUpdatedAt,
          },
        },
        { upsert: true },
      );
    },
  };

  const report = await backfillVendorBilling({
    dryRun,
    batchSize,
    after,
    dependencies,
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
