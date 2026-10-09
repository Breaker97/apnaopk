import { PAYOUT_ACCOUNTS, PAYOUT_TRANSITIONS } from "./payout-policy";
export { PAYOUT_ACCOUNTS } from "./payout-policy";
import "server-only";
import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { Order, Payout, Vendor, getSettings } from "@/models";
import { ApiError, ValidationError } from "@/lib/api/errors";
import { getExternalVendorFilter, isDefaultVendorRecord } from "@/lib/vendors/multi-vendor";
import { SETTLED_SUB_ORDER_PAYMENT_MATCH } from "@/lib/orders/order-payment-status";
import { resolvePreorderPolicy } from "@/lib/orders/preorder-gating";
import { resolveMinWithdrawal } from "@/lib/orders/order-settings";
import { quantizeToCurrency } from "@/lib/intl/money";
import { createAuditContext } from "@/lib/audit";
import type { AuditContext } from "@/lib/audit";
import { auditPayoutCreated, auditPayoutChanged } from "./audit-money";
import { financeQuery, financeSession, financeVersionFilter } from "./transaction";
import { financialFingerprint, runFinanceOperation, touchVendorFinance, staleFinance } from "./operations";
import { PAYABLE_ORDER_PROJECTION, buildPayableOrderFilter, loadOrderIdsHeldForReturns, orderPayoutHoldCutoff, isPastPayoutHold, fetchRefundTotalsByOrder, fetchVendorOverpaymentBalance, sumVendorPayable, payableInCurrency } from "@/lib/vendors/vendor-earnings";
import { computePreorderReserve, claimMaturedReserves, unclaimReserves } from "@/lib/vendors/preorder-reserve";
import { commissionOwedForVendor, createCommissionInvoice, settleCommissionInvoiceByPayout, releaseCommissionInvoice } from "./commission-invoices";
import { payoutPaidPostings } from "./postings";
import { CommissionInvoice } from "@/models/commissionInvoice.model";
import type { PayableSubOrderLike } from "@/lib/vendors/vendor-earnings";
import { LedgerEntry } from "@/models/ledger-entry.model";
import type { LedgerPosting } from "./ledger";

export const PAYOUT_MAX_ORDERS = 500;

export function payoutRange(start?: string, end?: string) {
  if (!start || !end) throw new ValidationError("Choose both payout dates");
  const calendar = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end);
  const from = new Date(start); const to = new Date(end);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from ||
      (calendar && (from.toISOString().slice(0, 10) !== start || to.toISOString().slice(0, 10) !== end))) throw new ValidationError("Invalid payout dates");
  // Preserve the existing inclusive timestamp contract; day-only selections include the last day.
  return { periodStart: from, periodEnd: calendar ? new Date(to.getTime() + 86_400_000 - 1) : to, periodBoundary: calendar ? "calendar" : "timestamp" };
}

export type PayoutQuoteInput = { vendorId: string; currency?: string; periodStart?: string; periodEnd?: string; now?: Date };

async function reserveReturnBalance(vendorId: string, currency: string) {
  const sources = await financeQuery(Payout.find({ vendorId, currency, status: "failed", paidAt: { $ne: null }, preorderReserveHeld: { $gt: 0 } })).select("preorderReserveHeld preorderReserveReleasedInPayoutId").lean();
  const destinations = await financeQuery(Payout.find({ _id: { $in: sources.flatMap((s) => s.preorderReserveReleasedInPayoutId ? [s.preorderReserveReleasedInPayoutId] : []) }, status: "paid" })).select("_id").lean();
  const paid = new Set(destinations.map((d) => String(d._id)));
  const held = sources.reduce((sum, s) => sum + (paid.has(String(s.preorderReserveReleasedInPayoutId)) ? Number(s.preorderReserveHeld) : 0), 0);
  const recoveries = await financeQuery(Payout.find({ vendorId, currency, status: { $nin: ["failed", "cancelled"] }, reserveCreditRecovered: { $exists: true } })).select("reserveCreditRecovered").lean();
  return quantizeToCurrency(held - recoveries.reduce((sum, p) => sum + Number(p.reserveCreditRecovered || 0), 0), currency);
}

