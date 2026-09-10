import { Types } from "mongoose";
import { Expense } from "@/models/expense.model";
import { getSettings } from "@/models/settings.model";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { isValidObjectId, validatePartialBody } from "@/lib/api/validate";
import { UpdateExpenseSchema } from "@/lib/validations";
import { auditDelete, auditUpdate, createAuditContext } from "@/lib/audit";
import { currencyMinimumPrice, quantizeToCurrency } from "@/lib/intl/money";
import {
  currentExpenseRevision,
  postExpense,
  reverseExpense,
} from "@/lib/finance/post-events";
import { LEDGER_BOOK } from "@/lib/finance/accounts";
import { EXPENSE_CATEGORY_DEBIT_ACCOUNT } from "@/lib/finance/expense-categories";

type RouteParams = { id: string };

/**
 * PUT /api/admin/finance/expenses/[id]
 *
 * Editing an expense does NOT edit its ledger entries. The previous revision is
 * reversed and the new one posted, so a report run before the correction still
 * produces the number it produced then, and the correction itself is visible as
 * an event rather than a silent difference.
 */
export const PUT = withApi<RouteParams>(
  {
    auth: "admin",
    rateLimit: { action: "admin:expenses:update", preset: "moderate" },
    // Editing is how the reversal-and-repost path is seen working; the demo
    // refuses the delete below, which is enough.
  },
  async ({ request, params, session }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Expense");

    const body = await validatePartialBody(request, UpdateExpenseSchema);
    // Read the stored version first: it is what the ledger currently believes,
    // and therefore what the reversal has to cancel. Once the document below is
    // mutated that truth is gone.
    const original = await Expense.findById(id).lean<{
      _id: unknown;
      amount: number;
      date: Date;
      book: "own" | "marketplace";
      paidFrom: string;
      category: string;
      currency: string;
      vendorId?: unknown;
      revision?: number;
      debitAccount?: string | null;
    } | null>();
    const before = await Expense.findById(id);
    if (!before || !original) return notFoundResponse("Expense");

    const settings = await getSettings();
    const multiVendor = Boolean(settings.multiVendorMode?.enabled);
    const currency = before.currency;

    if (body.amount !== undefined) {
      const amount = quantizeToCurrency(body.amount, currency);
      if (amount < currencyMinimumPrice(currency)) {
        throw new ValidationError({
          amount: [
            `Amount must be at least ${currencyMinimumPrice(currency)} ${currency}`,
          ],
        });
      }
      before.amount = amount;
    }
    if (body.date !== undefined) before.date = body.date;
    if (body.category !== undefined) {
      before.category = body.category;
      // Moving a cost into or out of stock changes which account it belongs in.
      // The reversal below still cancels the OLD account, because it is built
      // from `original`, which was read before any of this ran.
      before.debitAccount =
        EXPENSE_CATEGORY_DEBIT_ACCOUNT[body.category] ?? "operating_expense";
    }
    if (body.description !== undefined) {
      before.description = body.description.trim();
    }
    if (body.payee !== undefined) before.payee = body.payee?.trim() || null;
    if (body.paidFrom !== undefined) before.paidFrom = body.paidFrom;
    if (body.receiptUrl !== undefined) {
      before.receiptUrl = body.receiptUrl?.trim() || null;
    }
    if (body.note !== undefined) before.note = body.note?.trim() || null;
    if (body.book !== undefined) {
      before.book =
        multiVendor && body.book === LEDGER_BOOK.MARKETPLACE
          ? LEDGER_BOOK.MARKETPLACE
          : LEDGER_BOOK.OWN;
    }
    if (body.vendorId !== undefined) {
      before.vendorId =
        multiVendor && body.vendorId
          ? new Types.ObjectId(body.vendorId)
          : null;
    }
    if (body.recurring !== undefined) {
      before.recurring = body.recurring?.enabled
        ? {
            enabled: true,
            interval: body.recurring.interval,
            nextDueAt: before.recurring?.nextDueAt ?? null,
            templateId: before.recurring?.templateId ?? null,
          }
        : null;
    }
    before.updatedBy = session.user.id;

    const previousRevision = await currentExpenseRevision(original);
    before.revision = previousRevision + 1;
    await before.save();

    await postExpense(
      {
        _id: before._id,
        date: before.date,
        book: before.book,
        category: before.category,
        amount: before.amount,
        currency,
        description: before.description,
        paidFrom: before.paidFrom,
        vendorId: before.vendorId,
        revision: previousRevision + 1,
        debitAccount: before.debitAccount,
      },
      {
        _id: before._id,
        date: original.date,
        book: original.book,
        category: original.category,
        amount: original.amount,
        currency: original.currency,
        paidFrom: original.paidFrom,
        vendorId: original.vendorId,
        revision: previousRevision,
        reversedAt: new Date(),
        debitAccount: original.debitAccount,
      },
    );

    const auditContext = createAuditContext(request, session);
    await auditUpdate(
      auditContext,
      "expense",
      id,
      original as unknown as Record<string, unknown>,
      before.toObject() as unknown as Record<string, unknown>,
    );

    return successResponse(before, "Expense updated");
  },
);

/**
 * DELETE /api/admin/finance/expenses/[id]
 *
 * The row goes; its ledger entries do not. They are reversed, so the period
 * they were posted in still reports what it reported at the time and the
 * removal is itself a dated event.
 */
export const DELETE = withApi<RouteParams>(
  {
    auth: "admin",
    rateLimit: { action: "admin:expenses:delete", preset: "moderate" },
    // Refused on a demo by the default policy — no flag needed.
  },
  async ({ request, params, session }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Expense");

    const expense = await Expense.findById(id).lean<{
      _id: unknown;
      date: Date;
      book: string;
      category: string;
      amount: number;
      currency: string;
      paidFrom: string;
      vendorId?: unknown;
      revision?: number;
      debitAccount?: string | null;
    } | null>();
    if (!expense) return notFoundResponse("Expense");

    await reverseExpense({
      _id: expense._id,
      date: expense.date,
      book: expense.book as "own" | "marketplace",
      category: expense.category,
      amount: expense.amount,
      currency: expense.currency,
      paidFrom: expense.paidFrom,
      vendorId: expense.vendorId,
      // The revision that is actually live. Reversing revision 0 on an expense
      // that has been corrected cancels an entry already cancelled and leaves
      // the real one standing — the row disappears from the list while its cost
      // stays in the profit and loss.
      revision: await currentExpenseRevision(expense),
      reversedAt: new Date(),
      debitAccount: expense.debitAccount,
    });

    await Expense.deleteOne({ _id: id });

    const auditContext = createAuditContext(request, session);
    await auditDelete(
      auditContext,
      "expense",
      id,
      expense as unknown as Record<string, unknown>,
    );

    return successResponse({ message: "Expense deleted" });
  },
);
