import * as z from "zod";
import { Expense } from "@/models/expense.model";
import { getSettings } from "@/models/settings.model";
import { successResponse } from "@/lib/api/response";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { createAuditContext } from "@/lib/audit";
import { auditExpenseRecorded } from "@/lib/finance/audit-expense";
import { validateBody, validateQuery } from "@/lib/api/validate";
import { CreateExpenseSchema } from "@/lib/validations";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { hasVendorPermission, isAdmin } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { currencyMinimumPrice, quantizeToCurrency, roundMoney } from "@/lib/intl/money";
import { isExpenseReceiptKey } from "@/lib/finance/expense-receipts";
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from "@/lib/finance/expense-categories";

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  category: z
    .enum(EXPENSE_CATEGORIES as [ExpenseCategory, ...ExpenseCategory[]])
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/**
 * A vendor's own costs.
 *
 * Recorded, never posted. A seller's rent, courier or packaging is their cost,
 * not the marketplace's — posting it would make a marketplace's profit fall
 * because one of its sellers bought a laptop. So these rows carry
 * `scope: "vendor"`, stay out of the ledger entirely, and appear only in the
 * vendor's own reporting.
 *
 * The same permission as payouts: a vendor who may see what they earned may
 * record what it cost them.
 */
export const GET = withApi({ auth: "user" }, async ({ request, session }) => {
  const user = session.user;
  if (
    !(await hasVendorPermission(user, VENDOR_PERMISSIONS.VIEW_PAYOUTS)) &&
    !isAdmin(user)
  ) {
    throw new AuthorizationError("You do not have permission to view finances");
  }
  const vendor = await requireApprovedVendorByUserId(session.user.id);
  const query = validateQuery(request, ListQuerySchema);

  // The totals are aggregated over this same filter, so the figure in the
  // header is the sum of what the chosen period and category show.
  const filter = {
    vendorId: vendor._id,
    scope: "vendor" as const,
    ...(query.category ? { category: query.category } : {}),
    ...(query.from || query.to
      ? {
          date: {
            ...(query.from ? { $gte: query.from } : {}),
            ...(query.to ? { $lte: query.to } : {}),
          },
        }
      : {}),
  };
  const [items, total, totals] = await Promise.all([
    Expense.find(filter)
      .sort({ date: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Expense.countDocuments(filter),
    Expense.aggregate<{ _id: string; amount: number }>([
      { $match: filter },
      { $group: { _id: "$currency", amount: { $sum: "$amount" } } },
    ]),
  ]);

  const totalPages = Math.ceil(total / query.limit) || 1;
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
    })),
  });
});

export const POST = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:expenses:create", preset: "moderate" },
  },
  async ({ request, session }) => {
    const user = session.user;
    if (
      !(await hasVendorPermission(user, VENDOR_PERMISSIONS.VIEW_PAYOUTS)) &&
      !isAdmin(user)
    ) {
      throw new AuthorizationError(
        "You do not have permission to record expenses",
      );
    }
    const vendor = await requireApprovedVendorByUserId(session.user.id);
    const body = await validateBody(request, CreateExpenseSchema);
    // A private receipt key names a file in the platform's own receipt store,
    // which only an admin can open. A vendor's receipts are their uploads.
    if (isExpenseReceiptKey(body.receiptUrl)) {
      throw new ValidationError({ receiptUrl: ["Upload the receipt here"] });
    }
    const settings = await getSettings();
    const currency = (settings.general?.defaultCurrency || "USD").toUpperCase();

    const amount = quantizeToCurrency(body.amount, currency);
    if (amount < currencyMinimumPrice(currency)) {
      throw new ValidationError({
        amount: [
          `Amount must be at least ${currencyMinimumPrice(currency)} ${currency}`,
        ],
      });
    }

    const expense = await Expense.create({
      date: body.date,
      // `book` is meaningless for a vendor row — it never reaches a book — but
      // the field is required, so it takes the neutral value.
      book: "own",
      scope: "vendor",
      vendorId: vendor._id,
      category: body.category,
      amount,
      currency,
      description: body.description.trim(),
      payee: body.payee?.trim() || null,
      paidFrom: body.paidFrom || "bank",
      receiptUrl: body.receiptUrl?.trim() || null,
      note: body.note?.trim() || null,
      createdBy: session.user.id,
    });

    // Amount, category and day, and the store it is for. Not the receipt, the
    // payee or the note: the expense itself keeps those, and the log is read
    // more widely. The admin's expenses are recorded the same way.
    await auditExpenseRecorded(
      createAuditContext(request, session, { vendorId: vendor._id }),
      expense,
    );

    // Deliberately no ledger posting. See the module header.
    return successResponse(expense, "Expense recorded", 201);
  },
);