/** The one calculation used by previews, creation and vendor ready balances. */
export async function quotePayout(input: PayoutQuoteInput) {
  if (!Types.ObjectId.isValid(input.vendorId)) throw new ValidationError("Valid vendorId is required");
  const settings = await getSettings();
  const storeCurrency = String(settings.general?.defaultCurrency || "USD").toUpperCase();
  const now = input.now ?? new Date();
  const range = input.periodStart || input.periodEnd ? payoutRange(input.periodStart, input.periodEnd) : undefined;
  const vendorId = new Types.ObjectId(input.vendorId);
  const heldForReturns = await loadOrderIdsHeldForReturns(vendorId);
  const orderFilter = buildPayableOrderFilter(vendorId, range);
  const orderCurrencies = await financeQuery(Order.distinct("currency", orderFilter));
  const reservedCurrencies = await financeQuery(Payout.distinct("currency", { vendorId, status: "paid", preorderReserveHeld: { $gt: 0 } }));
  const historyCurrencies = await financeQuery(Payout.distinct("currency", { vendorId }));
  const invoiceCurrencies = await financeQuery(CommissionInvoice.distinct("currency", { vendorId }));
  const availableCurrencies = [...new Set([...orderCurrencies.map((value) => String(value || storeCurrency).toUpperCase()), ...reservedCurrencies.map(String), ...historyCurrencies.map(String), ...invoiceCurrencies.map(String)])].sort();
  if (!availableCurrencies.length) availableCurrencies.push(storeCurrency);
  const currency = String(input.currency || (availableCurrencies.length === 1 ? availableCurrencies[0] : storeCurrency)).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ValidationError({ currency: ["Choose a valid currency"] });
  const currencyFilter = currency === storeCurrency ? { $or: [{ currency }, { currency: null }, { currency: "" }] } : { currency };
  const orders = await financeQuery(Order.find({ $and: [orderFilter, currencyFilter] })).select(PAYABLE_ORDER_PROJECTION + " orderNumber createdAt").sort({ createdAt: 1, _id: 1 }).limit(PAYOUT_MAX_ORDERS + 1).lean();
  const money = (n: number) => quantizeToCurrency(n, currency);
  const ownOrders = orders.filter((o) => String(o.currency || storeCurrency).toUpperCase() === currency);
  const returnIds = new Set(heldForReturns.map(String));
  const isPayable = (sub: { vendorId?: unknown; status?: string; payoutStatus?: string; deliveredAt?: Date | string | null }, order: Parameters<typeof orderPayoutHoldCutoff>[0] & { _id?: unknown }) =>
    String(sub.vendorId) === input.vendorId && sub.status === "delivered" && !["scheduled", "paid"].includes(sub.payoutStatus ?? "") &&
    !returnIds.has(String(order?._id)) && isPastPayoutHold(sub, orderPayoutHoldCutoff(order, settings, now, vendorId));
  const refunds = await fetchRefundTotalsByOrder(ownOrders.map((o) => o._id), now);
  const totals = payableInCurrency(sumVendorPayable(ownOrders, vendorId, refunds, isPayable, storeCurrency, { unfloored: true }), currency);
  const sourceIds = new Set(totals.orderIds);
  const eligibleOrders = ownOrders.filter((o) => sourceIds.has(String(o._id)));
  const reservePolicy = resolvePreorderPolicy(settings.preorder);
  const reserveHeld = computePreorderReserve({ orders: eligibleOrders, vendorId, refundByOrderId: refunds, isPayable: (sub) => eligibleOrders.some((order) => (order.subOrders ?? []).includes(sub) && isPayable(sub, order)), storeCurrency, payoutCurrency: currency, percent: reservePolicy.reservePercent });
  const reserves = await financeQuery(Payout.find({ vendorId, currency, status: "paid", paidAt: { $ne: null }, preorderReserveHeld: { $gt: 0 }, preorderReserveReleasedAt: null, preorderReserveReleasedInPayoutId: null, preorderReserveReleaseAt: { $lte: now } })).select("_id preorderReserveHeld").sort({ _id: 1 }).limit(500).lean();
  const reserveReleased = money(reserves.reduce((s, p) => s + Number(p.preorderReserveHeld), 0));
  const overpayment = await fetchVendorOverpaymentBalance({ vendorId, currency });
  const overpaymentRecovered = overpayment < 0 ? overpayment : money(Math.min(overpayment, Math.max(0, totals.netAmount)));
  const reserveCredit = await reserveReturnBalance(input.vendorId, currency);
  const reserveCreditRecovered = reserveCredit < 0 ? reserveCredit : money(Math.min(reserveCredit, Math.max(0, totals.netAmount - overpaymentRecovered - reserveHeld + reserveReleased)));
  const beforeCommission = money(totals.netAmount - overpaymentRecovered - reserveHeld + reserveReleased - reserveCreditRecovered);
  const owed = await commissionOwedForVendor(vendorId, currency, undefined, true);
  const canOffset = (owed.amount > 0 && owed.amount <= beforeCommission) || owed.storeOwes > 0;
  const commissionOffset = canOffset ? owed.amount : 0;
  const commissionCredit = canOffset ? owed.storeOwes : 0;
  const adjustments = money(-overpaymentRecovered - reserveHeld + reserveReleased - commissionOffset + commissionCredit - reserveCreditRecovered);
  const netAmount = money(totals.netAmount + adjustments);
  const minimum = resolveMinWithdrawal(settings, currency);
  const hasMore = orders.length > PAYOUT_MAX_ORDERS;
  const allocations = eligibleOrders.map((order) => {
    const amount = payableInCurrency(sumVendorPayable([order], vendorId, refunds, isPayable, storeCurrency, { unfloored: true }), currency);
    return { orderId: order._id, orderNumber: order.orderNumber, createdAt: order.createdAt, currency,
      vendorShare: amount.grossSales, vendorEarnings: amount.netAmount, commission: amount.commissionAmount, shipping: amount.shippingAmount,
      consignmentIds: (order.subOrders ?? []).filter((sub: PayableSubOrderLike) => isPayable(sub, order)).map((sub: PayableSubOrderLike & { _id?: unknown }) => sub._id),
      status: "delivered", paymentStatus: "paid" };
  });
  const breakdown = { eligibleEarnings: totals.netAmount, recoveryDeducted: Math.max(0, overpaymentRecovered), recoveryReturned: Math.max(0, -overpaymentRecovered), reserveHeld, reserveReleased, reserveCreditDeducted: Math.max(0, reserveCreditRecovered), reserveCreditReturned: Math.max(0, -reserveCreditRecovered), commissionOffset, commissionCredit, adjustments, netAmount };
  const calculationVersion = financialFingerprint({ currency, range, allocations, breakdown, reserveSources: reserves.map((r) => String(r._id)), minimum, reservePolicy, commissionOrders: owed.orderIds, creditApplied: owed.creditApplied });
  return { currency, availableCurrencies, range, calculatedAt: now, calculationVersion, grossSales: Math.max(0, totals.grossSales), commissionAmount: Math.max(0, totals.commissionAmount), shippingAmount: Math.max(0, totals.shippingAmount), ...breakdown, breakdown, overpaymentRecovered, reserveCreditRecovered, minimum,
    eligible: !hasMore && netAmount > 0 && netAmount >= minimum,
    eligibilityReason: hasMore ? "Narrow the period: a payout can claim at most 500 orders" : netAmount <= 0 ? "No payable amount" : netAmount < minimum ? "Below minimum withdrawal" : null,
    hasMore, orderCount: allocations.length, allocations, reserveSourceIds: reserves.map((p) => p._id), commissionOwedNotDeducted: canOffset ? 0 : owed.amount,
    reserveReleaseAt: reserveHeld > 0 ? new Date(now.getTime() + reservePolicy.reserveDays * 86_400_000) : null,
  };
}

