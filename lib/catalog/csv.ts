/**
 * CSV reading and writing for the catalog's import/export files — products,
 * categories and collections.
 *
 * Merchants edit these files in Excel, Numbers or Google Sheets, and each of
 * them bends the format a little: Excel writes a byte-order mark, uses `;`
 * instead of `,` wherever the decimal separator is a comma, and runs any cell
 * that starts with `=` as a formula. Everything here exists so a file survives
 * that round trip — out of the store, through a spreadsheet, and back in.
 */

/**
 * A cell a spreadsheet would evaluate instead of display (CWE-1236). Product
 * titles and descriptions are typed by vendors, and an admin opening the
 * export must not run what a vendor wrote.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** The apostrophe `csvCell` adds in front of such a cell. */
const ESCAPED_FORMULA_START = /^'[=+\-@\t\r]/;

const BYTE_ORDER_MARK = "\uFEFF";

const DELIMITERS = [",", ";", "\t"] as const;

/**
 * One cell, quoted per RFC 4180. A value a spreadsheet would run as a formula
 * gets a leading apostrophe so it opens as text; `parseCsv` strips it again,
 * so an exported file still imports unchanged.
 */
export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvLine(values: readonly unknown[]): string {
  return values.map(csvCell).join(",");
}

/**
 * A CSV download. The byte-order mark comes first: without it Excel reads a
 * UTF-8 file as Latin-1 and every "Lève" or "ঢাকা" in a product name arrives
 * as mojibake.
 */
export function csvFileResponse(filename: string, lines: readonly string[]) {
  return new Response(`${BYTE_ORDER_MARK}${lines.join("\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** `prefix-2026-09-17.csv` — the name every catalog export downloads as. */
export function datedCsvFilename(prefix: string) {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`;
}

type CsvRecord = {
  /** The row number a spreadsheet shows for this record; the header is row 1. */
  row: number;
  values: Record<string, string>;
};

type ParsedCsv = {
  headers: string[];
  records: CsvRecord[];
};

/**
 * Whichever of `,` `;` and tab the header line uses most. A file saved by
 * Excel in a locale whose decimal separator is a comma is `;`-separated, and
 * reading it as `,` would turn every row into one unusable column.
 */
function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/[\r\n]|$/));
  let best: string = DELIMITERS[0];
  let bestCount = 0;
  for (const delimiter of DELIMITERS) {
    const count = firstLine.split(delimiter).length - 1;
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Split text into records of raw cells. A quote only opens a quoted cell at
 * the start of that cell — `5" screen` in an unquoted cell is a literal quote,
 * not the start of a string that swallows the rest of the file.
 */
function readRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (quoted) {
      if (char !== '"') {
        cell += char;
      } else if (text[index + 1] === '"') {
        cell += '"';
        index++;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === delimiter) {
      record.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  record.push(cell);
  records.push(record);
  return records;
}

function readCell(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  return ESCAPED_FORMULA_START.test(value) ? value.slice(1).trim() : value;
}

/**
 * Parse a CSV file into records keyed by its header row. Blank lines are
 * skipped but still counted, so `row` matches the row number the merchant sees
 * in their spreadsheet when an error names it.
 */
export function parseCsv(text: string): ParsedCsv {
  const content = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
  const rows = readRecords(content, detectDelimiter(content));
  const isBlank = (cells: string[]) => cells.every((cell) => !cell.trim());

  const headerIndex = rows.findIndex((cells) => !isBlank(cells));
  if (headerIndex === -1) return { headers: [], records: [] };

  const headers = rows[headerIndex].map((header) => readCell(header));
  const records: CsvRecord[] = [];
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const cells = rows[index];
    if (isBlank(cells)) continue;
    const values: Record<string, string> = {};
    headers.forEach((header, column) => {
      if (header) values[header] = readCell(cells[column]);
    });
    records.push({ row: index + 1, values });
  }

  return { headers, records };
}
