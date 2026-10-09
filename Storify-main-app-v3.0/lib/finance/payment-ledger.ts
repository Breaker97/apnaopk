import "server-only";
import { PlatformPayment } from "@/models/platformPayment.model";
import { VendorSubscriptionPayment } from "@/models/vendorSubscriptionPayment.model";
import { LedgerEntry } from "@/models/ledger-entry.model";
import { FinanceOperation } from "@/models/finance-operation.model";
import { ApiError } from "@/lib/api/errors";
import { fromStripeAmount } from "@/lib/payments/stripe";
import { quantizeToCurrency } from "@/lib/intl/money";
import { LEDGER_ACCOUNT } from "./accounts";
import { platformPaymentPostings, subscriptionInvoicePostings } from "./postings";
import { runFinanceOperation, touchVendorFinance } from "./operations";
import { financeQuery } from "./transaction";

async function platformHistory(payment: Parameters<typeof platformPaymentPostings>[0] & { benefitGrantedAt?: Date | null }) {
  const entries = platformPaymentPostings({ ...payment, benefitGrantedAt: payment.benefitGrantedAt ?? null });
  const original = await financeQuery(LedgerEntry.findOne({ key: `platform_payment:${payment._id}:paid` })).lean();
  if (!original || original.credit === LEDGER_ACCOUNT.UNAPPLIED_PAYMENT_PAYABLE) return entries;
  // Preserve a historical direct receipt. An unapplied receipt needs a linked reclassification.
  if (payment.benefitGrantedAt) {
    const reclassified = await financeQuery(LedgerEntry.exists({ key: `${entries[0]!.key}:unapplied-correction` }));
    return reclassified ? entries.filter((entry) => entry.key.endsWith(":application")) : [];
  }
  const receipt = entries[0]!;
  return [{ ...receipt, debit: original.credit, credit: LEDGER_ACCOUNT.UNAPPLIED_PAYMENT_PAYABLE, amount: original.amount, date: original.date, key: `${receipt.key}:unapplied-correction`, note: "Received payment was not applied to a benefit" }];
}

async function acceptedRefund(id: unknown, pattern: string, action: string, resultField: string) {
  const rows = await financeQuery(LedgerEntry.find({ "source.id": String(id), key: { $regex: pattern } })).select("amount debit credit").lean();
  const posted = rows.reduce((sum, row) => sum + (row.debit === LEDGER_ACCOUNT.SUBSCRIPTION_INCOME || row.debit === LEDGER_ACCOUNT.BOOST_INCOME || row.debit === LEDGER_ACCOUNT.COMMISSION_RECEIVABLE || row.debit === LEDGER_ACCOUNT.UNAPPLIED_PAYMENT_PAYABLE ? row.amount : -row.amount), 0);
  const operations = await financeQuery(FinanceOperation.find({ sourceId: String(id), action: { $regex: action } })).select("result").lean();
  const accepted = operations.reduce((sum, op) => sum + Number(op.result?.[resultField] || 0), 0);
  return Math.max(posted, accepted);
}

export async function replayPlatformPayment(id: unknown) {
  const payment = await financeQuery(PlatformPayment.findById(id)).lean();
  if (!payment || !["paid", "refunded"].includes(payment.status) || !payment.paidAt) return 0;
  const applied = Boolean(payment.benefitGrantedAt);
  await runFinanceOperation({
    action: `platform:${applied ? "applied" : "received"}:${id}`, actorId: "system", requestKey: `payment-${id}`,
    fingerprint: { id: String(id), amount: payment.amount, currency: payment.currency, applied },
    work: async () => ({ result: { id: String(id) }, sourceId: id, vendorId: payment.vendorId, postings: await platformHistory(payment) }),
  });
  if (payment.refundedAmount > 0) await acceptPlatformRefund(id, payment.refundedAmount, payment.refundedAt ?? payment.updatedAt, payment.status === "refunded", !payment.refundedAt);
  return 0;
}