export async function createPayout(input: PayoutQuoteInput & { note?: string; requestKey: string; actorId: string; expectedCalculationVersion?: string; auditContext: AuditContext }) {
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new ValidationError("Payouts require multi-vendor mode");
  payoutRange(input.periodStart, input.periodEnd);
  return runFinanceOperation({
    action: "payout:create", actorId: input.actorId, requestKey: input.requestKey,
    fingerprint: { vendorId: input.vendorId, currency: input.currency, periodStart: input.periodStart, periodEnd: input.periodEnd, note: input.note, expectedCalculationVersion: input.expectedCalculationVersion },
    work: async () => {
  const vendor = await financeQuery(Vendor.findOne({ ...getExternalVendorFilter(), _id: input.vendorId })).select("storeName isDefault").lean();
  if (!vendor || isDefaultVendorRecord(vendor)) throw new ValidationError("Vendor not found");
      await touchVendorFinance(input.vendorId, input.currency || settings.general?.defaultCurrency || "USD");
      const quote = await quotePayout(input);
      if (quote.currency !== (input.currency || settings.general?.defaultCurrency || "USD")) await touchVendorFinance(input.vendorId, quote.currency);
      if (input.expectedCalculationVersion && input.expectedCalculationVersion !== quote.calculationVersion) throw staleFinance();
      if (!input.currency && quote.availableCurrencies.length > 1) throw new ValidationError({ currency: ["Choose the payout currency"] });
      if (!quote.eligible) throw new ValidationError(quote.eligibilityReason!);
      const payout = new Payout({ payoutNumber: `PAYOUT-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`, vendorId: input.vendorId, ...quote.range, currency: quote.currency,
        orderIds: quote.allocations.map((a) => a.orderId), grossSales: quote.grossSales, commissionAmount: quote.commissionAmount, shippingAmount: quote.shippingAmount, eligibleEarnings: quote.eligibleEarnings, netAmount: quote.netAmount, adjustments: quote.adjustments, overpaymentRecovered: quote.overpaymentRecovered, reserveCreditRecovered: quote.reserveCreditRecovered, commissionOffset: quote.commissionOffset, commissionCredit: quote.commissionCredit,
        preorderReserveHeld: quote.reserveHeld, preorderReserveReleased: quote.reserveReleased, preorderReserveReleaseAt: quote.reserveReleaseAt,
        reserveSourceIds: quote.reserveSourceIds, breakdown: quote.breakdown, allocations: quote.allocations, calculationVersion: quote.calculationVersion, calculatedAt: quote.calculatedAt, note: input.note?.trim(), status: "pending", createdBy: input.actorId,
        statusHistory: [{ status: "pending", at: quote.calculatedAt, by: input.actorId }],
      });
      for (const allocation of quote.allocations) {
        const claim = await financeQuery(Order.updateOne({ _id: allocation.orderId, ...buildPayableOrderFilter(input.vendorId, quote.range) }, {
          $set: { "subOrders.$[sub].payoutStatus": "scheduled", "subOrders.$[sub].payoutId": payout._id, "subOrders.$[sub].payoutClaimedAt": quote.calculatedAt },
        }, { arrayFilters: [{ "sub.vendorId": new Types.ObjectId(input.vendorId), "sub.status": "delivered", "sub.payoutStatus": { $nin: ["scheduled", "paid"] }, "sub.paymentStatus": SETTLED_SUB_ORDER_PAYMENT_MATCH, ...(allocation.consignmentIds.length ? { "sub._id": { $in: allocation.consignmentIds } } : {}) }] }));
        if (!claim.modifiedCount) throw staleFinance();
      }
      const reserved = await claimMaturedReserves({ vendorId: input.vendorId, currency: quote.currency, payoutId: payout._id, now: quote.calculatedAt });
      if (reserved.amount !== quote.reserveReleased) throw staleFinance();
      if (quote.commissionOffset || quote.commissionCredit) {
        const invoice = await createCommissionInvoice({ vendorId: input.vendorId, currency: quote.currency, userId: input.actorId, payoutId: payout._id, note: `Settled in ${payout.payoutNumber}` });
        if (!invoice || invoice.amount !== quote.commissionOffset || invoice.storeOwes !== quote.commissionCredit) throw staleFinance();
        payout.commissionInvoiceId = invoice.invoiceId;
      }
      await payout.save({ session: financeSession() });
      await auditPayoutCreated(input.auditContext, { _id: payout._id, payoutNumber: payout.payoutNumber, vendorId: input.vendorId, currency: quote.currency, periodStart: quote.range!.periodStart, periodEnd: quote.range!.periodEnd, grossSales: quote.grossSales, commissionAmount: quote.commissionAmount, adjustments: quote.adjustments, netAmount: quote.netAmount, orderCount: quote.orderCount }, vendor.storeName);
      return { result: { payoutId: String(payout._id), payoutNumber: payout.payoutNumber, ...quote.breakdown }, sourceId: payout._id, vendorId: input.vendorId, postings: [] };
    },
  });
}


