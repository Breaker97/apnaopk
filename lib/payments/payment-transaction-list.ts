import { PaymentTransaction } from "@/models";
import { connectDB } from "@/lib/db";
import {
  countForQuery,
  listResult,
  resolveListSort,
  type ListResult,
} from "@/lib/api/list-query";

/**
 * Payment transaction list query.
 *
 * Shared by `GET /api/admin/payments/transactions` and the transactions
 * page's server component so the endpoint and the rendered page always agree
 * on what a given query string means.
 */

export const TRANSACTIONS_DEFAULT_PAGE_SIZE = 20;

const SORT_FIELDS = ["createdAt", "grossAmount", "netAmount"];

interface PaymentTransactionListParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  type?: string;
  provider?: string;
  /** `pending` narrows to refunds someone still has to send by hand. */
  settlement?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

function buildPaymentTransactionFilter({
  search,
  status,
  type,
  provider,
  settlement,
}: Omit<PaymentTransactionListParams, "page" | "limit" | "sortBy" | "sortOrder">) {
  const query: Record<string, unknown> = {};

  const normalize = (value?: string) => (value || "all").trim().toLowerCase();
  if (normalize(status) !== "all") query.status = normalize(status);
  if (normalize(type) !== "all") query.type = normalize(type);
  if (normalize(provider) !== "all") query.provider = normalize(provider);
  if (normalize(settlement) === "pending") {
    query["metadata.settlement.required"] = true;
    query["metadata.settlement.settledAt"] = { $exists: false };
  }

  if (search) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (escaped) {
      query.$or = [
        { orderNumber: { $regex: escaped, $options: "i" } },
        { externalId: { $regex: escaped, $options: "i" } },
        { paymentMethod: { $regex: escaped, $options: "i" } },
      ];
    }
  }

  return query;
}

export async function fetchPaymentTransactionList(
  params: PaymentTransactionListParams,
): Promise<ListResult<unknown>> {
  await connectDB();

  const { page, limit, sortBy, sortOrder } = params;
  const query = buildPaymentTransactionFilter(params);
  const sort = resolveListSort({
    sortBy,
    sortOrder,
    allowed: SORT_FIELDS,
    // Amounts repeat constantly across transactions, so sorting by one needs
    // the `_id` tiebreaker or a row can appear on two pages.
    unique: ["createdAt"],
  });

  const [transactions, total] = await Promise.all([
    PaymentTransaction.find(query)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    countForQuery(PaymentTransaction, query),
  ]);

  return listResult(transactions as unknown[], page, limit, total);
}