/** A cumulative provider total becomes one immutable dated delta, atomically with source state. */
export async function acceptPlatformRefund(id: unknown, target: number, refundedAt = new Date(), terminal = false, estimatedDate = false) {
  return runFinanceOperation({
    action: `platform:refund:${id}:${target}:${terminal ? "terminal" : "partial"}`, actorId: "system", requestKey: `refund-${id}-${target}`,
    fingerprint: { id: String(id), target, terminal },
    work: async () => {
      const payment = await financeQuery(PlatformPayment.findById(id));
      if (!payment || !payment.paidAt) throw new ApiError("Paid payment not found", 400);
      await touchVendorFinance(payment.vendorId, payment.currency);
      const total = quantizeToCurrency(target, payment.currency);
      if (!Number.isFinite(total) || total < 0 || total > payment.amount) throw new ApiError("Invalid refund amount", 400);
      const previous = payment.toObject();
      const accepted = payment.ledgerRefundAcceptedAmount ?? await acceptedRefund(id, ":(refunded:|paid:reversal)", "^platform:refund:", "delta");
      const nextTotal = Math.max(total, payment.refundedAmount || 0);
      const delta = quantizeToCurrency(Math.max(0, nextTotal - accepted), payment.currency);
      const history = await platformHistory(previous);
      const base = platformPaymentPostings({ ...previous, benefitGrantedAt: payment.benefitGrantedAt ?? null });
      const debit = base.find((entry) => entry.key.endsWith(":application"))?.credit ?? LEDGER_ACCOUNT.UNAPPLIED_PAYMENT_PAYABLE;
      await financeQuery(PlatformPayment.updateOne({ _id: String(id) }, { $set: {
        refundedAmount: nextTotal, ledgerRefundAcceptedAmount: Math.max(accepted, nextTotal),
        ...(delta > 0 ? { refundedAt } : {}), ...(terminal ? { status: "refunded" } : {}),
      } }));
      return { result: { previous, delta, refundedAt, estimatedDate }, sourceId: id, vendorId: payment.vendorId, postings: [...history,
        ...(delta > 0 ? [{ ...base[0]!, debit, credit: base[0]!.debit, amount: delta, date: refundedAt, key: `platform_payment:${id}:refunded:${nextTotal}`, note: estimatedDate ? "Legacy refund: date estimated from source update" : "Platform payment refunded" }] : []),
      ] };
    },
  });
}

/** Provider invoice amounts and the accepted cursor are in provider minor units. */
export async function replaySubscriptionInvoice(id: unknown) {
  const payment = await financeQuery(VendorSubscriptionPayment.findById(id)).lean();
  if (!payment || !["paid", "refunded"].includes(payment.status) || payment.amountPaid <= 0 || payment.provider !== "stripe") return 0;
  const paid = fromStripeAmount(payment.amountPaid, payment.currency);
  await runFinanceOperation({ action: `subscription:receipt:${id}`, actorId: "system", requestKey: `invoice-${id}`, fingerprint: { id: String(id), paid, currency: payment.currency },
    work: async () => ({ sourceId: id, vendorId: payment.vendorId, result: { receipt: true }, postings: subscriptionInvoicePostings({ ...payment, amountPaid: paid, amountRefunded: 0 }) }),
  });
  const eventAt = payment.refundedAt ?? payment.providerStateUpdatedAt ?? payment.updatedAt;
  const target = payment.amountRefunded || 0;
  return runFinanceOperation({
    action: `subscription:refund:${id}:${target}`, actorId: "system", requestKey: `invoice-${id}-${eventAt.getTime()}`,
    fingerprint: { id: String(id), target, currency: payment.currency },
    work: async () => {
      const current = await financeQuery(VendorSubscriptionPayment.findById(id));
      if (!current) throw new ApiError("Subscription invoice not found", 404);
      if (current.amountRefunded !== target || current.currency !== payment.currency) throw new ApiError("Subscription state changed during replay", 409, "STALE_REFUND_SNAPSHOT");
      await touchVendorFinance(current.vendorId, current.currency);
      const accepted = current.ledgerRefundAcceptedAmount !== undefined ? fromStripeAmount(current.ledgerRefundAcceptedAmount, current.currency)
        : await acceptedRefund(id, ":subscription-refund", "^subscription:refund:", "refundDelta");
      const delta = quantizeToCurrency(fromStripeAmount(target, current.currency) - accepted, current.currency);
      const original = subscriptionInvoicePostings({ ...current.toObject(), amountPaid: paid, amountRefunded: 0 });
      await financeQuery(VendorSubscriptionPayment.updateOne({ _id: String(id) }, { $set: { ledgerRefundAcceptedAmount: target } }));
      return { sourceId: id, vendorId: current.vendorId, result: { refundDelta: delta, estimatedDate: !payment.refundedAt }, postings: [...original,
        ...(delta !== 0 ? [{ ...original[0]!, debit: delta > 0 ? LEDGER_ACCOUNT.SUBSCRIPTION_INCOME : original[0]!.debit,
          credit: delta > 0 ? original[0]!.debit : LEDGER_ACCOUNT.SUBSCRIPTION_INCOME, amount: Math.abs(delta), date: eventAt,
          key: `platform_payment:${id}:subscription-refund:${target}:${eventAt.getTime()}`, note: delta < 0 ? "Subscription refund reversed" : payment.refundedAt ? "Subscription refunded" : "Subscription refund: date estimated from source update" }] : []),
      ] };
    },
  });
}
