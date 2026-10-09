import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { ConflictError, NotFoundError } from "@/lib/api/errors";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { assertVendorPermission } from "@/lib/access/rbac";
import { QuoteRequest } from "@/models";
import {
  buildVendorQuoteFilter,
  fetchVendorQuoteDetail,
} from "@/lib/quotes/quotes";
import {
  assertVendorQuoteMove,
  requireVendorQuoteView,
} from "@/lib/quotes/vendor-quote-access";
import { noticeQuoteWithdrawn } from "@/lib/quotes/quote-notices";
import { auditQuoteNote, auditQuoteStatus } from "@/lib/quotes/audit-quote";
import { createAuditContext } from "@/lib/audit";

/**
 * GET /api/vendor/quotes/[id] — one of the vendor's quotes for the detail
 * sheet and the price dialog. Another vendor's quote answers 404, the same as
 * one that does not exist.
 */
export const GET = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:quotes:detail", preset: "lenient" },
  },
  async ({ params, session }) => {
    await assertVendorPermission(
      session.user,
      VENDOR_PERMISSIONS.VIEW_ORDERS,
      "You do not have permission to view quotes",
    );
    const view = await requireVendorQuoteView(session.user.id);
    const detail = await fetchVendorQuoteDetail(params.id, view);
    if (!detail) throw new NotFoundError("Quote request");
    return successResponse(detail);
  },
);

/**
 * The vendor's hand moves on its own quote:
 *
 *   mark_lost   close it. A live price — necessarily the vendor's own, since
 *               the store has not touched it — is withdrawn in the same write.
 *   reopen      take back a quote the vendor itself closed.
 *   vendorNote  the vendor's own note, which the store can read.
 *
 * Closing and reopening are refused once the store has taken the quote over
 * (see `vendorQuoteMoves`); the note never is. Deleting is the store's alone.
 */
const UpdateVendorQuoteSchema = z
  .object({
    action: z.enum(["mark_lost", "reopen"]).optional(),
    vendorNote: z.string().trim().max(2000).optional(),
  })
  .refine(
    (value) => value.action !== undefined || value.vendorNote !== undefined,
    { message: "Nothing to update" },
  );

export const PATCH = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:quotes:update", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    await assertVendorPermission(
      session.user,
      VENDOR_PERMISSIONS.EDIT_ORDERS,
      "You do not have permission to change quotes",
    );
    const body = await validateBody(request, UpdateVendorQuoteSchema);
    const view = await requireVendorQuoteView(session.user.id);
    const detail = await fetchVendorQuoteDetail(params.id, view);
    if (!detail) throw new NotFoundError("Quote request");

    const set: Record<string, unknown> = {};
    const unset: Record<string, ""> = {};

    if (body.vendorNote !== undefined) {
      if (body.vendorNote) set.vendorNote = body.vendorNote;
      else unset.vendorNote = "";
    }

    const withdrawsPrice =
      body.action === "mark_lost" && detail.stage === "offer_sent";

    if (body.action === "mark_lost") {
      assertVendorQuoteMove(detail, "canMarkLost");
      set.status = "lost";
      set.lostByRole = "vendor";
      if (withdrawsPrice) {
        set["offer.withdrawnAt"] = new Date();
        set["offer.withdrawnByRole"] = "vendor";
      }
    }

    if (body.action === "reopen") {
      assertVendorQuoteMove(detail, "canReopen");
      set.status = detail.offer ? "quoted" : "in_progress";
      unset.lostByRole = "";
    }

    // Always this vendor's quote; and a close or reopen only lands on the
    // quote as it was read, so a price or a close the store made in between
    // makes it miss rather than be undone.
    const filter: Record<string, unknown> = {
      _id: params.id,
      ...buildVendorQuoteFilter(view.vendorId),
      ...(body.action
        ? {
            status: detail.status,
            "offer.offeredAt": detail.offer?.offeredAt
              ? new Date(detail.offer.offeredAt)
              : { $exists: false },
            "offer.withdrawnAt": detail.offer?.withdrawnAt
              ? new Date(detail.offer.withdrawnAt)
              : { $exists: false },
          }
        : {}),
    };
    const result = await QuoteRequest.updateOne(
      filter,
      {
        ...(Object.keys(set).length > 0 ? { $set: set } : {}),
        ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      },
      { runValidators: true },
    );
    if (result.matchedCount === 0) {
      throw new ConflictError(
        "This quote changed while you were working on it. Reload it and try again.",
      );
    }

    // The shopper hears the price is gone the way they heard about it. Read
    // from the quote itself, not the vendor's copy, which may carry no email.
    if (withdrawsPrice) {
      const shopper = await QuoteRequest.findOne({
        _id: params.id,
        ...buildVendorQuoteFilter(view.vendorId),
      })
        .select("productName variantName name email userId")
        .lean<Parameters<typeof noticeQuoteWithdrawn>[0] | null>();
      if (shopper) await noticeQuoteWithdrawn(shopper);
    }

    const updated = await fetchVendorQuoteDetail(params.id, view);
    if (!updated) throw new NotFoundError("Quote request");

    const auditContext = createAuditContext(request, session, {
      vendorId: view.vendorId,
    });
    if (typeof set.status === "string" && set.status !== detail.status) {
      await auditQuoteStatus(auditContext, updated, {
        from: detail.status,
        to: set.status,
        offerWithdrawn: withdrawsPrice,
      });
    }
    if (
      body.vendorNote !== undefined &&
      body.vendorNote !== (detail.vendorNote ?? "")
    ) {
      await auditQuoteNote(auditContext, updated, {
        cleared: !body.vendorNote,
        field: "vendorNote",
      });
    }

    return successResponse(updated);
  },
);
