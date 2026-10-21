import { PAYOUT_ACCOUNTS, PAYOUT_TRANSITIONS, payoutUpdateAction, payoutUpdateFingerprint } from "./payout-policy";
export { PAYOUT_ACCOUNTS } from "./payout-policy";
import "server-only";
import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { Order, Payout, Vendor, getSettings } from "@/models";
import { VENDOR_STATUS } from "@/config/app.config";
import { ValidationError } from "@/lib/api/errors";
import { getExternalVendorFilter, isDefaultVendorRecord } from "@/lib/vendors/multi-vendor";
import { SETTLED_SUB_ORDER_PAYMENT_MATCH } from "@/lib/orders/order-payment-status";
import { resolvePreorderPolicy } from "@/lib/orders/preorder-gating";
import { resolveMinWithdrawal } from "@/lib/orders/order-settings";
import { quantizeToCurrency } from "@/lib/intl/money";
import type { AuditContext } from "@/lib/audit";
import { auditPayoutCreated, auditPayoutChanged } from "./audit-money";
import { afterResponse } from "@/lib/after-response";
import { financeQuery, financeSession, financeVersionFilter } from "./transaction";
import { financialFingerprint, runFinanceOperation, touchVendorFinance, staleFinance } from "./operations";
import { PAYABLE_ORDER_PROJECTION, buildPayableOrderFilter, earliestPayoutHoldCutoff, loadOrderIdsHeldForReturns, orderPayoutHoldCutoff, isPastPayoutHold, fetchRefundTotalsByOrder, fetchVendorOverpaymentBalance, sumVendorPayable, payableInCurrency } from "@/lib/vendors/vendor-earnings";
import { computePreorderReserve, claimMaturedReserves, unclaimReserves } from "@/lib/vendors/preorder-reserve";
import { commissionOwedForVendor, createCommissionInvoice, settleCommissionInvoiceByPayout, releaseCommissionInvoice } from "./commission-invoices";
import { payoutPaidPostings } from "./postings";
import { PAYOUT_REQUOTE_MESSAGE, describePayoutSourceChange } from "./payout-requote";
import { CommissionInvoice } from "@/models/commissionInvoice.model";
import type { PayableSubOrderLike } from "@/lib/vendors/vendor-earnings";
import { LedgerEntry } from "@/models/ledger-entry.model";
import type { LedgerPosting } from "./ledger";

export const PAYOUT_MAX_ORDERS = 500;
/** Orders read per query while looking for payable sales. */
const PAYOUT_CANDIDATE_BATCH = 1000;
/** Past this many orders read, the quote stops and says there is more. */
const PAYOUT_CANDIDATE_SCAN_LIMIT = 10_000;

function loadPayoutCandidates(filter: Record<string, unknown>, skip: number) {
  return financeQuery(Order.find(filter))
    .select(PAYABLE_ORDER_PROJECTION + " orderNumber")
    .sort({ createdAt: 1, _id: 1 })
    .skip(skip)
    .limit(PAYOUT_CANDIDATE_BATCH)
    .lean();
}

export const PAYOUT_FROZEN_REASON = "Payouts are frozen while this seller is suspended";

/** A suspended seller is paid nothing until restored; their sales keep accruing. */
async function isPayoutFrozen(vendorId: unknown): Promise<boolean> {
  const vendor = await financeQuery(Vendor.findById(vendorId)).select("status").lean<{ status?: string } | null>();
  return vendor?.status === VENDOR_STATUS.SUSPENDED;
}

/**
 * The dates a payout covers, by when each sale was ordered. The end is
 * required; the start may be left open — "everything payable up to the end" —
 * because a fixed window missed every sale ordered in one month and payable in
 * the next. Day-only dates include the whole last day.
 */
