import type { Types } from "mongoose";
import type { ExpenseCategory } from "./expense-categories";

/** The list, its totals, and CSV all read the same active vendor records. */
export function vendorExpenseFilter(vendorId: Types.ObjectId, query: { category?: ExpenseCategory; from?: Date; to?: Date }) {
  return {
    vendorId,
    scope: "vendor" as const,
    voidedAt: null,
    ...(query.category ? { category: query.category } : {}),
    ...(query.from || query.to ? { date: {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    } } : {}),
  };
}
