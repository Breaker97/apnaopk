import { runFinanceOperation, mutationKey } from "@/lib/finance/operations";
import { financeSession } from "@/lib/finance/transaction";
import { expensePostings } from "@/lib/finance/postings";
import { Types } from "mongoose";
import * as z from "zod";
import { Expense } from "@/models/expense.model";
import { getSettings } from "@/models/settings.model";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { validateBody, validateQuery } from "@/lib/api/validate";
import { CreateExpenseSchema, SafeSearchSchema } from "@/lib/validations";
import { createAuditContext } from "@/lib/audit";
import { auditExpenseRecorded } from "@/lib/finance/audit-expense";
import { currencyMinimumPrice, quantizeToCurrency, roundMoney } from "@/lib/intl/money";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY,
  EXPENSE_CATEGORY_DEBIT_ACCOUNT,
} from "@/lib/finance/expense-categories";
import { LEDGER_BOOK } from "@/lib/finance/accounts";
import {
  firstOccurrenceOnOrAfter,
  startOfUtcDay,
} from "@/lib/finance/recurring-schedule";

const ExpenseListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: SafeSearchSchema,
  category: z
    .enum(EXPENSE_CATEGORIES as [string, ...string[]])
    .optional(),
  book: z.enum(["own", "marketplace"]).optional(),
  paidFrom: z.enum(["bank", "cash", "gateway", "unpaid"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** A bill recorded as not yet paid that nobody has recorded paying. */
const STILL_OWED = { paidFrom: "unpaid", settlement: null } as const;

/**
 * GET /api/admin/finance/expenses
 *
 * The list, and the totals for the same filter. The totals are computed
 * server-side over the WHOLE filtered set rather than the current page — a
 * "total spent" that only adds up the twenty rows on screen is the kind of
 * figure someone puts in a tax return.
 *
 * Plus what is still owed across ALL time. The unpaid figure inside the totals
 * follows the period, so a bill from before it dropped out of sight while it
 * was still waiting to be paid.
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:expenses:list", preset: "lenient" },
  },
  async ({ request }) => {
    const query = validateQuery(request, ExpenseListQuerySchema);

    const scope = { scope: { $ne: "vendor" } };
    const conditions: Array<Record<string, unknown>> = [scope];
    if (query.category) conditions.push({ category: query.category });
    if (query.book) conditions.push({ book: query.book });
    if (query.paidFrom === "unpaid") {
      // Owed, not "entered as unpaid": a bill paid since is no longer
      // anything anybody has to do.
      conditions.push(STILL_OWED);
    } else if (query.paidFrom) {
      // Money that left this account, whether the bill was paid on the spot
      // or recorded unpaid and paid from here later.
      conditions.push({
        $or: [
          { paidFrom: query.paidFrom },
          { "settlement.paidFrom": query.paidFrom },
        ],
      });
    }
    if (query.from || query.to) {
      conditions.push({
        date: {
          ...(query.from ? { $gte: query.from } : {}),
          ...(query.to ? { $lte: query.to } : {}),
        },
      });
    }
    if (query.search) {
      // Already regex-escaped by SafeSearchSchema.
      conditions.push({
        $or: [
          { description: { $regex: query.search, $options: "i" } },
          { payee: { $regex: query.search, $options: "i" } },
        ],
      });
    }
    const filter = { $and: conditions };

    const [items, total, totals, outstanding] = await Promise.all([
      Expense.find(filter)
        .sort({ date: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Expense.countDocuments(filter),
      Expense.aggregate<{
        _id: string;
        amount: number;
        count: number;
        unpaid: number;
        stock: number;
      }>([
        { $match: filter },
        {
          $group: {
            // Grouped by currency: summing across them would produce a number
            // in no currency at all.
            _id: "$currency",
            amount: { $sum: "$amount" },
            count: { $sum: 1 },
            // Recorded but not settled. Part of the period's costs either way
            // — an expense is a cost when it is incurred — but it is also
            // money still to leave the account, and a total that says nothing
            // about it reads as money already gone.
            unpaid: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$paidFrom", "unpaid"] },
                      { $eq: [{ $ifNull: ["$settlement", null] }, null] },
                    ],
                  },
                  "$amount",
                  0,
                ],
              },
            },
            // Stock bought is an asset until it sells, not a cost, so the
            // profit and loss leaves it out. Named here so the total can say
            // how much of it is stock.
            stock: {
              $sum: {
                $cond: [
                  {
                    $eq: ["$category", EXPENSE_CATEGORY.INVENTORY_PURCHASE],
                  },
                  "$amount",
                  0,
                ],
              },
            },
          },
        },
      ]),
      Expense.aggregate<{ _id: string; amount: number; count: number }>([
        {
          $match: {
            ...scope,
            ...STILL_OWED,
            ...(query.book ? { book: query.book } : {}),
          },
        },
        {
          $group: {
            _id: "$currency",
            amount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const totalPages = Math.ceil(total / query.limit) || 1;
    // The standard paginated shape, plus the filtered totals. Written out
    // rather than through `paginatedResponse` only because that helper takes no
    // extra payload — the shape below is identical to what it returns, so the
    // list hook reads it unchanged.
    return successResponse({
      data: items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
        hasNext: query.page < totalPages,
        hasPrev: query.page > 1,
      },
      totals: totals.map((row) => ({
        currency: row._id,
        amount: roundMoney(row.amount),
        count: row.count,
        unpaid: roundMoney(row.unpaid),
        stock: roundMoney(row.stock),
      })),
      outstanding: outstanding.map((row) => ({
        currency: row._id,
        amount: roundMoney(row.amount),
        count: row.count,
      })),
    });
  },
);

/**
 * POST /api/admin/finance/expenses
 *
 * Records the cost and posts it to the ledger in the same request — unlike the
 * order paths, where posting is fire-and-forget because an order must survive a
 * ledger failure. Here the ledger entry IS the point of the record, so a
 * failure to post is a failure to record: the row is taken back out and the
 * admin hears about it, rather than seeing "recorded" over a cost the profit
 * and loss never received.
 */
export const POST = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:expenses:create", preset: "moderate" },
    // No demo policy: an expense is ordinary business data, and a demo that
    // cannot record one cannot show the feature at all. The default still
    // refuses DELETE, which is the destructive half.
  },
  async ({ request, session }) => {
    const body = await validateBody(request, CreateExpenseSchema);
    const settings = await getSettings();
    // The currency the bill was paid in; the store's own unless it says
    // otherwise. A store selling in taka still pays its hosting in dollars.
    const currency = (
      body.currency ||
      settings.general?.defaultCurrency ||
      "USD"
    ).toUpperCase();

    // Store only what the currency can express, then refuse anything that
    // rounds away to nothing — a zero-decimal currency (JPY, UGX) turns 0.4
    // into 0, and an expense of zero is a row that says nothing.
    const amount = quantizeToCurrency(body.amount, currency);
    if (amount < currencyMinimumPrice(currency)) {
      throw new ValidationError({
        amount: [
          `Amount must be at least ${currencyMinimumPrice(currency)} ${currency}`,
        ],
      });
    }

    // A marketplace-scoped cost only makes sense on a marketplace. Forcing the
    // own book otherwise keeps a single-vendor store's accounts to one book,
    // which is what its finance screens will show.
    const multiVendor = Boolean(settings.multiVendorMode?.enabled);
    const book =
      multiVendor && body.book === LEDGER_BOOK.MARKETPLACE
        ? LEDGER_BOOK.MARKETPLACE
        : LEDGER_BOOK.OWN;

    const recurring = body.recurring?.enabled
      ? repeatingFrom(body.date, body.recurring)
      : null;

    const outcome = await runFinanceOperation({
      action: "expense:create", actorId: session.user.id, requestKey: mutationKey(request), fingerprint: body,
      work: async () => {
    const expense = new Expense({
      date: body.date,
      book,
      scope: "platform",
      category: body.category,
      amount,
      currency,
      description: body.description.trim(),
      payee: body.payee?.trim() || null,
      paidFrom: body.paidFrom || "bank",
      receiptUrl: body.receiptUrl?.trim() || null,
      vendorId:
        multiVendor && body.vendorId
          ? new Types.ObjectId(body.vendorId)
          : null,
      recurring,
      note: body.note?.trim() || null,
      // Resolved once, at creation, and stored — see the field's own note on
      // why the reversal cannot re-derive it.
      debitAccount:
        EXPENSE_CATEGORY_DEBIT_ACCOUNT[body.category] ?? "operating_expense",
      createdBy: session.user.id,
    });
    await expense.save({ session: financeSession() });
    await auditExpenseRecorded(createAuditContext(request, session), expense);
    return { result: expense.toObject(), sourceId: expense._id, postings: expensePostings(expense.toObject()) };
      },
    });
    return successResponse({ ...outcome.data, operationId: outcome.operationId, bookkeepingState: outcome.bookkeepingState }, "Expense recorded", outcome.bookkeepingState === "complete" ? 201 : 202);
  },
);

/**
 * A new repeating expense's schedule.
 *
 * Dated in the past, a template owes copies for the dates already gone by.
 * Whether it should create them is the admin's call, made in the form: with
 * `backfill` the daily job walks from the template's own date, without it the
 * schedule starts from today.
 */
function repeatingFrom(
  date: Date,
  recurring: {
    interval: "weekly" | "monthly" | "quarterly" | "yearly";
    endsAt?: Date | null;
    backfill?: boolean;
  },
) {
  const endsAt = recurring.endsAt ? startOfUtcDay(recurring.endsAt) : null;
  if (endsAt && endsAt < startOfUtcDay(date)) {
    throw new ValidationError({
      "recurring.endsAt": ["The last copy cannot be before the first"],
    });
  }
  return {
    enabled: true,
    interval: recurring.interval,
    nextDueAt: recurring.backfill
      ? null
      : firstOccurrenceOnOrAfter(
          date,
          recurring.interval,
          startOfUtcDay(new Date()),
        ),
    endsAt,
    templateId: null,
  };
}
