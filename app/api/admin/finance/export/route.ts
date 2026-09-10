import { z } from "zod";
import { LedgerEntry } from "@/models/ledger-entry.model";
import { Expense } from "@/models/expense.model";
import { withApi } from "@/lib/api/handler";
import { validateQuery } from "@/lib/api/validate";
import { buildCsv, csvResponse } from "@/lib/finance/csv";
import { resolveRequestedPeriod } from "@/lib/finance/reports";

const ExportQuerySchema = z.object({
  type: z.enum(["ledger", "expenses"]).default("ledger"),
  period: z.string().default("ytd"),
  // A picked range, so the file matches the screen it was downloaded from
  // rather than the nearest named period to it.
  from: z.string().optional(),
  to: z.string().optional(),
  book: z.enum(["own", "marketplace"]).optional(),
});

/** A hard ceiling: a spreadsheet nobody can open is not an export. */
const MAX_ROWS = 20000;

/**
 * Say so, in the file, when the ceiling was hit.
 *
 * The limit is right; being quiet about it was not. This is the one artefact
 * that leaves the building for an accountant, and a ledger that stops at 20,000
 * rows with nothing marking the edge is indistinguishable from a complete one —
 * so the figures get added up and filed short.
 *
 * Both signals, because either alone is missable: the filename carries it for
 * anyone looking at the download, and a final row carries it for anyone who
 * only ever sees the spreadsheet.
 */
function truncationRow(columns: number, shown: number, total: number) {
  const message = `TRUNCATED — ${shown} of ${total} rows exported. Narrow the period to export the rest.`;
  return [message, ...Array<string>(Math.max(0, columns - 1)).fill("")];
}

const stampName = (base: string, shown: number, total: number) =>
  total > shown ? `${base}-partial-${shown}-of-${total}` : base;

/**
 * GET /api/admin/finance/export?type=ledger|expenses&period=|from=&to=&book=
 *
 * The ledger as a spreadsheet, or the expenses on their own.
 *
 * Both sides of every entry are carried as separate columns rather than a
 * signed amount, because that is what an accountant's import expects and
 * because a signed column loses which account moved in which direction.
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:finance:export", preset: "moderate" },
  },
  async ({ request }) => {
    const query = validateQuery(request, ExportQuerySchema);
    const period = resolveRequestedPeriod(query);
    const stamp = new Date().toISOString().slice(0, 10);

    if (query.type === "expenses") {
      const expenseFilter = {
        // Platform costs only — a vendor's own rows are theirs. `as const`
        // because naming the filter widens the literal to `string`, which the
        // model's strict filter type rejects.
        scope: { $ne: "vendor" as const },
        date: { $gte: period.from, $lte: period.to },
        ...(query.book ? { book: query.book } : {}),
      };
      // Counted alongside the page, so the file can state what it left out
      // rather than ending wherever the limit happened to fall.
      const [rows, total] = await Promise.all([
        Expense.find(expenseFilter).sort({ date: 1 }).limit(MAX_ROWS).lean(),
        Expense.countDocuments(expenseFilter),
      ]);

      const expenseColumns = [
        "Date",
        "Book",
        "Category",
        "Description",
        "Payee",
        "Paid from",
        "Amount",
        "Currency",
      ];

      return csvResponse(
        `${stampName(`expenses-${period.key}`, rows.length, total)}-${stamp}.csv`,
        buildCsv(expenseColumns, [
          ...rows.map((row) => [
            new Date(row.date).toISOString().slice(0, 10),
            row.book,
            row.category,
            row.description,
            row.payee ?? "",
            row.paidFrom,
            row.amount,
            row.currency,
          ]),
          ...(total > rows.length
            ? [truncationRow(expenseColumns.length, rows.length, total)]
            : []),
        ]),
      );
    }

    const entryFilter = {
      date: { $gte: period.from, $lte: period.to },
      ...(query.book ? { book: query.book } : {}),
    };
    const [entries, total] = await Promise.all([
      LedgerEntry.find(entryFilter).sort({ date: 1, _id: 1 }).limit(MAX_ROWS).lean(),
      LedgerEntry.countDocuments(entryFilter),
    ]);

    const ledgerColumns = [
      "Date",
      "Book",
      "Debit account",
      "Credit account",
      "Amount",
      "Currency",
      "Source",
      "Reference",
      "Note",
    ];

    return csvResponse(
      `${stampName(`ledger-${period.key}`, entries.length, total)}-${stamp}.csv`,
      buildCsv(ledgerColumns, [
        ...entries.map((entry) => [
          new Date(entry.date).toISOString(),
          entry.book,
          entry.debit,
          entry.credit,
          entry.amount,
          entry.currency,
          entry.source?.kind ?? "",
          entry.source?.ref ?? "",
          entry.note ?? "",
        ]),
        ...(total > entries.length
          ? [truncationRow(ledgerColumns.length, entries.length, total)]
          : []),
      ]),
    );
  },
);
