import "server-only";
import type Stripe from "stripe";
import { VendorSubscriptionPayment } from "@/models/vendorSubscriptionPayment.model";
import { financeQuery, financeTransaction } from "@/lib/finance/transaction";
import { finishFinanceOperation, touchVendorFinance } from "@/lib/finance/operations";
import { replaySubscriptionInvoice } from "@/lib/finance/payment-ledger";
import { ApiError } from "@/lib/api/errors";

type RefundSnapshot = { id: string; amount: number; status: string; created: number };

/** Reads provider evidence only. Each refund keeps its own date and durable delta. */
export async function syncVendorSubscriptionRefunds(
  charge: Pick<Stripe.Charge, "payment_intent">,
  stripe: Stripe,
  eventAt = new Date(),
): Promise<boolean> {
  const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!intentId) return false;
  const payment = await VendorSubscriptionPayment.findOne({ provider: "stripe", providerPaymentIntentId: intentId }).select("_id").lean();
  if (!payment) return false;
  const observedAt = new Date();
  const refunds: RefundSnapshot[] = [];
  for await (const refund of stripe.refunds.list({ payment_intent: intentId, limit: 100 })) {
    refunds.push({ id: refund.id, amount: refund.amount, status: refund.status || "pending", created: refund.created });
  }
  refunds.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
  const operations = await financeTransaction("subscription:refund-evidence", async () => {
    const current = await financeQuery(VendorSubscriptionPayment.findById(payment._id));
    if (!current) return [];
    await touchVendorFinance(current.vendorId, current.currency);
    if (current.refundStateObservedAt && current.refundStateObservedAt > observedAt) return [];
    const previous = current.stripeRefunds || [];
    const tracked = new Map(previous.map((refund) => [refund.id, refund]));
    const successfulTotal = (values: Iterable<RefundSnapshot>) => [...values].reduce((sum, refund) => sum + (refund.status === "succeeded" ? refund.amount : 0), 0);
    // An old aggregate without refund identities is imported once against the
    // complete provider list. Contradictory totals need review, not invented cash.
    const legacy = previous.length === 0 ? current.amountRefunded : 0;
    if (legacy > successfulTotal(refunds)) throw new ApiError("Historical subscription refunds disagree with provider evidence", 409, "FINANCE_REFUND_CONFLICT");
    const accepted: string[] = [];
    for (const refund of refunds) {
      const prior = tracked.get(refund.id);
      if (prior?.status === refund.status && prior.amount === refund.amount) continue;
      tracked.set(refund.id, refund);
      const target = Math.max(legacy, successfulTotal(tracked.values()));
      if (target > current.amountPaid) throw new ApiError("Subscription refund exceeds collected amount", 409, "FINANCE_REFUND_CONFLICT");
      const changed = target !== current.amountRefunded;
      await financeQuery(VendorSubscriptionPayment.updateOne({ _id: current._id }, { $set: {
        stripeRefunds: [...tracked.values()], amountRefunded: target,
        status: target >= current.amountPaid ? "refunded" : "paid",
        ...(changed ? { refundedAt: prior ? eventAt : new Date(refund.created * 1000) } : {}),
      } }));
      current.amountRefunded = target;
      if (changed) {
        const result = await replaySubscriptionInvoice(current._id);
        if (result && typeof result === "object") accepted.push(result.operationId);
      }
    }
    await financeQuery(VendorSubscriptionPayment.updateOne({ _id: current._id }, { $set: { refundStateObservedAt: observedAt } }));
    return accepted;
  });
  for (const operation of operations) await finishFinanceOperation(operation);
  return true;
}
