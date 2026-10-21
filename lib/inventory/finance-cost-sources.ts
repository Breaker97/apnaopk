import "server-only";
import { Types } from "mongoose";
import { InventoryCostSource } from "@/models/inventory-cost-source.model";
import { Order } from "@/models/order.model";
import { Expense } from "@/models/expense.model";
import { LedgerEntry } from "@/models/ledger-entry.model";
import { FinanceOperation } from "@/models/finance-operation.model";
import { financeQuery, financeSession } from "@/lib/finance/transaction";
import { prepareFinancePostings, runFinanceOperation } from "@/lib/finance/operations";
import { expensePostings, isConsignmentCollectedForStock } from "@/lib/finance/postings";
import { getDefaultVendorIds } from "@/lib/finance/post-events";
import { LEDGER_ACCOUNT_TYPES, type LedgerAccount } from "@/lib/finance/accounts";
import { ApiError } from "@/lib/api/errors";
import { inventoryMoney } from "./finance-rules";

export async function linkNonphysicalCost(input: { orderId: string; lineId: string; expenseId: string; expenseRevision: number; quantity: number; amount: number }, actorId: string, requestKey: string) {
  return runFinanceOperation({ action: "inventory:cost-source", actorId, requestKey, fingerprint: input, work: async () => {
    const order = await financeQuery(Order.findById(input.orderId)).lean();
    const sub = order?.subOrders?.find((s: { items?: Array<{ inventoryLineId?: string }> }) => s.items?.some((i) => i.inventoryLineId === input.lineId));
    const line = sub?.items?.find((i: { inventoryLineId?: string }) => i.inventoryLineId === input.lineId);
    if (!order || !sub || !line || line.inventoryFinanceGeneration !== 2 || !(await getDefaultVendorIds()).has(String(sub.vendorId)) || !isConsignmentCollectedForStock(order, sub)) throw new ApiError("Select a recognized own-store digital/untracked sale line.", 400, "COST_SOURCE_LINE_REQUIRED");
    await financeQuery(Order.updateOne({ _id: order._id }, { $inc: { inventoryFinanceVersion: 1 } }));
    const expense = await financeQuery(Expense.findOne({ _id: input.expenseId, book: "own", scope: "platform", currency: order.currency, revision: input.expenseRevision }));
    if (!expense || (expense.vendorId && String(expense.vendorId) !== String(sub.vendorId))) throw new ApiError("Select a current expense in this own-store book and currency.", 409, "COST_SOURCE_EXPENSE_REQUIRED");
    const debit = (expense.debitAccount ?? "operating_expense") as LedgerAccount;
    if (LEDGER_ACCOUNT_TYPES[debit] !== "expense") throw new ApiError("A nonphysical cost source must be a recorded expense, not physical stock funding.", 400, "INVALID_COST_SOURCE");
    await financeQuery(Expense.updateOne({ _id: expense._id, revision: expense.revision }, { $inc: { version: 1 } }));
    const existing = await financeQuery(InventoryCostSource.find({ $or: [{ orderId: order._id, lineId: input.lineId }, { expenseId: expense._id }] })).lean();
    const usedQuantity = existing.filter((r) => String(r.orderId) === String(order._id) && r.lineId === input.lineId).reduce((sum, r) => sum + r.quantity, 0);
    const usedMoney = existing.filter((r) => String(r.expenseId) === String(expense._id)).reduce((sum, r) => sum + r.amount, 0);
    if (input.quantity > line.quantity - usedQuantity || inventoryMoney(input.amount + usedMoney, order.currency) > expense.amount) throw new ApiError("Cost source exceeds the remaining sale quantity or recorded expense amount.", 409, "COST_SOURCE_CAP_EXCEEDED");
    const funding = expensePostings(expense)[0];
    if (funding) {
      const posted = await financeQuery(LedgerEntry.findOne({ key: funding.key })).lean();
      const pending = await financeQuery(FinanceOperation.findOne({ state: { $in: ["pending", "complete"] }, "postings.key": funding.key })).lean();
      const matches = (r: typeof funding) => r.book === funding.book && r.currency === funding.currency && r.amount === funding.amount && r.debit === funding.debit && r.credit === funding.credit && String(r.source.id) === String(expense._id);
      if (posted ? !matches(posted as typeof funding) : !(pending?.postings as typeof funding[] | undefined)?.some(matches)) throw new ApiError("The original expense funding must be verified.", 409, "COST_SOURCE_POSTING_MISSING");
    }
    const id = new Types.ObjectId();
    const postings = await prepareFinancePostings(input.amount && debit !== "cost_of_goods" ? [{ key: `inventory_cost_source:${id}`, date: new Date(), book: "own", debit: "cost_of_goods", credit: debit, amount: inventoryMoney(input.amount, order.currency), currency: order.currency, vendorId: String(sub.vendorId), source: { kind: "expense", id: String(expense._id), ref: order.orderNumber } }] : []);
    const accountingAt = postings[0]?.date ?? (await prepareFinancePostings([{ key: `inventory_cost_source:${id}:date`, date: new Date(), book: "own", debit: "cost_of_goods", credit: debit === "cost_of_goods" ? "operating_expense" : debit, amount: 0, currency: order.currency, source: { kind: "expense", id: String(expense._id) } }]))[0].date;
    await InventoryCostSource.create([{ _id: id, key: `${actorId}:${requestKey}`, ownerId: sub.vendorId, orderId: order._id, subOrderId: sub._id, lineId: input.lineId, expenseId: expense._id, expenseRevision: expense.revision, fundingKey: funding?.key ?? `zero:${expense._id}`, quantity: input.quantity, amount: inventoryMoney(input.amount, order.currency), currency: order.currency, accountingAt }], { session: financeSession() });
    return { result: { allocationId: String(id), quantity: input.quantity, amount: input.amount, currency: order.currency }, postings, sourceId: String(id), vendorId: sub.vendorId };
  } });
}
