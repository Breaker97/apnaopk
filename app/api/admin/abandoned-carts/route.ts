import { Cart } from "@/models";
import { paginatedResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { parsePageLimit } from "@/lib/api/list-query";

export const GET = withApi({ auth: "admin" }, async ({ request }) => {
  const searchParams = request.nextUrl.searchParams;
  const { page, limit, skip } = parsePageLimit(searchParams, {
    defaultLimit: 10,
    maxLimit: 100,
  });

  const query = { status: "abandoned" } as Record<string, unknown>;

  const [carts, total] = await Promise.all([
    Cart.find(query).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Cart.countDocuments(query),
  ]);

  return paginatedResponse(carts, page, limit, total);
});
