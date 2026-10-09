import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { QuoteRequest } from "@/models";
import {
  buildQuoteScopeFilter,
  fetchAdminQuoteDetail,
  type AdminQuoteDetail,
} from "@/lib/quotes/quotes";
import { mergeScopeFilter } from "@/lib/access/staff-scope";
import { noticeQuoteWithdrawn } from "@/lib/quotes/quote-notices";
import {
  auditQuoteDeleted,
  auditQuoteNote,
  auditQuoteStatus,
} from "@/lib/quotes/audit-quote";
import { createAuditContext } from "@/lib/audit";
import { notifyVendorQuotePriceChanged } from "@/lib/notifications/notifications";

/**
 * GET /api/admin/quotes/[id] — one quote for the detail sheet and the price
 * dialog: the row the table shows plus the internal note, the earlier offers
 * and each variant's stock ceiling.
 */
export const GET = withApi<{ id: string }>(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.VIEW_ORDERS],
    rateLimit: { action: "admin:quotes:detail", preset: "lenient" },
  },
  async ({ params, staff }) => {
    const detail = await fetchAdminQuoteDetail(params.id, staff?.scope);
    if (!detail) throw new NotFoundError("Quote request");
    return successResponse(detail);
  },
);

/**
 * The two moves a person makes by hand. Everything else about where a quote
 * stands follows from its price and its order (see QUOTE_STAGES), which is
 * why there is no free status field here any more: a dropdown let a quote read
 * "Won" with no order behind it, or "Lost" while its price could still be
 * bought.
 *
 *   mark_lost  close it. A live price is withdrawn in the same write, so the
 *              quote cannot be closed and still buyable.
 *   reopen     take a quote marked lost back into the queue.
 */
const UpdateQuoteSchema = z
  .object({
    action: z.enum(["mark_lost", "reopen"]).optional(),
    adminNote: z.string().trim().max(2000).optional(),
  })
  .refine(
    (value) => value.action !== undefined || value.adminNote !== undefined,
    { message: "Nothing to update" },
  );

function isOnOrder(detail: AdminQuoteDetail) {
  return detail.stage === "ordered" || detail.stage === "won";
}

export const PATCH = withApi<{ id: string }>(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.MANAGE_ORDERS],
    rateLimit: { action: "admin:quotes:update", preset: "moderate" },
  },
  async ({ request, params, staff, session }) => {
    const body = await validateBody(request, UpdateQuoteSchema);
    const detail = await fetchAdminQuoteDetail(params.id, staff?.scope);
    if (!detail) throw new NotFoundError("Quote request");

    const set: Record<string, unknown> = {};
    const unset: Record<string, ""> = {};

    if (body.adminNote !== undefined) {
      if (body.adminNote) set.adminNote = body.adminNote;
      else unset.adminNote = "";
    }

    if (body.action === "mark_lost") {
      if (isOnOrder(detail)) {
        throw new ValidationError(
          `This quote became order ${detail.order?.orderNumber ?? ""}. Cancel that order before closing the quote.`,
        );
      }
      set.status = "lost";
      // The store closed it, so it stays closed to the vendor.
      set.lostByRole = "admin";
      if (detail.stage === "offer_sent") {
        set["offer.withdrawnAt"] = new Date();
        set["offer.withdrawnByRole"] = "admin";
      }
    }

    if (body.action === "reopen") {
      if (detail.status !== "lost") {
        throw new ValidationError("Only a quote marked lost can be reopened");
      }
      set.status = detail.offer ? "quoted" : "in_progress";
      unset.lostByRole = "";
    }

    // Scoped in the filter, not only by the read above: staff limited to one
    // vendor must not reach another vendor's quote by pasting its id.
    await QuoteRequest.updateOne(
      mergeScopeFilter({ _id: params.id }, buildQuoteScopeFilter(staff?.scope)),
      {
        ...(Object.keys(set).length > 0 ? { $set: set } : {}),
        ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      },
      { runValidators: true },
    );

    // Closing a quote whose price the shopper could still buy pulls that
    // price back, and they hear about it the way they heard about the price.
    // When the price was the vendor's, the vendor hears why it is gone.
    if (body.action === "mark_lost" && detail.stage === "offer_sent") {
      await Promise.allSettled([
        noticeQuoteWithdrawn(detail),
        detail.offer?.offeredByRole === "vendor"
          ? notifyVendorQuotePriceChanged({
              quoteId: detail._id,
              vendorId: detail.vendorId,
              productName: detail.productName,
              kind: "closed",
            })
          : Promise.resolve(),
      ]);
    }

    const updated = await fetchAdminQuoteDetail(params.id, staff?.scope);
    if (!updated) throw new NotFoundError("Quote request");

    // From what was written and what stood before, not from the two reads: a
    // quote moved to the status it already had, or a note saved as it was, is
    // not an event.
    const auditContext = createAuditContext(request, session);
    if (typeof set.status === "string" && set.status !== detail.status) {
      await auditQuoteStatus(auditContext, updated, {
        from: detail.status,
        to: set.status,
        offerWithdrawn: body.action === "mark_lost" && detail.stage === "offer_sent",
      });
    }
    if (body.adminNote !== undefined && body.adminNote !== (detail.adminNote ?? "")) {
      await auditQuoteNote(auditContext, updated, { cleared: !body.adminNote });
    }

    return successResponse(updated);
  },
);

/**
 * Deleting is for spam and mistakes. A quote that became an order stays: it is
 * the record of the price that order was sold at, and the order still points
 * at it.
 */
export const DELETE = withApi<{ id: string }>(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.MANAGE_ORDERS],
    rateLimit: { action: "admin:quotes:delete", preset: "moderate" },
  },
  async ({ request, params, staff, session }) => {
    const detail = await fetchAdminQuoteDetail(params.id, staff?.scope);
    if (!detail) throw new NotFoundError("Quote request");
    if (isOnOrder(detail)) {
      throw new ValidationError(
        `This quote priced order ${detail.order?.orderNumber ?? ""}, so it is kept with that order.`,
      );
    }

    const deleted = await QuoteRequest.findOneAndDelete(
      mergeScopeFilter({ _id: params.id }, buildQuoteScopeFilter(staff?.scope)),
    ).lean();
    if (!deleted) throw new NotFoundError("Quote request");

    await auditQuoteDeleted(createAuditContext(request, session), detail, {
      status: detail.status,
      quantity: detail.quantity,
      offer: detail.offer,
    });
    return successResponse({ deleted: true });
  },
);
