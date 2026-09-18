import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { QuoteRequest } from "@/models";
import { QUOTE_REQUEST_STATUSES } from "@/lib/quotes/quote-status";
import { serializeRows } from "@/lib/api/list-query";
import { buildQuoteScopeFilter, type QuoteRequestRow } from "@/lib/quotes/quotes";
import { mergeScopeFilter } from "@/lib/access/staff-scope";
import { resolveOfferStates } from "@/lib/quotes/quote-offer";

const UpdateQuoteSchema = z
  .object({
    status: z.enum(QUOTE_REQUEST_STATUSES).optional(),
    adminNote: z.string().trim().max(2000).optional(),
  })
  .refine(
    (value) => value.status !== undefined || value.adminNote !== undefined,
    { message: "Nothing to update" },
  );

export const PATCH = withApi<{ id: string }>(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.MANAGE_ORDERS],
    rateLimit: { action: "admin:quotes:update", preset: "moderate" },
  },
  async ({ request, params, staff }) => {
    const body = await validateBody(request, UpdateQuoteSchema);

    // Scoped in the filter, not checked after the read: staff limited to one
    // vendor see only that vendor's quotes in the list, and pasting another
    // vendor's id into this route must not get around it.
    const updated = await QuoteRequest.findOneAndUpdate(
      mergeScopeFilter({ _id: params.id }, buildQuoteScopeFilter(staff?.scope)),
      { $set: body },
      { returnDocument: "after", runValidators: true },
    ).lean();

    if (!updated) throw new NotFoundError("Quote request");

    // The table re-renders the row from this response, and its offer badge is
    // derived — so the state has to travel with the row or the badge blanks
    // out until the next refetch.
    const states = await resolveOfferStates([
      updated as Parameters<typeof resolveOfferStates>[0][number],
    ]);

    return successResponse({
      ...serializeRows<QuoteRequestRow>(updated),
      offerState: states.get(String(updated._id)) ?? "none",
    });
  },
);

export const DELETE = withApi<{ id: string }>(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.MANAGE_ORDERS],
    rateLimit: { action: "admin:quotes:delete", preset: "moderate" },
  },
  async ({ params, staff }) => {
    const deleted = await QuoteRequest.findOneAndDelete(
      mergeScopeFilter({ _id: params.id }, buildQuoteScopeFilter(staff?.scope)),
    ).lean();
    if (!deleted) throw new NotFoundError("Quote request");
    return successResponse({ deleted: true });
  },
);
