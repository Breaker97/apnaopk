import "server-only";

import { connectDB } from "@/lib/db";
import { PLATFORM_PAYMENT_KIND } from "@/config/app.config";
import { currencyMinorUnitExponent } from "@/lib/intl/money";
import { fromStripeAmount } from "@/lib/payments/stripe";
import {
  DISPUTE_GATEWAY_LABEL,
  DISPUTE_RESPONSE_PLACE,
  disputeKey,
} from "@/lib/payments/dispute-gateways";
import {
  DISPUTE_MONEY_EPSILON,
  type GatewayDisputeReading,
} from "@/lib/orders/dispute-readings";
import type { DisputeApplication } from "@/lib/orders/order-refund-sync";
import type { IPlatformPayment } from "@/models/platformPayment.model";

/**
 * A dispute on a vendor's own payment to the platform — a boost, a plan or a
 * commission paid by card.
 *
 * Orders are not the only thing a gateway account takes money for, and the
 * gateways cannot tell them apart: a chargeback on a boost arrives on the same
 * webhook as one on an order. Until this existed it matched no order, so the
 * money left the gateway balance with no entry, no fee and no word to an admin,
 * and the dispute sat in the reconciliation list as work that never finished.
 *
 * What is recorded:
 *  - the money the gateway is holding that no refund has already given back,
 *    as a chargeback loss, brought in line with the gateway on every read and
 *    returned when the store wins;
 *  - the dispute's fees, as on an order;
 *  - when the payment is lost in full, the payment itself is reversed exactly as
 *    a gateway reversal would — a boost campaign cancelled, a commission
 *    invoice released, the income unwound — and the loss shrinks by the same
 *    amount, so the cash is never taken out twice;
 *  - one notice to an admin per change.
 *
 * A partial loss is booked as a loss and left to an admin: part of a boost or
 * plan cannot be taken back automatically.
 */

interface Subject {
  /** Whose ledger entries the dispute's money is filed under. */
  ledgerId: string;
  reference: string | null;
  currency: string;
  paid: number;
  givenBack: number;
  paidAt: Date | null;
  label: string;
  link: string;
  kind: "boost" | "subscription" | "commission" | "invoice";
  /** A payment that can be reversed in full; absent for a Stripe plan invoice. */
  payment: IPlatformPayment | null;
}

interface PlatformDisputeNotice {
  title: string;
  message: string;
  dedupeKey: string;
}

const text = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value).trim();

function subjectOfPayment(payment: IPlatformPayment): Subject {
  const kind = String(payment.kind) as Subject["kind"];
  const noun =
    kind === PLATFORM_PAYMENT_KIND.BOOST
      ? "Boost payment"
      : kind === PLATFORM_PAYMENT_KIND.COMMISSION
        ? "Commission payment"
        : "Subscription payment";
  return {
    ledgerId: String(payment._id),
    reference: payment.reference ?? null,
    currency: String(payment.currency || "").toUpperCase(),
    paid: Number(payment.amount || 0),
    givenBack: Number(payment.refundedAmount || 0),
    paidAt: payment.paidAt ?? null,
    label: `${noun} ${payment.reference || payment._id}`,
    link:
      kind === PLATFORM_PAYMENT_KIND.BOOST && payment.campaignId
        ? `/admin/boosts/${String(payment.campaignId)}`
        : `/admin/vendors/${String(payment.vendorId)}`,
    kind,
    payment,
  };
}

/** The vendor payment a gateway's dispute is on, if there is one. */
async function findSubject(
  locator: Record<string, unknown>,
): Promise<Subject | null> {
  const match: Array<Record<string, string>> = [];
  const add = (field: string, value: unknown) => {
    const id = text(value);
    if (id) match.push({ [field]: id });
  };
  add("stripePaymentIntentId", locator.stripePaymentIntentId);
  add("paypalCaptureId", locator.paypalCaptureId);
  add("razorpayPaymentId", locator.razorpayPaymentId);
  add("paystackTransactionId", locator.paystackTransactionId);
  // Paystack carries our own reference through, and a platform payment is
  // created under one.
  add("reference", locator.paystackReference);

  if (match.length > 0) {
    const { PlatformPayment } = await import("@/models/platformPayment.model");
    const payment = await PlatformPayment.findOne({ $or: match });
    if (payment) return subjectOfPayment(payment);
  }

  // A plan billed through Stripe's own subscription engine is an invoice, not a
  // platform payment.
  const intent = text(locator.stripePaymentIntentId);
  if (intent) {
    const { VendorSubscriptionPayment } = await import(
      "@/models/vendorSubscriptionPayment.model"
    );
    const invoice = await VendorSubscriptionPayment.findOne({
      provider: "stripe",
      providerPaymentIntentId: intent,
    }).lean<{
      _id: unknown;
      vendorId: unknown;
      providerInvoiceId?: string;
      currency?: string;
      amountPaid?: number;
      amountRefunded?: number;
      paidAt?: Date | null;
    } | null>();
    if (invoice) {
      const currency = String(invoice.currency || "").toUpperCase();
      return {
        ledgerId: String(invoice._id),
        reference: invoice.providerInvoiceId ?? null,
        currency,
        paid: fromStripeAmount(Number(invoice.amountPaid || 0), currency),
        givenBack: fromStripeAmount(Number(invoice.amountRefunded || 0), currency),
        paidAt: invoice.paidAt ?? null,
        label: `Subscription invoice ${invoice.providerInvoiceId || invoice._id}`,
        link: `/admin/vendors/${String(invoice.vendorId)}`,
        kind: "invoice",
        payment: null,
      };
    }
  }
  return null;
}

