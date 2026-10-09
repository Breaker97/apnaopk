import { Types } from "mongoose";
import "server-only";
import { Expense } from "@/models/expense.model";
import { Payout } from "@/models/payout.model";
import { PlatformPayment } from "@/models/platformPayment.model";
import { VendorSubscriptionPayment } from "@/models/vendorSubscriptionPayment.model";
import { Order } from "@/models/order.model";
import { LedgerEntry } from "@/models/ledger-entry.model";
import { FinanceOperation } from "@/models/finance-operation.model";
import { CollectionReceipt } from "@/models/collection-receipt.model";
import { getTransactionSupport } from "@/lib/db-transaction";
import { financialFingerprint, recoverFinanceOperations, runFinanceOperation } from "./operations";
import { replayPlatformPayment, replaySubscriptionInvoice } from "./payment-ledger";
import { collectionReceipts, recordOrderCollections } from "./collections";
import { expensePostings, expenseSettlementPostings, payoutPaidPostings } from "./postings";
import { ApiError } from "@/lib/api/errors";

export type FinanceIssue = { kind: string; source: string; sourceId: string; vendorId?: string; currency?: string; fingerprint: string; repair: "replay" | "review"; reason: string };
const sources = { expenses: Expense, payouts: Payout, payments: PlatformPayment, subscriptions: VendorSubscriptionPayment, orders: Order };
export async function financeReliabilityReport() {
  const issues: FinanceIssue[] = [];
  const checked: Record<string, number> = {};
  for (const [source, model] of Object.entries(sources)) {
    let cursor: string | undefined; checked[source] = 0;
    for (;;) {
      const rows = await model.collection.find(cursor ? { _id: { $gt: new Types.ObjectId(cursor) } } : {}).sort({ _id: 1 }).limit(200).toArray();
      if (!rows.length) break;
      for (const row of rows) {
        checked[source]++;
        const id = String(row._id);
        const ledger = await LedgerEntry.find({ "source.id": row._id }).sort({ key: 1 }).lean();
        const fingerprint = financialFingerprint({ row, ledger });
        const add = (kind: string, repair: "replay" | "review", reason: string) => issues.push({ kind, source, sourceId: id, vendorId: row.vendorId ? String(row.vendorId) : undefined, currency: row.currency, fingerprint, repair, reason });
        if (source === "expenses" && row.scope !== "vendor") {
          const expected = [...expensePostings(row), ...(row.settlement ? expenseSettlementPostings({ ...row, settlement: row.settlement }) : [])];
          if (expected.some((posting) => !ledger.some((entry) => entry.key === posting.key && entry.amount === posting.amount && entry.debit === posting.debit && entry.credit === posting.credit))) add("expense-history", "review", "Current financial revision/settlement disagrees with original ledger; audit evidence is required");
        } else if (source === "payouts") {
          if (row.paidAt && !row.settlementSnapshot && !ledger.length) add("settlement-evidence", "review", "Historical account and amount must be established before repair");
          if (row.status === "paid") {
            const expected = row.settlementPostings?.length ? row.settlementPostings : payoutPaidPostings(row);
            if (expected.some((posting: { key: string; amount: number; debit: string; credit: string }) => !ledger.some((entry) => entry.key === posting.key && entry.amount === posting.amount && entry.debit === posting.debit && entry.credit === posting.credit))) add("payout-ledger", "review", "Missing or inconsistent payout legs; use its durable operation or verify transfer evidence");
            if (await Order.exists({ subOrders: { $elemMatch: { payoutId: row._id, payoutStatus: { $ne: "paid" } } } })) add("payout-stamps", "review", "Paid payout has unfinished order effects");
          }
          if (row.preorderReserveReleasedInPayoutId && row.status !== "paid") add("reserve-source", "review", "An unpaid/returned payout owns a downstream reserve allocation; inspect downstream settlement");
        } else if (source === "payments" && row.paidAt && ["paid", "refunded"].includes(row.status)) {
          if (!row.benefitGrantedAt && !ledger.some((entry) => entry.credit === "unapplied_payment_payable")) add("unapplied-payment", "replay", "Received cash needs a liability reclassification; no benefit is granted by repair");
          if (!ledger.length || (row.refundedAmount || 0) > (row.ledgerRefundAcceptedAmount || 0)) add("payment-event", "replay", "Receipt/application/refund event is missing; legacy refund dates remain estimates when evidence is absent");
        } else if (source === "subscriptions" && row.provider === "stripe" && row.amountPaid > 0 && ["paid", "refunded"].includes(row.status)) {
          if (!ledger.length || row.amountRefunded !== row.ledgerRefundAcceptedAmount) add("subscription-event", "replay", "Invoice receipt or incremental refund is missing");
        } else if (source === "orders") {
          for (const sub of row.subOrders || []) if (sub.payoutStatus === "scheduled" && sub.payoutId) {
            const owner = await Payout.findById(sub.payoutId).select("status").lean();
            if (!owner || ["failed", "cancelled"].includes(owner.status)) add("orphan-claim", "review", "Scheduled order has no live owner; validate historical settlement before releasing");
          }
          const expected = collectionReceipts(row);
          if (expected.length && await CollectionReceipt.countDocuments({ key: { $in: expected.map((receipt) => receipt.key) } }) < expected.length) add("collection-receipt", "replay", "Successful dated receipt missing; legacy date/amount assumptions remain labeled");
        }
      }
      cursor = String(rows.at(-1)!._id);
    }
  }
  return { rulesVersion: 1, generatedAt: new Date(), getTransactionSupport: await getTransactionSupport(), checked, issues,
    pendingOperations: await FinanceOperation.countDocuments({ state: "pending" }), conflicts: await FinanceOperation.countDocuments({ state: "conflict" }),
    counts: Object.fromEntries([...new Set(issues.map((issue) => issue.kind))].map((kind) => [kind, issues.filter((issue) => issue.kind === kind).length])),
  };
}

