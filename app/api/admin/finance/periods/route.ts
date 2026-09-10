import { z } from "zod";
import { FiscalPeriod } from "@/models/fiscal-period.model";
import { successResponse } from "@/lib/api/response";
import { ConflictError, ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { auditCreate, auditDelete, createAuditContext } from "@/lib/audit";
import { invalidateClosedPeriodCache } from "@/lib/finance/ledger";
import { getProfitAndLoss } from "@/lib/finance/reports";
import { monthBounds } from "@/lib/finance/months";

/** "2026-03" — a calendar month, which is the only period anyone closes. */
const MonthSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a YYYY-MM month"),
  note: z.string().max(500).optional(),
});

/**
 * GET /api/admin/finance/periods
 * Everything that has been closed, newest first.
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:finance:periods:list", preset: "lenient" },
  },
  async () => {
    const periods = await FiscalPeriod.find().sort({ to: -1 }).limit(60).lean();
    return successResponse(periods);
  },
);

/**
 * POST /api/admin/finance/periods
 * Close a month.
 *
 * Closing does not lock any data — ledger entries stay append-only and nothing
 * is edited. What changes is where LATER entries are dated: anything arriving
 * for a closed month lands in the open one instead, carrying a note that says
 * where it belongs. That is the accounting answer to a late webhook, and it is
 * why this is safe to do as soon as figures have been filed.
 *
 * The totals at the moment of closing are stored, so "why is March different
 * now?" can be answered with what March actually said then.
 */
export const POST = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:finance:periods:close", preset: "moderate" },
    demo: "block-mutations",
  },
  async ({ request, session }) => {
    const body = await validateBody(request, MonthSchema);
    const { from, to } = monthBounds(body.month);

    // A month still in progress has takings yet to come; closing it would date
    // the rest of its own days into the next one.
    if (to > new Date()) {
      throw new ValidationError("That month has not finished yet");
    }

    const snapshot = (await getProfitAndLoss({ from, to })).map((book) => ({
      currency: book.currency,
      income: book.totalIncome,
      expenses: book.totalExpenses,
      net: book.net,
    }));

    let period;
    try {
      period = await FiscalPeriod.create({
        from,
        to,
        label: body.month,
        closedAt: new Date(),
        closedBy: session.user.id,
        snapshot,
        note: body.note?.trim() || null,
      });
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) {
        throw new ConflictError(`${body.month} is already closed`);
      }
      throw error;
    }

    invalidateClosedPeriodCache();

    const auditContext = createAuditContext(request, session);
    await auditCreate(
      auditContext,
      "fiscalPeriod",
      String(period._id),
      period.toObject() as unknown as Record<string, unknown>,
    );

    return successResponse(period, `${body.month} closed`, 201);
  },
);

/**
 * DELETE /api/admin/finance/periods?month=YYYY-MM
 *
 * Reopening removes the line, nothing else. Entries that were dated into the
 * open period while it was closed are NOT moved back — they were posted where
 * they were posted, and silently relocating them is precisely the rewriting of
 * history the close exists to prevent.
 */
export const DELETE = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:finance:periods:reopen", preset: "moderate" },
    demo: "block-mutations",
  },
  async ({ request, session }) => {
    const month = new URL(request.url).searchParams.get("month") || "";
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new ValidationError("Use a YYYY-MM month");
    }

    const period = await FiscalPeriod.findOne({ label: month }).lean();
    if (!period) throw new ValidationError(`${month} is not closed`);

    // Only the most recent close may be reopened: lifting an older one would
    // leave a closed month sitting behind an open one, and "closed through"
    // would no longer describe anything.
    const latest = await FiscalPeriod.findOne().sort({ to: -1 }).select("label").lean();
    if (latest?.label !== month) {
      throw new ValidationError(
        `Reopen ${latest?.label} first — periods are reopened newest first`,
      );
    }

    await FiscalPeriod.deleteOne({ label: month });
    invalidateClosedPeriodCache();

    const auditContext = createAuditContext(request, session);
    await auditDelete(
      auditContext,
      "fiscalPeriod",
      String(period._id),
      period as unknown as Record<string, unknown>,
    );

    return successResponse({ message: `${month} reopened` });
  },
);