/** What an admin does about a lost payment of this kind, once it is reversed. */
function reversalConsequence(kind: Subject["kind"]): string {
  if (kind === "boost") return " The boost campaign was cancelled.";
  if (kind === "commission")
    return " The commission is owed by the vendor again.";
  return " Nothing was changed on the vendor's plan — review it from the vendor's page.";
}

/** What to tell an admin about a dispute on a vendor payment, once applied. */
export function platformDisputeNotices(params: {
  reading: GatewayDisputeReading;
  label: string;
  kind: Subject["kind"];
  /** Signed change posted just now: positive is more lost, negative came back. */
  change: number;
  /** The payment was reversed in full by this read. */
  reversed: boolean;
  /** The payment had been reversed by an earlier read, and the dispute is now won. */
  wonAfterReversal?: boolean;
  quietHistory?: boolean;
  now?: Date;
}): PlatformDisputeNotice[] {
  const { reading } = params;
  const now = (params.now ?? new Date()).getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const deadlineMissed = Boolean(
    params.quietHistory &&
      reading.respondBy &&
      reading.respondBy.getTime() < now - DAY_MS,
  );
  const lastChanged = reading.updatedAt ?? reading.openedAt;
  const oldNews = Boolean(
    params.quietHistory &&
      (!lastChanged || lastChanged.getTime() < now - 30 * DAY_MS),
  );
  const gateway = DISPUTE_GATEWAY_LABEL[reading.gateway];
  const place = DISPUTE_RESPONSE_PLACE[reading.gateway];
  const key = `dispute:${reading.gateway}:${reading.disputeId}`;
  const exponent = currencyMinorUnitExponent(reading.currency);
  const figure = (amount: number) => Math.max(0, amount).toFixed(exponent);
  const money = (amount: number) => `${figure(amount)} ${reading.currency}`;
  const day = reading.respondBy
    ? reading.respondBy.toISOString().slice(0, 10)
    : "";
  const by = day ? ` by ${day}` : "";
  const why = reading.reason ? ` (${reading.reason})` : "";
  const decided = reading.stage === "lost" || reading.stage === "closed";
  const notices: PlatformDisputeNotice[] = [];

  if (deadlineMissed) {
    // Nothing left to answer.
  } else if (reading.stage === "opened") {
    notices.push({
      title: "A vendor payment is being disputed",
      message: `${params.label}: ${gateway} opened dispute ${reading.disputeId}${why}${
        reading.disputedAmount ? ` for ${money(reading.disputedAmount)}` : ""
      }. Respond with evidence in ${place}${by}.`,
      dedupeKey: `${key}:opened`,
    });
  } else if (reading.stage === "action_required") {
    notices.push({
      title: "A dispute needs your response",
      message: `${params.label}: ${gateway} needs more from the store on dispute ${reading.disputeId}${why}. Add the evidence in ${place}${by}, or the store loses it.`,
      dedupeKey: `${key}:action-required:${day}`,
    });
  } else if (reading.stage === "reminder") {
    notices.push({
      title: "A dispute is still waiting for your response",
      message: `${params.label}: dispute ${reading.disputeId}${why} has not been answered. Respond in ${place}${by}, or it is accepted and the money goes back to the vendor's bank.`,
      dedupeKey: `${key}:reminder:${day}`,
    });
  }

  const standing = reading.withdrawn ?? 0;
  let moneyNews = false;
  if (params.change > DISPUTE_MONEY_EPSILON || params.reversed) {
    moneyNews = true;
    notices.push({
      title: "A chargeback took a vendor's payment back",
      message: `${params.label}: ${gateway} took ${money(standing)} back for dispute ${reading.disputeId}${why}. It is booked as a chargeback loss${
        params.reversed ? " and the payment is reversed." : "."
      }${params.reversed ? reversalConsequence(params.kind) : ""}${
        decided ? "" : ` Respond in ${place}${by} to win it back.`
      }`,
      dedupeKey:
        reading.stage === "lost"
          ? `${key}:lost`
          : `${key}:taken:${figure(standing)}`,
    });
  }
  if (params.change < -DISPUTE_MONEY_EPSILON) {
    moneyNews = true;
    notices.push({
      title: "A chargeback was won",
      message: `${params.label}: ${gateway} gave back ${money(-params.change)} on dispute ${reading.disputeId}, so the loss is taken off the books again.${
        params.wonAfterReversal
          ? " The payment had already been reversed when the dispute looked lost, and that reversal stands — review it by hand if the vendor should keep what they paid for."
          : ""
      }`,
      dedupeKey:
        reading.stage === "won"
          ? `${key}:won`
          : `${key}:returned:${figure(standing)}`,
    });
  } else if (params.wonAfterReversal && reading.stage === "won") {
    moneyNews = true;
    notices.push({
      title: "A dispute was won on a payment that was already reversed",
      message: `${params.label}: ${gateway} decided dispute ${reading.disputeId} for the store, but the payment had already been reversed when it looked lost. That reversal stands — review it by hand if the vendor should keep what they paid for.`,
      dedupeKey: `${key}:won-after-reversal`,
    });
  }
  if (moneyNews || oldNews) return notices;

  if (reading.stage === "lost" && reading.withdrawn === null) {
    notices.push({
      title: "A dispute was lost",
      message: `${params.label}: ${gateway} decided dispute ${reading.disputeId} against the store but did not say what it took, so nothing was recorded. If money was taken, record it by hand.`,
      dedupeKey: `${key}:lost:unreported`,
    });
  }
  return notices;
}

