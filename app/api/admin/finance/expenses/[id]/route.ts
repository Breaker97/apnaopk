import { Types } from "mongoose";
import { Expense } from "@/models/expense.model";
import { getSettings } from "@/models/settings.model";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { ApiError, ValidationError } from "@/lib/api/errors";
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
import { reverseExpenseSettlement } from "@/lib/finance/expense-ledger";
import { LEDGER_BOOK } from "@/lib/finance/accounts";
import { EXPENSE_CATEGORY_DEBIT_ACCOUNT } from "@/lib/finance/expense-categories";
import {
  firstOccurrenceOnOrAfter,
  startOfUtcDay,
  type RecurringInterval,
} from "@/lib/finance/recurring-schedule";

type RouteParams = { id: string };

type Settlement = {
  paidAt: Date;
  paidFrom: "bank" | "cash" | "gateway";
  sequence: number;
};

type Schedule = {
  enabled: boolean;
  interval: RecurringInterval;
  nextDueAt?: Date | null;
  endsAt?: Date | null;
  templateId?: Types.ObjectId | null;
};

/** The row as the ledger last saw it. */
type StoredExpense = {
  _id: unknown;
  amount: number;
  date: Date;
  book: "own" | "marketplace";
  paidFrom: string;
  category: string;
  currency: string;
  description?: string;
  scope?: "platform" | "vendor";
  vendorId?: unknown;
  revision?: number;
  debitAccount?: string | null;
  settlement?: Settlement | null;
  recurring?: Schedule | null;
};

/** Said once, wherever a paid bill refuses a change. */
const PAID_BILL_LOCKED =
  "This bill is marked paid. Mark it unpaid first to change this.";

