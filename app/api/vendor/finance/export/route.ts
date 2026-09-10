import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { validateQuery } from "@/lib/api/validate";
import { AuthorizationError } from "@/lib/api/errors";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { hasVendorPermission, isAdmin } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { Expense } from "@/models/expense.model";
import {
  STATEMENT_CSV_HEADERS,
  buildCsv,
  csvResponse,
  statementCsvRows,
} from "@/lib/finance/csv";
import { getVendorStatement, resolvePeriod } from "@/lib/finance/reports";

const ExportQuerySchema = z.object({
  type: z.enum(["statement", "expenses"]).default("statement"),
  period: z.string().default("30d"),
});

/** The same ceiling the admin export uses: a file nobody can open is not one. */
const MAX_ROWS = 20000;

/**
 * GET /api/vendor/finance/export?type=statement|expenses&period=
 *
 * A vendor's own statement, as a file they can keep.
 *
 * The screens answer "what do I have"; this answers "prove it to my
 * accountant, my bank or the marketplace". A seller who cannot take the figure
 * out of the dashboard re-types it, and a re-typed figure is the one that ends
 * up in the dispute.
 *
 * Scoped to the caller's own vendor from the session, never from a query
 * parameter — the whole point of a statement is that it is yours.
 *
 * The two balances stay in separate columns, exactly as the screen shows them:
 * money held for the vendor and money the vendor owes move in opposite
 * directions, and folding them into one signed column is what made the
 * statement read as though every commission had been deducted from their money.
 */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:finance:export", preset: "moderate" },
  },
  async ({ request, session }) => {
    const user = session.user as never;
    if (
      !(await hasVendorPermission(user, VENDOR_PERMISSIONS.VIEW_PAYOUTS)) &&
      !isAdmin(session.user as never)
    ) {
      throw new AuthorizationError(
        "You do not have permission to export finances",
      );
    }

    const vendor = await requireApprovedVendorByUserId(session.user.id);
    const query = validateQuery(request, ExportQuerySchema);
    const period = resolvePeriod(query.period);
    const stamp = new Date().toISOString().slice(0, 10);

    if (query.type === "expenses") {
      const rows = await Expense.find({
        vendorId: vendor._id,
        scope: "vendor",
        date: { $gte: period.from, $lte: period.to },
      })
        .sort({ date: 1 })
        .limit(MAX_ROWS)
        .lean();

      return csvResponse(
        `my-expenses-${period.key}-${stamp}.csv`,
        buildCsv(
          ["Date", "Category", "Description", "Payee", "Paid from", "Amount", "Currency"],
          rows.map((row) => [
            new Date(row.date).toISOString().slice(0, 10),
            row.category,
            row.description,
            row.payee ?? "",
            row.paidFrom,
            row.amount,
            row.currency,
          ]),
        ),
      );
    }

    const statements = await getVendorStatement(String(vendor._id), period);

    return csvResponse(
      `statement-${period.key}-${stamp}.csv`,
      buildCsv(
        [...STATEMENT_CSV_HEADERS],
        statementCsvRows(statements, period, MAX_ROWS),
      ),
    );
  },
);
