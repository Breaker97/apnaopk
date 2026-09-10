/**
 * CSV, for the one thing finance data has to do that no screen can: leave.
 *
 * An accountant works in a spreadsheet, and a figure they cannot open is a
 * figure they will re-key by hand — which is where the errors come from. So
 * this exists even though every number is already on a page.
 *
 * The quoting rule is the whole file: a description containing a comma, a
 * quote or a newline must survive the round trip, and money must arrive as a
 * number rather than as a currency-formatted string a spreadsheet reads as
 * text.
 */

/** RFC 4180 quoting: double the quotes, wrap anything that could break a row. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildCsv(
  headers: string[],
  rows: Array<Array<unknown>>,
): string {
  return [headers, ...rows].map((row) => row.map(cell).join(",")).join("\n");
}

/**
 * A download response.
 *
 * `﻿` first: without the byte-order mark Excel reads a UTF-8 file as
 * Latin-1 and turns every non-ASCII store name into mojibake — which is most
 * of them, on a product sold worldwide.
 */
/** The columns a vendor statement file carries. */
export const STATEMENT_CSV_HEADERS = [
  "Date",
  "Type",
  "Reference",
  "Balance",
  "Amount",
  "Currency",
] as const;

/**
 * A vendor statement, as rows.
 *
 * Pure and separate from the route because two things here are easy to break
 * and impossible to notice: the opening and closing balances ride as rows of
 * their own, so the file reconciles without the screen beside it — the lines
 * between them add up to the difference, which is the check an accountant
 * actually performs — and the `Balance` column keeps `held` and `owed` apart.
 * Those two move in opposite directions, and folding them into one signed
 * column is what made the screen read as though every commission had been
 * deducted from the vendor's money.
 */
export function statementCsvRows(
  statements: Array<{
    currency: string;
    opening: number;
    closing: number;
    owed: number;
    /** Entries in the period, which `lines` may not list all of. */
    lineCount?: number;
    lines: Array<{
      date: string;
      kind: string;
      reference: string;
      affects: "held" | "owed";
      amount: number;
      currency: string;
    }>;
  }>,
  period: { from: Date; to: Date },
  maxLines = 20000,
): Array<Array<unknown>> {
  const day = (date: Date | string) =>
    new Date(date).toISOString().slice(0, 10);
  const rows: Array<Array<unknown>> = [];

  for (const statement of statements) {
    rows.push([
      day(period.from),
      "opening",
      "Balance brought forward",
      "held",
      statement.opening,
      statement.currency,
    ]);
    const listed = statement.lines.slice(0, maxLines);
    for (const line of listed) {
      rows.push([
        day(line.date),
        line.kind,
        line.reference,
        line.affects,
        line.amount,
        line.currency,
      ]);
    }
    // Say so when the list stops short. The opening and closing balances are
    // aggregated over the whole period, so they are right either way — which is
    // exactly what makes a silent truncation dangerous: the file reconciles
    // against nothing and the reader has no way to tell why.
    const total = statement.lineCount ?? listed.length;
    if (total > listed.length) {
      rows.push([
        day(period.to),
        "note",
        `${listed.length} of ${total} entries listed — narrow the period for the rest`,
        "held",
        0,
        statement.currency,
      ]);
    }
    rows.push([
      day(period.to),
      "closing",
      "Held for you at the end of the period",
      "held",
      statement.closing,
      statement.currency,
    ]);
    rows.push([
      day(period.to),
      "closing",
      "Owed by you to the platform",
      "owed",
      statement.owed,
      statement.currency,
    ]);
  }

  return rows;
}

export function csvResponse(filename: string, body: string): Response {
  return new Response(`﻿${body}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Financial data must not sit in a shared cache.
      "Cache-Control": "no-store",
    },
  });
}