/**
 * Apply a dispute to the vendor payment it is on. Returns `matched: false`
 * when it is on no vendor payment either, which leaves it to the caller.
 *
 * Idempotent by comparison, like the order path: what the books hold for the
 * dispute is brought in line with what the gateway says, so reading it again
 * posts nothing.
 */
export async function applyPlatformDispute(
  reading: GatewayDisputeReading,
  options: {
    quietHistory?: boolean;
    strictReconciliation?: boolean;
  } = {},
): Promise<DisputeApplication> {
  const application: DisputeApplication = {
    matched: false,
    recorded: 0,
    reversed: 0,
  };
  await connectDB();
  let subject = await findSubject(reading.locator);
  if (!subject) return application;
  application.matched = true;

  const key = disputeKey(reading.gateway, reading.disputeId);
  const strict = options.strictReconciliation === true;
  const settled = (error: unknown) => {
    if (strict) throw error;
    console.error("Failed to book a dispute on a vendor payment:", error);
    return 0;
  };
  let change = 0;
  let reversed = false;
  const wonAfterReversal = Boolean(
    reading.stage === "won" && subject.payment?.benefitReversedAt,
  );

  if (reading.withdrawn !== null) {
    if (
      !subject.paidAt ||
      reading.currency.toUpperCase() !== subject.currency
    ) {
      // Money in another currency cannot be compared with what was paid, and a
      // payment not yet recorded as paid has no entries to be in line with.
      application.deferred = true;
    } else {
      if (
        subject.payment &&
        (reading.stage === "lost" || reading.stage === "closed") &&
        reading.withdrawn + DISPUTE_MONEY_EPSILON >= subject.paid &&
        !subject.payment.benefitReversedAt
      ) {
        const { markPlatformPaymentReversed } = await import(
          "@/lib/payments/platform-payments"
        );
        reversed = Boolean(await markPlatformPaymentReversed(subject.payment));
        subject = (await findSubject(reading.locator)) ?? subject;
      }
      const { postPlatformDisputeLoss } = await import(
        "@/lib/finance/post-events"
      );
      change = await postPlatformDisputeLoss({
        disputeId: key,
        paymentId: subject.ledgerId,
        reference: subject.reference,
        target: Math.max(0, reading.withdrawn - subject.givenBack),
        currency: subject.currency,
      }).catch(settled);
    }
  }

  if (reading.fees.length > 0) {
    const { postPlatformDisputeFee } = await import("@/lib/finance/post-events");
    for (const fee of reading.fees) {
      await postPlatformDisputeFee({
        disputeId: key,
        paymentId: subject.ledgerId,
        reference: subject.reference,
        amount: fee.amount,
        currency: fee.currency,
        returned: fee.returned,
        part: fee.part,
        date: fee.date,
        note: fee.note,
      }).catch(settled);
    }
  }

  application.recorded = change > 0 ? change : 0;
  application.reversed = change < 0 ? -change : 0;

  const notices = application.deferred
    ? []
    : platformDisputeNotices({
        reading,
        label: subject.label,
        kind: subject.kind,
        change,
        reversed,
        wonAfterReversal,
        quietHistory: options.quietHistory,
      });
  if (notices.length > 0) {
    const { notifyAdminsPaymentAnomaly } = await import(
      "@/lib/notifications/notifications"
    );
    for (const notice of notices) {
      await notifyAdminsPaymentAnomaly({
        ...notice,
        link: subject.link,
      }).catch((error) => console.error("Failed to report a dispute:", error));
    }
  }
  return application;
}
