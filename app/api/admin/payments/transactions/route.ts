import { paginatedResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { fetchPaymentTransactionList } from "@/lib/payments/payment-transaction-list";
import { parsePageLimit } from "@/lib/api/list-query";

export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:payments:transactions:list", preset: "lenient" },
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const { page, limit } = parsePageLimit(searchParams, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const status = (searchParams.get("status") || "all").trim().toLowerCase();
    const type = (searchParams.get("type") || "all").trim().toLowerCase();
    const provider = (searchParams.get("provider") || "all").trim().toLowerCase();
    const settlement = (searchParams.get("settlement") || "all").trim().toLowerCase();
    const search = (searchParams.get("search") || "").trim();
    const requestedSortBy = (searchParams.get("sortBy") || "createdAt").trim();
    const sortableFields = new Set(["createdAt", "grossAmount", "netAmount"]);
    const sortBy = sortableFields.has(requestedSortBy)
      ? requestedSortBy
      : "createdAt";

    const list = await fetchPaymentTransactionList({
      page,
      limit,
      search,
      status,
      type,
      provider,
      settlement,
      sortBy,
      sortOrder: searchParams.get("sortOrder") === "asc" ? "asc" : "desc",
    });

    return paginatedResponse(list.items, list.page, list.limit, list.total);
  },
);
