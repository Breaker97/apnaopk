/**
 * A pasted block of specifications, read into label/value pairs.
 *
 * Merchants build spec tables by copying them from a supplier's page, a
 * spreadsheet or a chat message, and typing thirty rows back in by hand is
 * the slowest part of listing a phone. A paste carries the whole table, so
 * this reads the shapes those sources actually produce:
 *
 *   Brand<TAB>Apple                     copied from an HTML table or a sheet
 *   Brand: Apple                        typed, or copied from a spec sheet
 *   Brand   Apple                       copied from a fixed-width layout
 *
 * Pure, so the form can call it from a paste handler and a test can pin it.
 */

interface ParsedSpecification {
  name: string;
  value: string;
}

/**
 * The cap. A paste is a table, not a catalogue; past this something has
 * gone in that was never a spec list, and the form should not grow a
 * thousand rows because of it.
 */
export const MAX_PASTED_SPECIFICATIONS = 100;

/** Field lengths the product schema accepts, mirrored so a paste cannot exceed them. */
const MAX_NAME = 120;
const MAX_VALUE = 2000;

/**
 * The separators, in the order they are tried. A tab wins over everything:
 * a value legitimately holds colons ("OS: iOS 27, Chipset: A20") and runs
 * of spaces, so once the source gave us a real column break we use it and
 * look no further.
 */
function splitRow(line: string): [string, string] | null {
  const tab = line.indexOf("\t");
  if (tab >= 0) return [line.slice(0, tab), line.slice(tab + 1)];

  // A colon, but only where the left side reads like a label: short, and
  // without the punctuation a sentence carries. Otherwise a value pasted
  // on its own line would be torn in half at its first colon.
  const colon = line.search(/[:：]/);
  if (colon > 0 && colon <= 60) {
    const head = line.slice(0, colon);
    if (!/[,;|]/.test(head)) {
      return [head, line.slice(colon + 1)];
    }
  }

  // Two or more spaces: what a fixed-width or PDF table leaves behind.
  const gap = line.search(/\s{2,}/);
  if (gap > 0) {
    const rest = line.slice(gap).replace(/^\s+/, "");
    return [line.slice(0, gap), rest];
  }

  return null;
}

/**
 * Read a pasted block into pairs. A line with no separator becomes a label
 * with no value rather than being dropped — the merchant pasted it for a
 * reason, and an empty box beside it is easier to finish than to notice a
 * missing row.
 */
export function parseSpecificationsPaste(text: string): ParsedSpecification[] {
  const rows: ParsedSpecification[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rows.length >= MAX_PASTED_SPECIFICATIONS) break;
    // A table copied from a page often indents; a trailing tab is an empty
    // third column.
    const line = rawLine.trim();
    if (!line) continue;
    const split = splitRow(line);
    const name = (split ? split[0] : line).trim().slice(0, MAX_NAME);
    const value = (split ? split[1] : "").trim().slice(0, MAX_VALUE);
    if (!name && !value) continue;
    rows.push({ name, value });
  }
  return rows;
}

/**
 * Whether this paste should fill the table rather than land in the box it
 * was dropped into.
 *
 * Into a LABEL box, one line that carries a separator is still a paste
 * worth reading — "Brand: Apple" fills both halves of the row. Into a
 * VALUE box it is not: a value holds colons and spaces of its own, and
 * splitting it would be wrong more often than right. Either way, more than
 * one line is always a table.
 */
export function isSpecificationPaste(
  text: string,
  field: "name" | "value",
): boolean {
  if (!text.trim()) return false;
  const rows = parseSpecificationsPaste(text);
  if (rows.length > 1) return true;
  if (rows.length === 0) return false;
  return field === "name" ? rows[0].value.length > 0 : text.includes("\t");
}

/**
 * The rows a paste leaves behind: what was there, with the pasted pairs
 * written from `index` on.
 *
 * Pasting into a row REPLACES it and pushes the rest down, so pasting into
 * the last empty row of a half-filled table appends, and pasting into the
 * first row of an empty one fills it — both without leaving the blank row
 * the merchant pasted into stranded in the middle.
 */
export function applySpecificationPaste(
  current: ParsedSpecification[],
  index: number,
  pasted: ParsedSpecification[],
): ParsedSpecification[] {
  const at = Math.max(0, Math.min(index, current.length));
  const before = current.slice(0, at);
  const after = current.slice(at + 1);
  const rows = [...before, ...pasted, ...after];
  // A row the merchant never filled, left over from "Add specification",
  // is not content — drop the empties except when that would leave none.
  const filled = rows.filter((row) => row.name.trim() || row.value.trim());
  return (filled.length > 0 ? filled : [{ name: "", value: "" }]).slice(
    0,
    MAX_PASTED_SPECIFICATIONS,
  );
}
