import { connectDB } from "@/lib/db";
import { getSettings } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import { paginatedResponse, successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { fetchPayoutList } from "@/lib/finance/payout-list";
import { createPayout } from "@/lib/finance/payout-service";
import { mutationKey } from "@/lib/finance/operations";
import { createAuditContext } from "@/lib/audit";
import { parsePageLimit } from "@/lib/api/list-query";
import { validateBody } from "@/lib/api/validate";
import * as z from "zod";

const PayoutCreateSchema = z.object({
  vendorId: z.string().max(64), periodStart: z.string().max(40), periodEnd: z.string().max(40),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  note: z.string().max(2000).optional(), requestKey: z.string().min(8).max(160).optional(),
  expectedCalculationVersion: z.string().max(64).optional(),
});

export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:payouts:list", preset: "lenient" },
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const { page, limit } = parsePageLimit(searchParams, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const status = (searchParams.get("status") || "all").trim().toLowerCase();
    const search = (searchParams.get("search") || "").trim();
    const vendorId = (searchParams.get("vendorId") || "").trim();
    const sortBy = (searchParams.get("sortBy") || "createdAt").trim();
    const sortOrder = (searchParams.get("sortOrder") || "desc").trim();

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) {
      throw new ValidationError("Payouts are available only in multi-vendor mode");
    }

    const list = await fetchPayoutList({
      page,
      limit,
      search,
      status,
      vendorId,
      sortBy,
      sortOrder: sortOrder === "asc" ? "asc" : "desc",
    });

    return paginatedResponse(list.items, list.page, list.limit, list.total);
  },
);

export const POST = withApi(
  { auth: "admin", rateLimit: { action: "admin:payouts:create", preset: "moderate" } },
  async ({ request, session }) => {
    const body = await validateBody(request, PayoutCreateSchema);
    await connectDB();
    const outcome = await createPayout({ ...body, vendorId: String(body.vendorId || ""), actorId: session.user.id, requestKey: mutationKey(request, body.requestKey), auditContext: createAuditContext(request, session) });
    return successResponse({ ...outcome.data, operationId: outcome.operationId, bookkeepingState: outcome.bookkeepingState }, "Payout created", outcome.bookkeepingState === "complete" ? 201 : 202);
  },
);
