import { paginatedResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { fetchAbandonedCheckoutList } from "@/lib/orders/abandoned-checkout-list";

export const GET = withApi({ auth: "admin" }, async ({ request }) => {
  const list = await fetchAbandonedCheckoutList(request.nextUrl.searchParams);
  return paginatedResponse(list.items, list.page, list.limit, list.total);
});
