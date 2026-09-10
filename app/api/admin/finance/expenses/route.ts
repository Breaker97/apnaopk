import { Types } from "mongoose";
import { z } from "zod";
import { Expense } from "@/models/expense.model";
import { getSettings } from "@/models/settings.model";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { validateBody, validateQuery } from "@/lib/api/validate";
import { CreateExpenseSchema, SafeSearchSchema } from "@/lib/validations";
import { auditCreate, createAuditContext } from "@/lib/audit";
import { currencyMinimumPrice, quantizeToCurrency, roundMoney } from "@/lib/intl/money";
import { postExpense } from "@/lib/finance/post-events";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_DEBIT_ACCOUNT,
} from "@/lib/finance/expense-categories";
import { LEDGER_BOOK } from "@/lib/finance/accounts";

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

/**
 * GET /api/admin/finance/expenses
 *
 * The list, and the totals for the same filter. The totals are computed
 * server-side over the WHOLE filtered set rather than the current page — a
 * "total spent" that only adds up the twenty rows on screen is the kind of
 * figure someone puts in a tax return.
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:expenses:list", preset: "lenient" },
  },
  async ({ request }) => {
    const query = validateQuery(request, ExpenseListQuerySchema);

    const filter: Record<string, unknown> = { scope: { $ne: "vendor" } };
    if (query.category) filter.category = query.category;
    if (query.book) filter.book = query.book;
    if (query.paidFrom) filter.paidFrom = query.paidFrom;
    if (query.from || query.to) {
      filter.date = {
        ...(query.from ? { $gte: query.from } : {}),
        ...(query.to ? { $lte: query.to } : {}),
      };
    }
    if (query.search) {
      // Already regex-escaped by SafeSearchSchema.
      filter.$or = [
        { description: { $regex: query.search, $options: "i" } },
        { payee: { $regex: query.search, $options: "i" } },
      ];
    }

    const [items, total, totals] = await Promise.all([
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
                $cond: [{ $eq: ["$paidFrom", "unpaid"] }, "$amount", 0],
              },
            },
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
 * failure to post is a failure to record, and the admin should hear about it.
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
    const currency = (settings.general?.defaultCurrency || "USD").toUpperCase();

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

    const expense = await Expense.create({
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
      recurring: body.recurring?.enabled
        ? {
            enabled: true,
            interval: body.recurring.interval,
            nextDueAt: null,
            templateId: null,
          }
        : null,
      note: body.note?.trim() || null,
      // Resolved once, at creation, and stored — see the field's own note on
      // why the reversal cannot re-derive it.
      debitAccount:
        EXPENSE_CATEGORY_DEBIT_ACCOUNT[body.category] ?? "operating_expense",
      createdBy: session.user.id,
    });

    await postExpense({
      _id: expense._id,
      date: expense.date,
      book: expense.book,
      category: expense.category,
      amount: expense.amount,
      currency: expense.currency,
      description: expense.description,
      paidFrom: expense.paidFrom,
      vendorId: expense.vendorId,
      revision: 0,
      debitAccount: expense.debitAccount,
    });

    const auditContext = createAuditContext(request, session);
    await auditCreate(
      auditContext,
      "expense",
      String(expense._id),
      expense.toObject() as unknown as Record<string, unknown>,
    );

    return successResponse(expense, "Expense recorded", 201);
  },
);