/**
 * PUT /api/admin/finance/expenses/[id]
 *
 * Editing an expense does NOT edit its ledger entries. The previous revision is
 * reversed and the new one posted, so the correction is visible as an event
 * rather than a silent difference. The reversal is dated with the revision it
 * cancels: an open month is simply restated, and a closed one keeps what it
 * reported because `applyPeriodClose` books both halves after the close.
 *
 * Only an edit that changes the money moves the ledger. Attaching a receipt or
 * fixing the payee is not a new accounting event, and posting it as one filled
 * the ledger with reversal pairs.
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
    const original = await Expense.findById(id).lean<StoredExpense | null>();
    const before = await Expense.findById(id);
    if (!before || !original) return notFoundResponse("Expense");
    // A vendor's own cost is theirs and never reaches the platform's books.
    // The list never shows one here; editing it by id would have posted it.
    if (original.scope === "vendor") return notFoundResponse("Expense");

    const settings = await getSettings();
    const multiVendor = Boolean(settings.multiVendorMode?.enabled);
    const currency = (body.currency || original.currency).toUpperCase();

    // A cost filed under the marketplace stays there when multi-vendor is
    // switched off: the form no longer shows the choice, and saving a typo fix
    // used to move the cost to the own book without a word. Only a store that
    // can see the choice may make it.
    const book =
      body.book === undefined
        ? original.book
        : body.book === LEDGER_BOOK.MARKETPLACE &&
            (multiVendor || original.book === LEDGER_BOOK.MARKETPLACE)
          ? LEDGER_BOOK.MARKETPLACE
          : LEDGER_BOOK.OWN;

    const amount =
      body.amount !== undefined
        ? quantizeToCurrency(body.amount, currency)
        : quantizeToCurrency(original.amount, currency);
    if (amount < currencyMinimumPrice(currency)) {
      throw new ValidationError({
        amount: [
          `Amount must be at least ${currencyMinimumPrice(currency)} ${currency}`,
        ],
      });
    }

    // A paid bill's amount, currency, book and "not yet paid" are exactly
    // what its payment cleared. Changing one under the payment would leave the
    // payable off by the difference, with nothing on screen to say so.
    if (original.settlement) {
      const locked: Record<string, string[]> = {};
      if (amount !== original.amount) locked.amount = [PAID_BILL_LOCKED];
      if (currency !== original.currency) locked.currency = [PAID_BILL_LOCKED];
      if (book !== original.book) locked.book = [PAID_BILL_LOCKED];
      if (body.paidFrom !== undefined && body.paidFrom !== original.paidFrom) {
        locked.paidFrom = [PAID_BILL_LOCKED];
      }
      if (Object.keys(locked).length > 0) throw new ValidationError(locked);
    }

    before.amount = amount;
    before.currency = currency;
    before.book = book;
    if (body.date !== undefined) before.date = body.date;
    // Only when the category actually changes. The form sends it on every
    // save, and re-deriving the account for an unchanged row would re-file an
    // older stock purchase (posted as an operating expense) without any
    // posting to match.
    if (body.category !== undefined && body.category !== original.category) {
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
    if (body.vendorId !== undefined) {
      before.vendorId =
        multiVendor && body.vendorId
          ? new Types.ObjectId(body.vendorId)
          : null;
    }
    if (body.recurring !== undefined) {
      if (original.recurring?.templateId) {
        // A copy the schedule made. Its link to the template is what stops the
        // schedule making it again, so it is never dropped; and a copy that
        // became a template itself would run the same bill twice a month.
        if (body.recurring.enabled) {
          throw new ValidationError({
            recurring: [
              "This expense was created by a repeating one. Change the schedule on the original.",
            ],
          });
        }
      } else {
        before.recurring = nextSchedule(
          original.recurring ?? null,
          before.date,
          body.recurring,
        );
      }
    }
    before.updatedBy = session.user.id;

    // What the ledger entry is made of. The description rides on the entry as
    // its note, but rewording it is not a money event: the entry keeps the
    // words it was posted with, and the audit log below has the change.
    const movesMoney =
      before.amount !== original.amount ||
      before.currency !== original.currency ||
      before.date.getTime() !== new Date(original.date).getTime() ||
      before.category !== original.category ||
      (before.debitAccount ?? null) !== (original.debitAccount ?? null) ||
      before.paidFrom !== original.paidFrom ||
      before.book !== original.book ||
      String(before.vendorId ?? "") !== String(original.vendorId ?? "");

    if (!movesMoney) {
      await saveExpense(before);
    } else {
      const previousRevision = await currentExpenseRevision(original);
      before.revision = previousRevision + 1;
      await saveExpense(before);

      try {
        await postExpense(
          {
            _id: before._id,
            date: before.date,
            book: before.book,
            category: before.category,
            amount: before.amount,
            currency: before.currency,
            description: before.description,
            paidFrom: before.paidFrom,
            vendorId: before.vendorId,
            revision: previousRevision + 1,
            debitAccount: before.debitAccount,
          },
          {
            _id: before._id,
            // The reversal is dated with the revision it cancels — see the
            // route's own note, and `expenseReversalPostings`.
            date: original.date,
            book: original.book,
            category: original.category,
            amount: original.amount,
            currency: original.currency,
            paidFrom: original.paidFrom,
            vendorId: original.vendorId,
            revision: previousRevision,
            debitAccount: original.debitAccount,
          },
          { strict: true },
        );
      } catch (error) {
        // The row is saved. The daily reconcile re-posts its revision and
        // puts back the reversal the old one is missing (`healExpenseLedger`),
        // so the books do catch up — but the admin is told, not shown "saved".
        console.error("Expense saved, but its ledger correction failed:", error);
        throw new ApiError(
          "Saved, but the books could not be updated yet. They will catch up within a day.",
          503,
          "LEDGER_WRITE_FAILED",
        );
      }
    }

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
 * The row goes; its ledger entries do not. They are reversed, dated with the
 * revision being cancelled: an open month stops carrying a cost that never
 * happened, and a closed one keeps what it reported, with the reversal booked
 * after the close. A paid bill's payment is reversed with it.
 *
 * The reversal is written first and must succeed: a row deleted over a failed
 * reversal left its cost in the profit and loss with nothing left to replay.
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

    const expense = await Expense.findById(id).lean<StoredExpense | null>();
    // A vendor's own row was never posted, so there is nothing here to reverse.
    if (!expense || expense.scope === "vendor") {
      return notFoundResponse("Expense");
    }

    try {
      await reverseExpense(
        {
          _id: expense._id,
          date: expense.date,
          book: expense.book,
          category: expense.category,
          amount: expense.amount,
          currency: expense.currency,
          paidFrom: expense.paidFrom,
          vendorId: expense.vendorId,
          // The revision that is actually live. Reversing revision 0 on an
          // expense that has been corrected cancels an entry already cancelled
          // and leaves the real one standing — the row disappears from the
          // list while its cost stays in the profit and loss.
          revision: await currentExpenseRevision(expense),
          debitAccount: expense.debitAccount,
        },
        { strict: true },
      );
      if (expense.settlement) {
        await reverseExpenseSettlement(
          {
            _id: expense._id,
            book: expense.book,
            amount: expense.amount,
            currency: expense.currency,
            description: expense.description,
            vendorId: expense.vendorId,
            settlement: expense.settlement,
          },
          { strict: true },
        );
      }
    } catch (error) {
      console.error("Expense not deleted — its reversal failed:", error);
      throw new ApiError(
        "It could not be taken off the books, so nothing was deleted. Try again.",
        503,
        "LEDGER_WRITE_FAILED",
      );
    }

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

/**
 * Save, turning the one refusal a date change can meet into words.
 *
 * A copy made by a repeating expense keeps its link to the template, and the
 * database allows one copy per template per day.
 */
