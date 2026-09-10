/**
 * GET /api/vendor/subscription/payments
 *
 * The signed-in vendor's own plan invoice history — the evidence behind the
 * billing page. GET /api/vendor/subscription returns the live subscription and
 * nothing else, so a vendor who has paid nine periods through three different
 * gateways could not see any of them; only an admin could, through the twin at
 * /api/admin/vendors/[id]/subscription/payments.
 *
 * The vendor is resolved from the session rather than from the path, so there
 * is no id here to tamper with: a vendor can only ever read their own history.
 *
 * Rows are keyed by `vendorId` (indexed as `{ vendorId, createdAt }`) rather
 * than by subscription, so a vendor who changed plans — or switched gateway,
 * which rewrites the live subscription's provider — keeps one continuous
 * billing history instead of one fragment per subscription record.
 */

import { withApi } from "@/lib/api/handler";
import { paginatedResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { VendorSubscriptionPayment } from "@/models";
import { fromStripeAmount } from "@/lib/payments/stripe";

export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:subscription:payments", preset: "lenient" },
  },
  async ({ request, session }) => {
    const settings = await getSettings();
    if (
      !settings.multiVendorMode?.enabled ||
      !settings.vendorConfig?.plansEnabled
    ) {
      throw new NotFoundError("Vendor plans");
    }

    // Setup-window vendors are allowed through: they have an unpaid first
    // period and the billing page is exactly where they go to look at it.
    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });

    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.min(
      50,
      Math.max(1, Number(url.searchParams.get("limit")) || 10),
    );

    const query = { vendorId: vendor._id };
    const [payments, total] = await Promise.all([
      VendorSubscriptionPayment.find(query)
        .select(
          "provider providerInvoiceId status amountDue amountPaid amountRefunded currency periodStart periodEnd paidAt failureCode failureMessage providerCreatedAt createdAt",
        )
        // `providerCreatedAt` is the invoice's own timestamp; `createdAt` is
        // when the webhook reached us, which can reorder a backfill.
        .sort({ providerCreatedAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      VendorSubscriptionPayment.countDocuments(query),
    ]);

    const items = payments.map((payment) => ({
      id: String(payment._id),
      provider: payment.provider,
      status: payment.status,
      // Stored in Stripe's smallest unit; the client formats major units.
      amountPaid: fromStripeAmount(payment.amountPaid ?? 0, payment.currency),
      amountDue: fromStripeAmount(payment.amountDue ?? 0, payment.currency),
      amountRefunded: fromStripeAmount(
        payment.amountRefunded ?? 0,
        payment.currency,
      ),
      currency: payment.currency,
      periodStart: payment.periodStart ?? null,
      periodEnd: payment.periodEnd ?? null,
      paidAt: payment.paidAt ?? null,
      // The provider's own failure text is safe to show the payer — it is the
      // reason their card was declined, and hiding it just sends them to
      // support to be told the same thing.
      failureMessage: payment.failureMessage ?? payment.failureCode ?? null,
      createdAt: payment.providerCreatedAt ?? payment.createdAt,
    }));

    return paginatedResponse(items, page, limit, total);
  },
);
