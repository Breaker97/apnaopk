import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { QuoteRequest } from "@/models";
import { QUOTE_REQUEST_STATUSES } from "@/lib/quotes/quote-status";
import { serializeRows } from "@/lib/api/list-query";
import type { QuoteRequestRow } from "@/lib/quotes/quotes";

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
  async ({ request, params }) => {
    const body = await validateBody(request, UpdateQuoteSchema);

    const updated = await QuoteRequest.findByIdAndUpdate(
      params.id,
      { $set: body },
      { new: true, runValidators: true },
    ).lean();

    if (!updated) throw new NotFoundError("Quote request");

    return successResponse(serializeRows<QuoteRequestRow>(updated));
  },
);

export const DELETE = withApi<{ id: string }>(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.MANAGE_ORDERS],
    rateLimit: { action: "admin:quotes:delete", preset: "moderate" },
  },
  async ({ params }) => {
    const deleted = await QuoteRequest.findByIdAndDelete(params.id).lean();
    if (!deleted) throw new NotFoundError("Quote request");
    return successResponse({ deleted: true });
  },
);