export async function updatePayout(input: { id: string; actorId: string; requestKey: string; expectedVersion: number; status?: string; note?: string; paidFrom?: string; paymentReference?: string; reversedAt?: string; auditContext: AuditContext }) {
  return runFinanceOperation({
    action: `payout:update:${input.id}`, actorId: input.actorId, requestKey: input.requestKey,
    fingerprint: { status: input.status, note: input.note, paidFrom: input.paidFrom, paymentReference: input.paymentReference, reversedAt: input.reversedAt, version: input.expectedVersion },
    work: async () => {
      const payout = await financeQuery(Payout.findOne({ _id: input.id, ...financeVersionFilter(input.expectedVersion) }));
      if (!payout) throw staleFinance();
      await touchVendorFinance(payout.vendorId, payout.currency);
      const previous = payout.toObject(); const status = input.status || payout.status; const moved = status !== payout.status;
      if (!PAYOUT_TRANSITIONS[payout.status]?.includes(status)) throw new ValidationError("Invalid payout transition");
      if (input.paidFrom !== undefined && input.paidFrom !== "" && !PAYOUT_ACCOUNTS.includes(input.paidFrom as typeof PAYOUT_ACCOUNTS[number])) throw new ValidationError({ paidFrom: ["Choose bank, cash or gateway"] });
      if (payout.paidAt && input.paidFrom !== undefined && input.paidFrom !== (payout.paidFrom || payout.settlementSnapshot?.paidFrom || "")) throw new ValidationError("The settled account cannot be changed");
      if (input.note !== undefined) payout.note = input.note.trim();
      if (input.paymentReference !== undefined) payout.paymentReference = input.paymentReference.trim();
      if (input.paidFrom !== undefined && !payout.paidAt) payout.paidFrom = input.paidFrom || undefined;
      const now = new Date(); let postings: LedgerPosting[] = [];
      if (moved && status === "paid") {
        if (payout.requiresRequote) throw new ValidationError("A reserve source changed. Cancel and create a new payout quote");
        if (!PAYOUT_ACCOUNTS.includes(payout.paidFrom)) throw new ValidationError({ paidFrom: ["Choose the account the payment left"] });
        payout.paidAt = now; payout.paidBy = input.actorId;
        payout.settlementSnapshot = { paidAt: now, paidFrom: payout.paidFrom, paymentReference: payout.paymentReference, netAmount: payout.netAmount, currency: payout.currency, paidBy: input.actorId };
        postings = payoutPaidPostings(payout.toObject()); payout.settlementPostings = postings;
        await financeQuery(Order.updateMany({ "subOrders.payoutId": payout._id }, { $set: { "subOrders.$[sub].payoutStatus": "paid", "subOrders.$[sub].payoutDate": now } }, { arrayFilters: [{ "sub.payoutId": payout._id, "sub.vendorId": payout.vendorId }] }));
        if (payout.commissionInvoiceId) {
          const settled = await settleCommissionInvoiceByPayout({ invoiceId: payout.commissionInvoiceId, payoutId: payout._id, paidAt: now });
          if (!settled.settled) throw new ValidationError("This commission invoice was settled elsewhere");
        }
        await financeQuery(Payout.updateMany({ preorderReserveReleasedInPayoutId: payout._id }, { $set: { preorderReserveReleasedAt: now } }));
      } else if (moved && ["failed", "cancelled"].includes(status)) {
        if (previous.status === "paid") {
          if (!input.note?.trim()) throw new ValidationError("Explain why the payment returned");
          const at = input.reversedAt ? new Date(input.reversedAt) : now;
          if (!Number.isFinite(at.getTime()) || at < previous.paidAt || at > now) throw new ValidationError("Invalid return date");
          payout.reversedAt = at; payout.reversedBy = input.actorId;
          let original = previous.settlementPostings as LedgerPosting[] | undefined;
          if (!original?.length) {
            original = await financeQuery(LedgerEntry.find({ "source.kind": "payout", "source.id": payout._id, key: { $not: /:reversal$/ } })).lean() as LedgerPosting[];
            if (!original.length) throw new ValidationError("Historical settlement evidence is missing; review the payout before reversing it");
          }
          postings = original.map((p) => ({ ...p, date: at, debit: p.credit, credit: p.debit, key: `${p.key}:reversal`, note: "Payout returned" }));
          const destinationId = previous.preorderReserveReleasedInPayoutId;
          if (destinationId) await financeQuery(Payout.updateOne({ _id: destinationId, status: { $in: ["pending", "processing"] } }, { $set: { requiresRequote: true }, $inc: { version: 1 } }));
        }
        await financeQuery(Order.updateMany({ "subOrders.payoutId": payout._id }, { $set: { "subOrders.$[sub].payoutStatus": "unpaid" }, $unset: { "subOrders.$[sub].payoutId": "", "subOrders.$[sub].payoutDate": "", "subOrders.$[sub].payoutClaimedAt": "" } }, { arrayFilters: [{ "sub.payoutId": payout._id, "sub.vendorId": payout.vendorId }] }));
        await unclaimReserves({ vendorId: payout.vendorId, payoutId: payout._id });
        if (payout.commissionInvoiceId && await releaseCommissionInvoice(payout.commissionInvoiceId, previous.status === "paid" ? "reversed" : "cancelled") === null) throw new ValidationError("Commission ownership changed");
      }
      payout.status = status; payout.version = input.expectedVersion + 1;
      if (moved) payout.statusHistory.push({ status, at: payout.reversedAt && status === "failed" ? payout.reversedAt : now, by: input.actorId, note: input.note?.trim() });
      await payout.save({ session: financeSession() });
      await auditPayoutChanged(input.auditContext, payout, { before: previous, after: payout, reason: input.note });
      return { result: payout.toObject(), sourceId: payout._id, vendorId: payout.vendorId, postings };
    },
  });
}