/** Apply only evidence-backed replays from an unchanged saved plan. Never erase ledger keys. */
export async function applyFinanceRepairPlan(plan: { rulesVersion: number; issues: FinanceIssue[] }) {
  if (plan.rulesVersion !== 1) throw new ApiError("Unsupported finance repair plan", 400);
  const completed: string[] = []; const conflicts: string[] = []; const review: string[] = [];
  const seen = new Set<string>();
  for (const issue of plan.issues) {
    if (seen.has(`${issue.source}:${issue.sourceId}`)) continue;
    seen.add(`${issue.source}:${issue.sourceId}`);
    if (issue.repair !== "replay") { review.push(issue.sourceId); continue; }
    try {
      await runFinanceOperation({ actorId: "system", action: `repair:${issue.source}:${issue.sourceId}`, requestKey: issue.fingerprint, fingerprint: { source: issue.source, id: issue.sourceId, fingerprint: issue.fingerprint }, work: async () => {
        const model = sources[issue.source as keyof typeof sources];
        if (!model) throw new ApiError("Unknown repair source", 400);
        const { financeQuery } = await import("./transaction");
        const row = await model.collection.findOne({ _id: new Types.ObjectId(issue.sourceId) }, { session: (await import("./transaction")).financeSession() });
        const ledger = await financeQuery(LedgerEntry.find({ "source.id": issue.sourceId })).sort({ key: 1 }).lean();
        if (!row || financialFingerprint({ row, ledger }) !== issue.fingerprint) throw new ApiError("Repair evidence changed; generate a fresh plan", 409);
        if (issue.source === "payments") await replayPlatformPayment(issue.sourceId);
        else if (issue.source === "subscriptions") await replaySubscriptionInvoice(issue.sourceId);
        else if (issue.source === "orders") await recordOrderCollections(issue.sourceId);
        return { sourceId: issue.sourceId, result: { repaired: issue.kind }, postings: [] };
      } });
      completed.push(issue.sourceId);
    } catch { conflicts.push(issue.sourceId); }
  }
  return { completed, conflicts, review, operations: await recoverFinanceOperations(), after: await financeReliabilityReport() };
}
