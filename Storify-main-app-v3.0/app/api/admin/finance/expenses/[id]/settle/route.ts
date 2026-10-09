import { Expense } from "@/models/expense.model";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { SettleExpenseSchema } from "@/lib/validations";
import { createAuditContext } from "@/lib/audit";
import { auditExpenseSettlement } from "@/lib/finance/audit-expense";
import { expenseSettlementPostings, expenseSettlementReversalPostings } from "@/lib/finance/postings";
import { startOfUtcDay } from "@/lib/finance/recurring-schedule";
import { runFinanceOperation, mutationKey, expectedVersion, staleFinance } from "@/lib/finance/operations";
import { financeQuery, financeVersionFilter } from "@/lib/finance/transaction";

type RouteParams = { id: string };

export const POST = withApi<RouteParams>(
  { auth: "admin", rateLimit: { action: "admin:expenses:settle", preset: "moderate" } },
  async ({ request, params, session }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Expense");
    const body = await validateBody(request, SettleExpenseSchema);
    const current = await Expense.findById(id).select("version").lean();
    const version = expectedVersion(request, current?.version ?? 0);
    const outcome = await runFinanceOperation({
      action: `expense:settle:${id}`, actorId: session.user.id, requestKey: mutationKey(request), fingerprint: { body, version },
      work: async () => {
        const expense = await financeQuery(Expense.findOne({ _id: id, scope: { $ne: "vendor" }, ...financeVersionFilter(version) }));
        if (!expense) throw staleFinance();
        if (expense.paidFrom !== "unpaid" || expense.settlement) throw new ValidationError("This bill is already paid");
        const paidAt = startOfUtcDay(body.paidAt);
        if (paidAt < startOfUtcDay(expense.date)) throw new ValidationError({ paidAt: ["A bill cannot be paid before its date"] });
        const settlement = { paidAt, paidFrom: body.paidFrom, sequence: (expense.settlementSequence ?? 0) + 1, settledBy: session.user.id };
        const saved = await financeQuery(Expense.findOneAndUpdate(
          { _id: id, settlement: null, ...financeVersionFilter(version) },
          { $set: { settlement, settlementSequence: settlement.sequence, updatedBy: session.user.id, version: version + 1 } },
          { returnDocument: "after", runValidators: true },
        ));
        if (!saved) throw staleFinance();
        await auditExpenseSettlement(createAuditContext(request, session), saved, settlement, true);
        return { result: saved.toObject(), sourceId: id, postings: expenseSettlementPostings({ ...saved.toObject(), settlement }) };
      },
    });
    return successResponse({ ...outcome.data, operationId: outcome.operationId, bookkeepingState: outcome.bookkeepingState }, "Marked as paid", outcome.bookkeepingState === "complete" ? 200 : 202);
  },
);

export const DELETE = withApi<RouteParams>(
  { auth: "admin", rateLimit: { action: "admin:expenses:settle", preset: "moderate" } },
  async ({ request, params, session }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Expense");
    const current = await Expense.findById(id).select("version").lean();
    const version = expectedVersion(request, current?.version ?? 0);
    const outcome = await runFinanceOperation({
      action: `expense:undo:${id}`, actorId: session.user.id, requestKey: mutationKey(request), fingerprint: { id, version },
      work: async () => {
        const expense = await financeQuery(Expense.findOne({ _id: id, scope: { $ne: "vendor" }, ...financeVersionFilter(version) }));
        if (!expense) throw staleFinance();
        if (!expense.settlement) throw new ValidationError("This bill is not marked paid");
        const row = expense.toObject();
        const saved = await financeQuery(Expense.findOneAndUpdate({ _id: id, ...financeVersionFilter(version) },
          { $set: { settlement: null, version: version + 1, updatedBy: session.user.id } }, { returnDocument: "after" }));
        if (!saved) throw staleFinance();
        await auditExpenseSettlement(createAuditContext(request, session), saved, row.settlement!, false);
        return { result: saved.toObject(), sourceId: id, postings: expenseSettlementReversalPostings({ ...row, settlement: row.settlement! }) };
      },
    });
    return successResponse({ ...outcome.data, operationId: outcome.operationId, bookkeepingState: outcome.bookkeepingState }, "Marked as unpaid", outcome.bookkeepingState === "complete" ? 200 : 202);
  },
);
