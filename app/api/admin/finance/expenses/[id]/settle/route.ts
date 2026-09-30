import { Expense } from "@/models/expense.model";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { ApiError, ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { SettleExpenseSchema } from "@/lib/validations";
import { auditUpdate, createAuditContext } from "@/lib/audit";
import {
  postExpenseSettlement,
  reverseExpenseSettlement,
} from "@/lib/finance/expense-ledger";
import { startOfUtcDay } from "@/lib/finance/recurring-schedule";

type RouteParams = { id: string };

/** The fields a payment's ledger entry is built from. */
function settledView(expense: {
  _id: unknown;
  book: "own" | "marketplace";
  amount: number;
  currency: string;
  description: string;
  vendorId?: unknown;
}) {
  return {
    _id: expense._id,
    book: expense.book,
    amount: expense.amount,
    currency: expense.currency,
    description: expense.description,
    vendorId: expense.vendorId,
  };
}

/**
 * POST /api/admin/finance/expenses/[id]/settle
 *
 * Record that a bill entered as "not yet paid" has been paid: when, and from
 * which account. The bill itself is untouched — its cost stays on the day of
 * the invoice — and the payment is posted as its own entry on the day the
 * money left (payable down, bank down). Editing "Paid from" did this by
 * rewriting the bill, which moved the money out on the invoice date.
 *
 * Posted first and strictly: if the books cannot take it, nothing changes and
 * the admin is told. Retrying is safe — the payment's key absorbs a repeat.
 */
export const POST = withApi<RouteParams>(
  {
    auth: "admin",
    rateLimit: { action: "admin:expenses:settle", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Expense");

    const body = await validateBody(request, SettleExpenseSchema);
    const expense = await Expense.findById(id);
    if (!expense || expense.scope === "vendor") {
      return notFoundResponse("Expense");
    }
    if (expense.paidFrom !== "unpaid") {
      throw new ValidationError("This expense was already paid when it was recorded");
    }
    if (expense.settlement) {
      throw new ValidationError("This bill is already marked paid");
    }
    const paidAt = startOfUtcDay(body.paidAt);
    if (paidAt < startOfUtcDay(expense.date)) {
      throw new ValidationError({
        paidAt: ["A bill cannot be paid before the date it is recorded on"],
      });
    }

    const previous = expense.toObject();
    const settlement = {
      paidAt,
      paidFrom: body.paidFrom,
      sequence: (expense.settlementSequence ?? 0) + 1,
      settledBy: session.user.id,
    };

    try {
      await postExpenseSettlement(
        { ...settledView(expense), settlement },
        { strict: true },
      );
    } catch (error) {
      console.error("Bill payment not recorded — the ledger write failed:", error);
      throw new ApiError(
        "The payment could not be written to the books, so it was not recorded. Try again.",
        503,
        "LEDGER_WRITE_FAILED",
      );
    }

    expense.settlement = settlement;
    expense.settlementSequence = settlement.sequence;
    expense.updatedBy = session.user.id;
    await expense.save();

    await auditUpdate(
      createAuditContext(request, session),
      "expense",
      id,
      previous as unknown as Record<string, unknown>,
      expense.toObject() as unknown as Record<string, unknown>,
    );

    return successResponse(expense, "Marked as paid");
  },
);

/**
 * DELETE /api/admin/finance/expenses/[id]/settle
 *
 * Take a recorded payment back — marked paid by mistake, or the transfer
 * bounced. The payment is reversed, dated with the payment itself, and the
 * bill is owed again.
 */
export const DELETE = withApi<RouteParams>(
  {
    auth: "admin",
    rateLimit: { action: "admin:expenses:settle", preset: "moderate" },
    // Refused on a demo like every DELETE, by the default policy.
  },
  async ({ request, params, session }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Expense");

    const expense = await Expense.findById(id);
    if (!expense || expense.scope === "vendor") {
      return notFoundResponse("Expense");
    }
    if (!expense.settlement) {
      throw new ValidationError("This bill is not marked paid");
    }

    const previous = expense.toObject();
    try {
      await reverseExpenseSettlement(
        {
          ...settledView(expense),
          settlement: {
            paidAt: expense.settlement.paidAt,
            paidFrom: expense.settlement.paidFrom,
            sequence: expense.settlement.sequence,
          },
        },
        { strict: true },
      );
    } catch (error) {
      console.error("Bill payment not undone — the ledger write failed:", error);
      throw new ApiError(
        "The payment could not be taken off the books, so it still stands. Try again.",
        503,
        "LEDGER_WRITE_FAILED",
      );
    }

    expense.settlement = null;
    expense.updatedBy = session.user.id;
    await expense.save();

    await auditUpdate(
      createAuditContext(request, session),
      "expense",
      id,
      previous as unknown as Record<string, unknown>,
      expense.toObject() as unknown as Record<string, unknown>,
    );

    return successResponse(expense, "Marked as unpaid");
  },
);