export function payoutRange(start?: string, end?: string) {
  if (!end) throw new ValidationError("Choose the payout end date");
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const calendar = day.test(end) && (!start || day.test(start));
  const from = start ? new Date(start) : undefined; const to = new Date(end);
  if ((from && !Number.isFinite(from.getTime())) || !Number.isFinite(to.getTime()) || (from && to < from) ||
      (calendar && ((from && from.toISOString().slice(0, 10) !== start) || to.toISOString().slice(0, 10) !== end))) throw new ValidationError("Invalid payout dates");
  return { periodStart: from, periodEnd: calendar ? new Date(to.getTime() + 86_400_000 - 1) : to, periodBoundary: !from ? "open" : calendar ? "calendar" : "timestamp" };
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

/**
 * Every currency a seller has something in: sales payable now, reserves held,
 * payouts and commission invoices already made. Cheap — a few distinct reads —
 * where a quote scans the seller's orders, so the scheduler can decide what to
 * do per currency before paying for one.
 */
async function sellerPayoutCurrencies(vendorId: Types.ObjectId, storeCurrency: string, range?: ReturnType<typeof payoutRange>) {
  const orderFilter = buildPayableOrderFilter(vendorId, range);
  const orderCurrencies = await financeQuery(Order.distinct("currency", orderFilter));
  const reservedCurrencies = await financeQuery(Payout.distinct("currency", { vendorId, status: "paid", preorderReserveHeld: { $gt: 0 } }));
  const historyCurrencies = await financeQuery(Payout.distinct("currency", { vendorId }));
  const invoiceCurrencies = await financeQuery(CommissionInvoice.distinct("currency", { vendorId }));
  const currencies = [...new Set([...orderCurrencies.map((value) => String(value || storeCurrency).toUpperCase()), ...reservedCurrencies.map(String), ...historyCurrencies.map(String), ...invoiceCurrencies.map(String)])].sort();
  if (!currencies.length) currencies.push(storeCurrency);
  return currencies;
}

export async function listPayoutCurrencies(vendorId: string): Promise<string[]> {
  if (!Types.ObjectId.isValid(vendorId)) throw new ValidationError("Valid vendorId is required");
  const settings = await getSettings();
  return sellerPayoutCurrencies(new Types.ObjectId(vendorId), String(settings.general?.defaultCurrency || "USD").toUpperCase());
}

/** The one calculation used by previews, creation and vendor ready balances. */
export async function quotePayout(input: PayoutQuoteInput) {
  if (!Types.ObjectId.isValid(input.vendorId)) throw new ValidationError("Valid vendorId is required");
  const settings = await getSettings();
  const storeCurrency = String(settings.general?.defaultCurrency || "USD").toUpperCase();
  const now = input.now ?? new Date();
  const range = input.periodStart || input.periodEnd ? payoutRange(input.periodStart, input.periodEnd) : undefined;
  const vendorId = new Types.ObjectId(input.vendorId);
  // A suspended seller's sales keep counting, but nothing is paid out to them
  // until an admin restores them.
  const frozen = await isPayoutFrozen(vendorId);
  const heldForReturns = await loadOrderIdsHeldForReturns(vendorId);
  const availableCurrencies = await sellerPayoutCurrencies(vendorId, storeCurrency, range);
  const currency = String(input.currency || (availableCurrencies.length === 1 ? availableCurrencies[0] : storeCurrency)).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ValidationError({ currency: ["Choose a valid currency"] });
  const currencyFilter = currency === storeCurrency ? { $or: [{ currency }, { currency: null }, { currency: "" }] } : { currency };
  const money = (n: number) => quantizeToCurrency(n, currency);
  const returnIds = new Set(heldForReturns.map(String));
  const isPayable = (sub: { vendorId?: unknown; status?: string; payoutStatus?: string; deliveredAt?: Date | string | null }, order: Parameters<typeof orderPayoutHoldCutoff>[0] & { _id?: unknown }) =>
    String(sub.vendorId) === input.vendorId && sub.status === "delivered" && !["scheduled", "paid"].includes(sub.payoutStatus ?? "") &&
    !returnIds.has(String(order?._id)) && isPastPayoutHold(sub, orderPayoutHoldCutoff(order, settings, now, vendorId));
  // The oldest 500 sales that are payable NOW. Counting the first 500 orders
  // and checking the hold afterwards let sales still inside their return
  // window (or held for a return) use up the 500, and a busy seller sat at
  // "Narrow the period" for good. The hold the database can check comes off
  // in the query; each order's own window is then checked here, batch by
  // batch, until 500 payable sales are found. What is left over goes in the
  // next payout.
  const candidateFilter = { $and: [buildPayableOrderFilter(vendorId, range, earliestPayoutHoldCutoff(now), heldForReturns), currencyFilter] };
  const ownOrders: Awaited<ReturnType<typeof loadPayoutCandidates>> = [];
  let hasMore = false;
  for (let scanned = 0; ; ) {
    const batch = await loadPayoutCandidates(candidateFilter, scanned);
    scanned += batch.length;
    for (const order of batch) {
      if (String(order.currency || storeCurrency).toUpperCase() !== currency) continue;
      if (!(order.subOrders ?? []).some((sub: PayableSubOrderLike) => isPayable(sub, order))) continue;
      if (ownOrders.length === PAYOUT_MAX_ORDERS) { hasMore = true; break; }
      ownOrders.push(order);
    }
    if (hasMore || batch.length < PAYOUT_CANDIDATE_BATCH) break;
    if (scanned >= PAYOUT_CANDIDATE_SCAN_LIMIT) { hasMore = true; break; }
  }
  const refunds = await fetchRefundTotalsByOrder(ownOrders.map((o) => o._id), now);
  const totals = payableInCurrency(sumVendorPayable(ownOrders, vendorId, refunds, isPayable, storeCurrency, { unfloored: true }), currency);
  const sourceIds = new Set(totals.orderIds);
  const eligibleOrders = ownOrders.filter((o) => sourceIds.has(String(o._id)));
  const reservePolicy = resolvePreorderPolicy(settings.preorder);
  const reserveHeld = computePreorderReserve({ orders: eligibleOrders, vendorId, refundByOrderId: refunds, isPayable: (sub) => eligibleOrders.some((order) => (order.subOrders ?? []).includes(sub) && isPayable(sub, order)), storeCurrency, payoutCurrency: currency, percent: reservePolicy.reservePercent });
  const reserves = await financeQuery(Payout.find({ vendorId, currency, status: "paid", paidAt: { $ne: null }, preorderReserveHeld: { $gt: 0 }, preorderReserveReleasedAt: null, preorderReserveReleasedInPayoutId: null, preorderReserveReleaseAt: { $lte: now } })).select("_id preorderReserveHeld").sort({ _id: 1 }).limit(500).lean();
  const reserveReleased = money(reserves.reduce((s, p) => s + Number(p.preorderReserveHeld), 0));
  const overpayment = await fetchVendorOverpaymentBalance({ vendorId, currency, storeCurrency });
  // Capped by what this payout would otherwise carry — the reserve it holds
  // back and the matured one it releases included. Capped at the earnings
  // alone, a seller who owed money was still paid their released reserve:
  // the very money the reserve existed to protect.
  const overpaymentRecovered = overpayment < 0 ? overpayment : money(Math.min(overpayment, Math.max(0, totals.netAmount - reserveHeld + reserveReleased)));
  const reserveCredit = await reserveReturnBalance(input.vendorId, currency);
  const reserveCreditRecovered = reserveCredit < 0 ? reserveCredit : money(Math.min(reserveCredit, Math.max(0, totals.netAmount - overpaymentRecovered - reserveHeld + reserveReleased)));
  const beforeCommission = money(totals.netAmount - overpaymentRecovered - reserveHeld + reserveReleased - reserveCreditRecovered);
  // Commission the seller owes on sales they took the money for: as much of
  // it as this payout has room for, oldest sales first; the rest waits for the
  // next payout or an invoice.
  const commissionCap = Math.max(0, beforeCommission);
  const owedInFull = await commissionOwedForVendor(vendorId, currency, undefined, true);
  const owed = owedInFull.amount > commissionCap
    ? await commissionOwedForVendor(vendorId, currency, undefined, true, { cap: commissionCap })
    : owedInFull;
  const commissionOffset = owed.amount;
  const commissionCredit = owed.storeOwes;
  const adjustments = money(-overpaymentRecovered - reserveHeld + reserveReleased - commissionOffset + commissionCredit - reserveCreditRecovered);
  const netAmount = money(totals.netAmount + adjustments);
  const minimum = resolveMinWithdrawal(settings, currency);
  const allocations = eligibleOrders.map((order) => {
    const amount = payableInCurrency(sumVendorPayable([order], vendorId, refunds, isPayable, storeCurrency, { unfloored: true }), currency);
    return { orderId: order._id, orderNumber: order.orderNumber, createdAt: order.createdAt, currency,
      vendorShare: amount.grossSales, vendorEarnings: amount.netAmount, commission: amount.commissionAmount, shipping: amount.shippingAmount,
      consignmentIds: (order.subOrders ?? []).filter((sub: PayableSubOrderLike) => isPayable(sub, order)).map((sub: PayableSubOrderLike & { _id?: unknown }) => sub._id),
      status: "delivered", paymentStatus: "paid" };
  });
  // Each order's figures are rounded on their own, so in a currency without
  // decimals the rows drifted from the totals (three 1,000.4 UGX sales listed
  // 3,000 under a 3,001 payout). What rounding left over goes on the largest row.
  for (const [field, total] of [["vendorEarnings", totals.netAmount], ["vendorShare", totals.grossSales], ["commission", totals.commissionAmount], ["shipping", totals.shippingAmount]] as const) {
    if (allocations.length === 0) break;
    const diff = money(total - allocations.reduce((sum, row) => sum + Number(row[field] || 0), 0));
    if (diff === 0) continue;
    const largest = allocations.reduce((best, row, index) => (Math.abs(Number(row[field] || 0)) > Math.abs(Number(allocations[best][field] || 0)) ? index : best), 0);
    allocations[largest][field] = money(Number(allocations[largest][field] || 0) + diff);
  }
  const breakdown = { eligibleEarnings: totals.netAmount, recoveryDeducted: Math.max(0, overpaymentRecovered), recoveryReturned: Math.max(0, -overpaymentRecovered), reserveHeld, reserveReleased, reserveCreditDeducted: Math.max(0, reserveCreditRecovered), reserveCreditReturned: Math.max(0, -reserveCreditRecovered), commissionOffset, commissionCredit, adjustments, netAmount };
  const calculationVersion = financialFingerprint({ currency, range, allocations, breakdown, reserveSources: reserves.map((r) => String(r._id)), minimum, reservePolicy, commissionOrders: owed.orderIds, creditApplied: owed.creditApplied });
  // Earnings that the commission the seller owes takes in full: nothing is left
  // to send, but both sides are still settled. It used to stop at "No payable
  // amount", leaving the sales unpaid and the commission uncollected until a
  // sale with more in it came along. The minimum withdrawal is about money
  // leaving, so it does not apply here.
  const settlesWithoutTransfer = !frozen && netAmount === 0 && commissionOffset > 0;
  const eligible = !frozen && netAmount > 0 && netAmount >= minimum;
  return { currency, availableCurrencies, range, calculatedAt: now, calculationVersion, grossSales: Math.max(0, totals.grossSales), commissionAmount: Math.max(0, totals.commissionAmount), shippingAmount: Math.max(0, totals.shippingAmount), ...breakdown, breakdown, overpaymentRecovered, reserveCreditRecovered, minimum,
    // More than 500 payable sales no longer blocks the payout: it takes the
    // oldest 500, and `hasMore` says the rest wait for the next one.
    // `eligible` is about money to send (the seller's ready balance);
    // `canCreate` is whether a payout can be drawn up at all.
    eligible, settlesWithoutTransfer, canCreate: eligible || settlesWithoutTransfer,
    eligibilityReason: frozen ? PAYOUT_FROZEN_REASON : netAmount <= 0 ? "No payable amount" : netAmount < minimum ? "Below minimum withdrawal" : null,
    frozen,
    hasMore, orderCount: allocations.length, allocations, reserveSourceIds: reserves.map((p) => p._id), commissionOwedNotDeducted: money(Math.max(0, owedInFull.amount - owed.amount)), commissionCap,
    // An estimate until the payout is paid: the hold counts from the day the
    // money actually leaves (see the paid branch of `updatePayout`).
    reserveReleaseAt: reserveHeld > 0 ? new Date(now.getTime() + reservePolicy.reserveDays * 86_400_000) : null,
    reserveDays: reservePolicy.reserveDays,
  };
}

/**
 * How many of these orders' deliveries for this seller rest on the seller's
 * own word (`deliveryAttestedBy: "vendor"`), for the admin to see before
 * paying them.
 */
export async function countSellerConfirmedDeliveries(vendorId: string, orderIds: unknown[]): Promise<number> {
  if (orderIds.length === 0) return 0;
  return Order.countDocuments({
    _id: { $in: orderIds },
    subOrders: { $elemMatch: { vendorId: new Types.ObjectId(vendorId), deliveryAttestedBy: "vendor" } },
  });
}

export async function createPayout(input: PayoutQuoteInput & { note?: string; requestKey: string; actorId: string; expectedCalculationVersion?: string; auditContext: AuditContext }) {
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new ValidationError("Payouts require multi-vendor mode");
  payoutRange(input.periodStart, input.periodEnd);
  let created: Record<string, unknown> | undefined;
  const outcome = await runFinanceOperation({
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
      if (!quote.canCreate) throw new ValidationError(quote.eligibilityReason!);
      const payout = new Payout({ payoutNumber: `PAYOUT-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`, vendorId: input.vendorId, ...quote.range, periodStart: quote.range?.periodStart ?? quote.allocations[0]?.createdAt ?? quote.range?.periodEnd, currency: quote.currency,
        orderIds: quote.allocations.map((a) => a.orderId), grossSales: quote.grossSales, commissionAmount: quote.commissionAmount, shippingAmount: quote.shippingAmount, eligibleEarnings: quote.eligibleEarnings, netAmount: quote.netAmount, adjustments: quote.adjustments, overpaymentRecovered: quote.overpaymentRecovered, reserveCreditRecovered: quote.reserveCreditRecovered, commissionOffset: quote.commissionOffset, commissionCredit: quote.commissionCredit,
        preorderReserveHeld: quote.reserveHeld, preorderReserveReleased: quote.reserveReleased, preorderReserveReleaseAt: quote.reserveReleaseAt, ...(quote.reserveHeld > 0 ? { preorderReserveDays: quote.reserveDays } : {}),
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
        const invoice = await createCommissionInvoice({ vendorId: input.vendorId, currency: quote.currency, userId: input.actorId, payoutId: payout._id, cap: quote.commissionCap, note: `Settled in ${payout.payoutNumber}` });
        if (!invoice || invoice.amount !== quote.commissionOffset || invoice.storeOwes !== quote.commissionCredit) throw staleFinance();
        payout.commissionInvoiceId = invoice.invoiceId;
      }
      await payout.save({ session: financeSession() });
      await auditPayoutCreated(input.auditContext, { _id: payout._id, payoutNumber: payout.payoutNumber, vendorId: input.vendorId, currency: quote.currency, periodStart: payout.periodStart, periodEnd: payout.periodEnd, grossSales: quote.grossSales, commissionAmount: quote.commissionAmount, adjustments: quote.adjustments, netAmount: quote.netAmount, orderCount: quote.orderCount }, vendor.storeName);
      created = payout.toObject();
      return { result: { payoutId: String(payout._id), payoutNumber: payout.payoutNumber, ...quote.breakdown }, sourceId: payout._id, vendorId: input.vendorId, postings: [] };
    },
  });
  // Told once the payout exists for good; a replayed request ran no work.
  if (created) notifyPayoutAfterCommit(created, "created");
  return outcome;
}

/** The seller hears what happened to their payout — after the commit, never inside it. */
function notifyPayoutAfterCommit(payout: Record<string, unknown>, event: "created" | "paid" | "returned" | "failed" | "cancelled") {
  afterResponse(async () => {
    const { notifyVendorPayout } = await import("@/lib/notifications/notifications");
    await notifyVendorPayout({ payout: payout as Parameters<typeof notifyVendorPayout>[0]["payout"], event });
  });
}


export async function updatePayout(input: { id: string; actorId: string; requestKey: string; expectedVersion: number; status?: string; note?: string; paidFrom?: string; paymentReference?: string; reversedAt?: string; auditContext: AuditContext }) {
  let movement: { from: string; payout: Record<string, unknown> } | undefined;
  const outcome = await runFinanceOperation({
    action: payoutUpdateAction(input.id), actorId: input.actorId, requestKey: input.requestKey,
    fingerprint: payoutUpdateFingerprint(input),
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
      if (moved && ["processing", "paid"].includes(status) && await isPayoutFrozen(payout.vendorId)) {
        throw new ValidationError(`${PAYOUT_FROZEN_REASON}. Restore the seller first, or cancel this payout.`);
      }
      if (moved && status === "paid") {
        if (payout.requiresRequote) throw new ValidationError(`${payout.requoteReason ? `${payout.requoteReason} ` : ""}${PAYOUT_REQUOTE_MESSAGE}`);
        // Re-read what the payout claimed: a flag can be missed, this cannot.
        const changed = await describePayoutSourceChange(payout);
        if (changed) throw new ValidationError(`${changed} ${PAYOUT_REQUOTE_MESSAGE}`);
        // A payout that settles earnings against commission sends nothing, so
        // there is no account it left from.
        const sendsMoney = Number(payout.netAmount) > 0;
        if (sendsMoney && !PAYOUT_ACCOUNTS.includes(payout.paidFrom)) throw new ValidationError({ paidFrom: ["Choose the account the payment left"] });
        // A bank transfer needs somewhere to go. Recorded as sent with no
        // account on file, nobody could say where the money went.
        if (sendsMoney && payout.paidFrom === "bank") {
          const seller = await financeQuery(Vendor.findById(payout.vendorId)).select("bankDetails").lean<{ bankDetails?: { accountName?: string; accountNumber?: string } | null } | null>();
          if (!seller?.bankDetails?.accountName?.trim() || !seller.bankDetails.accountNumber?.trim()) {
            throw new ValidationError({ paidFrom: ["Add the seller's bank details before recording a bank payment"] });
          }
        }
        payout.paidAt = now; payout.paidBy = input.actorId;
        // The reserve is held from the day the money left, not the day the
        // payout was drawn up — one paid a month late released a month early.
        if (Number(payout.preorderReserveHeld) > 0 && Number(payout.preorderReserveDays) > 0) {
          payout.preorderReserveReleaseAt = new Date(now.getTime() + Number(payout.preorderReserveDays) * 86_400_000);
        }
        payout.settlementSnapshot = { paidAt: now, paidFrom: payout.paidFrom, paymentReference: payout.paymentReference, netAmount: payout.netAmount, currency: payout.currency, paidBy: input.actorId };
        postings = payoutPaidPostings(payout.toObject()); payout.settlementPostings = postings;
        const stamped = await financeQuery(Order.updateMany({ "subOrders.payoutId": payout._id }, { $set: { "subOrders.$[sub].payoutStatus": "paid", "subOrders.$[sub].payoutDate": now } }, { arrayFilters: [{ "sub.payoutId": payout._id, "sub.vendorId": payout.vendorId }] }));
        // Every sale the payout was made of takes the stamp, or the payment does
        // not happen: a claim missing here would let the sale be drawn into a
        // second payout and paid twice.
        if (Array.isArray(payout.allocations) && payout.allocations.length > 0 && stamped.matchedCount !== payout.allocations.length) throw new ValidationError(`Orders in this payout changed after it was made. ${PAYOUT_REQUOTE_MESSAGE}`);
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
          if (destinationId) await financeQuery(Payout.updateOne({ _id: destinationId, status: { $in: ["pending", "processing"] } }, { $set: { requiresRequote: true, requoteReason: "A reserve this payout releases came back with a returned payment." }, $inc: { version: 1 } }));
        }
        await financeQuery(Order.updateMany({ "subOrders.payoutId": payout._id }, { $set: { "subOrders.$[sub].payoutStatus": "unpaid" }, $unset: { "subOrders.$[sub].payoutId": "", "subOrders.$[sub].payoutDate": "", "subOrders.$[sub].payoutClaimedAt": "" } }, { arrayFilters: [{ "sub.payoutId": payout._id, "sub.vendorId": payout.vendorId }] }));
        await unclaimReserves({ vendorId: payout.vendorId, payoutId: payout._id });
        if (payout.commissionInvoiceId && await releaseCommissionInvoice(payout.commissionInvoiceId, previous.status === "paid" ? "reversed" : "cancelled") === null) throw new ValidationError("Commission ownership changed");
      }
      payout.status = status; payout.version = input.expectedVersion + 1;
      if (moved) payout.statusHistory.push({ status, at: payout.reversedAt && status === "failed" ? payout.reversedAt : now, by: input.actorId, note: input.note?.trim() });
      await payout.save({ session: financeSession() });
      await auditPayoutChanged(input.auditContext, payout, { before: previous, after: payout, reason: input.note });
      if (moved) movement = { from: previous.status, payout: payout.toObject() };
      return { result: payout.toObject(), sourceId: payout._id, vendorId: payout.vendorId, postings };
    },
  });
  if (movement) {
    const to = String(movement.payout.status);
    const event = to === "paid" ? "paid" : to === "cancelled" ? "cancelled" : to === "failed" ? (movement.from === "paid" ? "returned" : "failed") : null;
    if (event) notifyPayoutAfterCommit(movement.payout, event);
  }
  return outcome;
}
