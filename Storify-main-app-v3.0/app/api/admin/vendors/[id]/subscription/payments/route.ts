import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Vendor, VendorSubscriptionPayment } from "@/models";
import { paginatedResponse, notFoundResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { getSettings } from "@/models/settings.model";
import { isDefaultVendorRecord } from "@/lib/vendors/multi-vendor";
import { fromStripeAmount } from "@/lib/payments/stripe";
import { withApi } from "@/lib/api/handler";

/**
 * GET /api/admin/vendors/[id]/subscription/payments
 *
 * Invoice history for a vendor's subscription. The vendor GET returns only the
 * single most recent payment, which is enough to render "last invoice: paid"
 * and nothing else — a vendor whose card has failed three months running looks
 * identical to one who has never been billed. The Payouts tab also reports
 * subscription fees as platform revenue, and this is the evidence behind that
 * number.
 *
 * Rows are keyed by `vendorId` (indexed as `{ vendorId, createdAt }`) rather
 * than by subscription, so a vendor who changed plans keeps one continuous
 * billing history instead of one per subscription record.
 */
export const GET = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "admin:vendors:subscription-payments",
      "lenient",
      session.user.role,
    );

    const { id } = params;
    if (!Types.ObjectId.isValid(id)) {
      return notFoundResponse("Vendor");
    }

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await Vendor.findById(id).select("isDefault slug").lean();
    if (!vendor || isDefaultVendorRecord(vendor)) {
      return notFoundResponse("Vendor");
    }

    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.min(
      50,
      Math.max(1, Number(url.searchParams.get("limit")) || 10),
    );

    const query = { vendorId: new Types.ObjectId(id) };
    const [payments, total] = await Promise.all([
      VendorSubscriptionPayment.find(query)
        .select(
          "providerInvoiceId status amountDue amountPaid amountRefunded currency periodStart periodEnd attemptCount paidAt failureCode failureMessage providerCreatedAt createdAt",
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
      _id: String(payment._id),
      providerInvoiceId: payment.providerInvoiceId,
      status: payment.status,
      // Stored in Stripe's smallest unit; the client formats major units.
      amountDue: fromStripeAmount(payment.amountDue ?? 0, payment.currency),
      amountPaid: fromStripeAmount(payment.amountPaid ?? 0, payment.currency),
      amountRefunded: fromStripeAmount(
        payment.amountRefunded ?? 0,
        payment.currency,
      ),
      currency: payment.currency,
      periodStart: payment.periodStart ?? null,
      periodEnd: payment.periodEnd ?? null,
      attemptCount: payment.attemptCount ?? 0,
      paidAt: payment.paidAt ?? null,
      failureMessage: payment.failureMessage ?? payment.failureCode ?? null,
      createdAt: payment.providerCreatedAt ?? payment.createdAt,
    }));

    return paginatedResponse(items, page, limit, total);
  },
);
