import { Types } from "mongoose";

import {
  PLATFORM_PAYMENT_KIND,
  PLATFORM_PAYMENT_PROVIDER,
  PLATFORM_PAYMENT_STATUS,
} from "@/config/app.config";
import { withApi } from "@/lib/api/handler";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { isValidObjectId, validateOptionalBody } from "@/lib/api/validate";
import { connectDB } from "@/lib/db";
import { isDefaultVendorRecord } from "@/lib/vendors/multi-vendor";
import {
  commissionOwedForVendor,
  createCommissionInvoice,
  releaseCommissionInvoice,
} from "@/lib/finance/commission-invoices";
import { finalizePlatformPayment } from "@/lib/payments/platform-payments";
import { Vendor } from "@/models";
import {
  COMMISSION_INVOICE_STATUS,
  CommissionInvoice,
} from "@/models/commissionInvoice.model";
import { PlatformPayment } from "@/models/platformPayment.model";
import { getSettings } from "@/models/settings.model";
import { z } from "zod";

/**
 * Commission the platform is owed by one vendor, and the invoices raised for it.
 *
 * Payouts move money the platform holds; this is the other direction, and it
 * only exists because a cash sale never reaches the platform at all — there is
 * no payout to net the commission off. See `lib/commission-invoices.ts`.
 *
 * Recording an off-system collection goes through `finalizePlatformPayment` on
 * a real attempt row rather than flipping the invoice directly, so an admin
 * marking a bank transfer received and a vendor paying by card later settle the
 * sales down exactly one code path.
 */

async function requireBillableVendor(id: string) {
  if (!isValidObjectId(id)) throw new NotFoundError("Vendor");

  await connectDB();
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

  const vendor = await Vendor.findById(id).select("isDefault slug").lean();
  // The house store is never billed a commission, so it can never owe any.
  if (!vendor || isDefaultVendorRecord(vendor)) throw new NotFoundError("Vendor");

  return { settings };
}

const CommissionInvoiceSchema = z.object({ note: z.string().max(2000).optional() });

export const GET = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ params }) => {
    const { id } = params;
    const { settings } = await requireBillableVendor(id);

    const storeCurrency = String(
      settings.general?.defaultCurrency || "USD",
    ).toUpperCase();
    const [owed, invoices] = await Promise.all([
      // Scoped to the currency an invoice would actually be raised in. Owed
      // balances in any other currency ride along in `owed.otherCurrencies`
      // rather than being folded into this figure.
      commissionOwedForVendor(id, storeCurrency),
      CommissionInvoice.find({ vendorId: new Types.ObjectId(id) })
        .select("amount currency status paidAt orderIds note createdAt")
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
    ]);

    return successResponse({
      currency: storeCurrency,
      owed,
      invoices: invoices.map((invoice) => ({
        id: String(invoice._id),
        amount: invoice.amount,
        currency: invoice.currency,
        status: invoice.status,
        paidAt: invoice.paidAt ?? null,
        orderCount: invoice.orderIds?.length ?? 0,
        note: invoice.note ?? null,
        createdAt: invoice.createdAt,
      })),
    });
  },
);

/** Raise an invoice for everything currently owed, claiming those sales. */
export const POST = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:commission:create", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const { id } = params;
    const { settings } = await requireBillableVendor(id);

    const body = await validateOptionalBody(request, CommissionInvoiceSchema);

    const invoice = await createCommissionInvoice({
      vendorId: id,
      userId: session.user.id,
      currency: String(settings.general?.defaultCurrency || "USD"),
      note: typeof body.note === "string" ? body.note : undefined,
    });

    if (!invoice) {
      throw new ValidationError(
        "This vendor owes no uninvoiced commission right now",
      );
    }

    return successResponse(invoice, "Commission invoice raised", 201);
  },
);

/**
 * Record a collection, or cancel an invoice and hand the claim back.
 *
 * Cancelling matters as much as collecting: the claim is what hides these sales
 * from the owed balance, so an invoice nobody is ever going to pay would
 * otherwise write the debt off by simply sitting there.
 */
export const PATCH = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:commission:update", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const { id } = params;
    await requireBillableVendor(id);

    const body = (await request.json()) as {
      invoiceId?: unknown;
      action?: unknown;
    };
    const invoiceId = String(body.invoiceId ?? "");
    const action = String(body.action ?? "");
    if (!isValidObjectId(invoiceId)) return notFoundResponse("Invoice");
    if (action !== "collect" && action !== "cancel") {
      throw new ValidationError('Action must be "collect" or "cancel"');
    }

    // Scoped to this vendor so an invoice id belonging to another merchant
    // cannot be settled through their URL.
    const invoice = await CommissionInvoice.findOne({
      _id: invoiceId,
      vendorId: new Types.ObjectId(id),
    });
    if (!invoice) return notFoundResponse("Invoice");

    // Deducted from a payout: that payout settles it when it is paid and gives
    // its sales back if it is cancelled. Collecting or cancelling it here as
    // well would bill the commission twice, or free sales the payout already
    // took the money for.
    if (invoice.payoutId) {
      throw new ValidationError(
        "This commission is being deducted from a payout — pay or cancel that payout instead",
      );
    }

    if (action === "cancel") {
      if (invoice.status === COMMISSION_INVOICE_STATUS.PAID) {
        throw new ValidationError(
          "This invoice is already collected — reverse the payment instead of cancelling it",
        );
      }
      const released = await releaseCommissionInvoice(
        String(invoice._id),
        "cancelled",
      );
      return successResponse(
        { released },
        "Invoice cancelled — those sales are owed again",
      );
    }

    if (invoice.status === COMMISSION_INVOICE_STATUS.PAID) {
      // Not an error: a double-click must read as "already done", not fail.
      return successResponse({ status: invoice.status }, "Already collected");
    }
    if (invoice.status === COMMISSION_INVOICE_STATUS.CANCELLED) {
      throw new ValidationError(
        "This invoice was cancelled — raise a new one to bill those sales",
      );
    }

    // A real attempt row, so the settlement runs through the same guarded
    // mark-paid and benefit dispatch a gateway payment would take.
    const attempt = await PlatformPayment.create({
      kind: PLATFORM_PAYMENT_KIND.COMMISSION,
      commissionInvoiceId: invoice._id,
      vendorId: invoice.vendorId,
      userId: session.user.id,
      provider: PLATFORM_PAYMENT_PROVIDER.MANUAL,
      status: PLATFORM_PAYMENT_STATUS.PENDING,
      amount: invoice.amount,
      currency: invoice.currency,
      reference: `VCOM-${String(invoice._id)}-${Date.now().toString(36)}`,
    });

    // The vendor's own checkout for this invoice is superseded. Expired rather
    // than cancelled: a payer who completes it anyway is still recorded — and,
    // with the invoice already collected, flagged for a refund instead of
    // settling the same commission twice.
    await PlatformPayment.updateMany(
      {
        commissionInvoiceId: invoice._id,
        status: PLATFORM_PAYMENT_STATUS.PENDING,
        _id: { $ne: attempt._id },
      },
      { $set: { status: PLATFORM_PAYMENT_STATUS.EXPIRED } },
    );

    // No amount is passed, so the guarded mark-paid skips its gateway
    // cross-check — there is no gateway here, the admin is asserting the money
    // arrived.
    const result = await finalizePlatformPayment(attempt, {});
    if (!result.paid && !result.alreadyPaid) {
      throw new ValidationError("This invoice could not be marked collected");
    }

    return successResponse(
      { status: COMMISSION_INVOICE_STATUS.PAID },
      "Commission recorded as collected",
    );
  },
);
