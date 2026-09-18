import { z } from "zod";

import { ObjectIdSchema } from "@/lib/validations";
import {
  PLATFORM_PAYMENT_GATEWAYS,
  PLATFORM_PAYMENT_KIND,
  PLATFORM_PAYMENT_STATUS,
} from "@/config/app.config";
import { PlatformPayment } from "@/models";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { appUrlForRequest } from "@/lib/app-url";
import { connectDB } from "@/lib/db";
import {
  createPlatformPaymentAttempt,
  initiatePlatformPayment,
  resolvePlatformPaymentMethods,
} from "@/lib/payments/platform-payments";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import {
  COMMISSION_INVOICE_STATUS,
  CommissionInvoice,
} from "@/models/commissionInvoice.model";
import { getSettings } from "@/models/settings.model";

/**
 * A vendor settling the commission they owe on cash they collected.
 *
 * The debt is raised by an admin (`/api/admin/vendors/[id]/commission`); this
 * is the other end — the merchant paying it themselves rather than arranging a
 * bank transfer. It rides the existing vendor→platform rail, so every gateway
 * that can already sell them a boost can settle one of these.
 *
 * Deliberately NOT gated on a permission: a debt is owed by the merchant, and
 * paying it is not an act that needs authorising within their own store.
 */

const PaySchema = z.object({
  invoiceId: ObjectIdSchema,
  paymentMethod: z.enum(PLATFORM_PAYMENT_GATEWAYS),
  // Region-qualified tags ("pt-BR") are valid locales, so this matches the
  // other checkout routes rather than insisting on exactly two characters.
  locale: z.string().min(2).max(12).optional(),
  iotecChannel: z.enum(["mobile_money", "card"]).optional(),
  iotecPhone: z.string().trim().max(32).optional(),
  mtnMomoPhone: z.string().trim().max(32).optional(),
});

/** The invoices this vendor still owes, for the billing screen. */
export const GET = withApi(
  { auth: "user" },
  async ({ session }) => {
    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id);

    const invoices = await CommissionInvoice.find({
      vendorId: vendor._id,
      status: COMMISSION_INVOICE_STATUS.OPEN,
      // A bill being deducted from a payout is not the vendor's to pay: paying
      // it here as well would collect the same commission twice.
      payoutId: null,
    })
      .select("amount currency orderIds note createdAt")
      .sort({ createdAt: -1 })
      .lean();

    return successResponse({
      // Gateways the platform can actually charge on, so the client never
      // offers a button that would fail at initiation.
      paymentMethods: resolvePlatformPaymentMethods(
        settings,
        settings.vendorConfig?.paymentMethods,
      ),
      invoices: invoices.map((invoice) => ({
        id: String(invoice._id),
        amount: invoice.amount,
        currency: invoice.currency,
        orderCount: invoice.orderIds?.length ?? 0,
        note: invoice.note ?? null,
        createdAt: invoice.createdAt,
      })),
    });
  },
);

/** Start a gateway checkout for one open invoice. */
export const POST = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:commission:pay", preset: "moderate" },
  },
  async ({ request, session }) => {
    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id);
    const body = await validateBody(request, PaySchema);

    const allowed = resolvePlatformPaymentMethods(
      settings,
      settings.vendorConfig?.paymentMethods,
    );
    if (!allowed.includes(body.paymentMethod)) {
      throw new ValidationError("That payment method is not available");
    }

    // Scoped to this vendor: an invoice id belonging to another merchant must
    // not be payable — nor even confirmable — through this route.
    const invoice = await CommissionInvoice.findOne({
      _id: body.invoiceId,
      vendorId: vendor._id,
    });
    if (!invoice) throw new NotFoundError("Invoice");

    if (invoice.status === COMMISSION_INVOICE_STATUS.PAID) {
      throw new ValidationError("This invoice has already been settled");
    }
    if (invoice.status === COMMISSION_INVOICE_STATUS.CANCELLED) {
      throw new ValidationError("This invoice was cancelled");
    }
    if (invoice.payoutId) {
      throw new ValidationError(
        "This commission is being deducted from your next payout, so there is nothing to pay here",
      );
    }

    // One open attempt per invoice: `createPlatformPaymentAttempt` expires any
    // previous pending row for the same target, so abandoning PayPal and
    // retrying with Paystack cannot leave two references racing to finalize.
    const payment = await createPlatformPaymentAttempt({
      kind: PLATFORM_PAYMENT_KIND.COMMISSION,
      commissionInvoiceId: String(invoice._id),
      vendorId: String(vendor._id),
      userId: session.user.id,
      provider: body.paymentMethod,
      amount: invoice.amount,
      currency: invoice.currency,
    });

    const locale = body.locale || "en";
    const origin = appUrlForRequest(request);
    const returnBase = `${origin}/${locale}/vendor/payouts?commission_payment=${String(payment._id)}`;

    try {
      const initiation = await initiatePlatformPayment({
        payment,
        settings,
        successUrl: returnBase,
        cancelUrl: `${returnBase}&canceled=true`,
        payer: {
          email: session.user.email || "",
          name: session.user.name || vendor.storeName,
          phone: body.iotecPhone || vendor.address?.phone,
          address: {
            country: vendor.address?.country,
            city: vendor.address?.city,
            street: vendor.address?.street,
            state: vendor.address?.state,
            postalCode: vendor.address?.postalCode,
          },
        },
        description: `Commission on ${invoice.orderIds?.length ?? 0} self-collected order(s)`,
        iotecChannel: body.iotecChannel,
        iotecPhone: body.iotecPhone,
        mtnMomoPhone: body.mtnMomoPhone,
      });

      return successResponse({
        paymentId: String(payment._id),
        provider: body.paymentMethod,
        ...initiation,
      });
    } catch (error) {
      // The gateway never took over. Retiring the attempt here keeps the
      // invoice's open-attempt slot clean, exactly like the boost, renewal and
      // application checkouts do.
      await PlatformPayment.updateOne(
        { _id: payment._id, status: PLATFORM_PAYMENT_STATUS.PENDING },
        {
          $set: {
            status: PLATFORM_PAYMENT_STATUS.FAILED,
            failedAt: new Date(),
            failureReason:
              error instanceof Error ? error.message : "Initiation failed",
          },
        },
      ).catch(() => undefined);
      throw error;
    }
  },
);