async function saveExpense(expense: { save: () => Promise<unknown> }) {
  try {
    await expense.save();
  } catch (error) {
    if ((error as { code?: number } | null)?.code === 11000) {
      throw new ValidationError({
        date: ["Another copy of this repeating expense is already on that day"],
      });
    }
    throw error;
  }
}

/**
 * A template's schedule after an edit.
 *
 * Switched off, the schedule is kept rather than cleared: it records where the
 * series stopped, and clearing it made switching back on replay every month
 * of the pause. Switched (back) on, it starts from today — unless the form
 * asked for the past to be filled in, which resumes from where it stopped, or
 * from the template's own date for one that never ran.
 */
function nextSchedule(
  current: Schedule | null,
  date: Date,
  requested: {
    enabled: boolean;
    interval: RecurringInterval;
    endsAt?: Date | null;
    backfill?: boolean;
  },
): Schedule | null {
  const endsAt =
    requested.endsAt === undefined
      ? (current?.endsAt ?? null)
      : requested.endsAt
        ? startOfUtcDay(requested.endsAt)
        : null;
  if (requested.enabled && endsAt && endsAt < startOfUtcDay(date)) {
    throw new ValidationError({
      "recurring.endsAt": ["The last copy cannot be before the first"],
    });
  }

  if (!requested.enabled) {
    if (!current) return null;
    return {
      enabled: false,
      interval: requested.interval,
      nextDueAt: current.nextDueAt ?? null,
      endsAt,
      templateId: null,
    };
  }

  const wasOn = Boolean(current?.enabled);
  const intervalChanged = Boolean(current && current.interval !== requested.interval);
  const today = startOfUtcDay(new Date());
  const nextDueAt =
    wasOn && !intervalChanged
      ? (current?.nextDueAt ?? null)
      : requested.backfill
        ? intervalChanged
          ? null
          : (current?.nextDueAt ?? null)
        : firstOccurrenceOnOrAfter(date, requested.interval, today);

  return {
    enabled: true,
    interval: requested.interval,
    nextDueAt,
    endsAt,
    templateId: null,
  };
}
