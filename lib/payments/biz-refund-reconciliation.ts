import "server-only";
import { PaymentTransaction } from "@/models/payment-transaction.model";
import { Order } from "@/models/order.model";
import { getSettings } from "@/models/settings.model";
import { resolveStripeCredentials, resolvePayPalCredentials, resolvePaystackCredentials, resolveRazorpayCredentials } from "@/lib/settings/credentials";
import { getStripeForSecretKey, fromStripeAmount } from "./stripe";
import { fetchPayPalRefund } from "./paypal";
import { fetchPaystackRefund, fromPaystackAmountSubunits } from "./paystack";
import { fetchRazorpayRefund, fromRazorpayAmountSubunits } from "./razorpay";
import { recordBizGatewayRefundReport } from "@/lib/orders/order-refund-sync";

const providerStatuses: Record<string, ReadonlySet<string>> = {
  stripe: new Set(["succeeded", "pending", "requires_action", "failed", "canceled"]),
  paypal: new Set(["completed", "pending", "failed", "cancelled"]),
  razorpay: new Set(["processed", "created", "pending", "failed"]),
  paystack: new Set(["processed", "pending", "processing", "failed", "needs_attention"]),
};
const settledOrPending: Record<string, ReadonlySet<string>> = {
  stripe: new Set(["succeeded", "pending", "requires_action"]),
  paypal: new Set(["completed", "pending"]),
  razorpay: new Set(["processed", "created", "pending"]),
  paystack: new Set(["processed", "pending", "processing", "needs_attention"]),
};

/** Refresh existing provider identities. No provider create call is ever retried here. */
export async function refreshBizRefundReports(receiptId: unknown): Promise<void> {
  const row = await PaymentTransaction.findOne({ _id: receiptId, status: "pending", type: "refund", bizOperationId: { $exists: true }, bizOperationLeg: "gateway", "metadata.bizHeadroomReserved": true })
    .select("orderId provider externalId currency bizOperationId bizOperationLeg metadata")
    .lean<{ orderId: unknown; provider: string; externalId?: string; currency: string; bizOperationId: string; bizOperationLeg: string; metadata?: { gatewayRefundIds?: string[]; bizGatewayReports?: Record<string, { provider?: string }> } } | null>();
  if (!row) return;
  const ids = [...new Set([row.externalId, ...(row.metadata?.gatewayRefundIds || [])].filter((id): id is string => Boolean(id)))];
  const settings = await getSettings();
  const stripeCredentials = resolveStripeCredentials(settings.payment?.stripe);
  // A lost Stripe answer can be found by its exact immutable operation tags
  // on this order's own charges. Missing identities on other providers stay unknown.
  if (stripeCredentials.secretKey) {
    const order = await Order.findById(row.orderId).select("stripePaymentIntentId paymentId preorderBalancePaymentIntentId").lean<{ stripePaymentIntentId?: string; paymentId?: string; preorderBalancePaymentIntentId?: string } | null>();
    const intents = [...new Set([order?.stripePaymentIntentId || order?.paymentId, order?.preorderBalancePaymentIntentId].filter((id): id is string => Boolean(id?.startsWith("pi_"))))];
    const stripe = getStripeForSecretKey(stripeCredentials.secretKey);
    for (const intent of intents) {
      const refunds = await stripe.refunds.list({ payment_intent: intent, limit: 100 });
      for (const report of refunds.data) {
        if (report.metadata?.storifyBizOperationId !== row.bizOperationId || report.metadata?.storifyBizOperationLeg !== row.bizOperationLeg) continue;
        const reportedIntent = typeof report.payment_intent === "string" ? report.payment_intent : report.payment_intent?.id;
        if (reportedIntent !== intent) continue;
        if (report.currency.toUpperCase() !== row.currency.toUpperCase()) throw new Error("Refund evidence currency differs from its receipt");
        if (!providerStatuses.stripe.has(String(report.status || ""))) throw new Error("Unrecognized Stripe refund status");
        await recordBizGatewayRefundReport(row.orderId, { id: report.id, amount: fromStripeAmount(report.amount, report.currency), live: ["succeeded", "pending", "requires_action"].includes(String(report.status)), gatewayStatus: String(report.status), gatewayProvider: "stripe", bizOperation: { id: row.bizOperationId, leg: row.bizOperationLeg } });
      }
    }
  }
  for (const id of ids) {
    const provider = row.metadata?.bizGatewayReports?.[id]?.provider || row.provider;
    let amount: number; let status: string; let currency: string; let returnedId: string;
    if (provider === "stripe" && stripeCredentials.secretKey) {
      const refund = await getStripeForSecretKey(stripeCredentials.secretKey).refunds.retrieve(id);
      amount = fromStripeAmount(refund.amount, refund.currency); status = String(refund.status || ""); currency = refund.currency; returnedId = refund.id;
    } else if (provider === "paypal") {
      const credentials = resolvePayPalCredentials(settings.payment?.paypal);
      if (!credentials.clientId || !credentials.clientSecret) continue;
      const refund = await fetchPayPalRefund({ creds: { clientId: credentials.clientId, clientSecret: credentials.clientSecret, mode: credentials.mode }, refundId: id });
      amount = Number(refund.amount?.value); status = String(refund.status || ""); currency = refund.amount?.currency_code || ""; returnedId = refund.id;
    } else if (provider === "razorpay") {
      const credentials = resolveRazorpayCredentials(settings.payment?.razorpay);
      if (!credentials.keyId || !credentials.keySecret) continue;
      const refund = await fetchRazorpayRefund({ creds: { keyId: credentials.keyId, keySecret: credentials.keySecret }, refundId: id });
      currency = refund.currency || ""; amount = fromRazorpayAmountSubunits(Number(refund.amount), currency); status = String(refund.status || ""); returnedId = refund.id;
    } else if (provider === "paystack") {
      const credentials = resolvePaystackCredentials(settings.payment?.paystack);
      if (!credentials.secretKey) continue;
      const refund = await fetchPaystackRefund({ creds: { secretKey: credentials.secretKey }, refundId: id });
      currency = refund.currency || ""; amount = fromPaystackAmountSubunits(Number(refund.amount), currency); status = String(refund.status || ""); returnedId = String(refund.id);
    } else continue;
    if (returnedId !== id || currency.toUpperCase() !== row.currency.toUpperCase()) throw new Error("Refund evidence differs from its stored provider identity");
    if (!providerStatuses[provider]?.has(status.toLowerCase())) throw new Error("Unrecognized provider refund status");
    await recordBizGatewayRefundReport(row.orderId, { id, amount, live: settledOrPending[provider].has(status.toLowerCase()), gatewayStatus: status, gatewayProvider: provider });
  }
}
