/**
 * Edits to a smart block's own settings (docs/INVOICE_TEMPLATE_BUILDER.md
 * §5.7): the field lists of the header, address, order summary and delivery
 * blocks; the columns of a product table and the fields of product rows; the
 * rows of a price summary; and the page-flow settings of a repeating block.
 *
 * Everything is a pure function of the lists / the element, so the panel can
 * apply it to the element's latest copy. Each returns the same reference
 * when nothing changes. Lists keep the schema's rules (schema.ts): a key at
 * most once, at least one column / field / row, column widths adding up to
 * at most 100 %.
 *
 * Pure and client-safe.
 */
import type { ItemFieldKey } from "../field-keys";
import {
  PRICE_SUMMARY_ROWS,
  type BlockField,
  type ElementConfigMap,
  type FlowConfig,
  type PriceSummaryRow,
  type ProductColumn,
  type TemplateElement,
} from "../types";

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/** A list with the item at `from` moved to `to` (the same list when nothing moves). */
export function arrayMove<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from === to || from < 0 || from >= next.length) return next;
  const target = Math.min(Math.max(to, 0), next.length - 1);
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item!);
  return next;
}

// ---------------------------------------------------------------------------
// Field lists (business header, customer address, order summary, delivery)
// ---------------------------------------------------------------------------

/** One line of a field list as the panel shows it. */
export interface FieldRow<K extends string = string> {
  key: K;
  visible: boolean;
  label?: string;
  /** False for a field the block's config doesn't list yet (it shows as hidden). */
  stored: boolean;
  /** False when the template's category has no data for the field. */
  available: boolean;
}

/**
 * Every field the block can show, in the order to list them: the ones the
 * config already lists (in its order, even if this category has no data for
 * them), then the others as hidden rows, so nothing the block could print is
 * out of reach.
 */
export function fieldRows<K extends string>(
  fields: readonly BlockField<K>[],
  allKeys: readonly K[],
  isAvailable: (key: K) => boolean = () => true,
): FieldRow<K>[] {
  const rows: FieldRow<K>[] = fields.map((field) => ({
    key: field.key,
    visible: field.visible,
    ...(field.label !== undefined ? { label: field.label } : {}),
    stored: true,
    available: isAvailable(field.key),
  }));
  for (const key of allKeys) {
    if (!rows.some((row) => row.key === key) && isAvailable(key)) rows.push({ key, visible: false, stored: false, available: true });
  }
  return rows;
}

/** The config's field list for these rows (every row becomes an entry; an empty label is no label). */
export function rowsToFields<K extends string>(rows: readonly FieldRow<K>[]): BlockField<K>[] {
  return rows.map((row) => ({ key: row.key, visible: row.visible, ...(row.label ? { label: row.label } : {}) }));
}

const mapRow = <K extends string>(rows: readonly FieldRow<K>[], key: K, change: (row: FieldRow<K>) => FieldRow<K>) =>
  rows.map((row) => (row.key === key ? change(row) : row));

export const setRowVisible = <K extends string>(rows: readonly FieldRow<K>[], key: K, visible: boolean) =>
  mapRow(rows, key, (row) => (row.visible === visible ? row : { ...row, visible, stored: true }));

export function setRowLabel<K extends string>(rows: readonly FieldRow<K>[], key: K, label: string) {
  return mapRow(rows, key, (row) => {
    const { label: _old, ...rest } = row;
    return label ? { ...rest, label, stored: true } : { ...rest, stored: row.stored };
  });
}

export function moveRow<K extends string>(rows: readonly FieldRow<K>[], key: K, to: number) {
  return arrayMove(rows, rows.findIndex((row) => row.key === key), to);
}

// ---------------------------------------------------------------------------
// Product table columns
// ---------------------------------------------------------------------------

const MONEY_COLUMNS: readonly ItemFieldKey[] = [
  "item.unitPrice",
  "item.compareAtPrice",
  "item.lineDiscount",
  "item.lineTotal",
  "item.tax",
  "item.totalWithTax",
];

/** A new column of a field: money to the right, the quantity centred, the rest to the left. */
export function newColumn(key: ItemFieldKey): ProductColumn {
  return { key, align: MONEY_COLUMNS.includes(key) ? "right" : key === "item.qty" ? "center" : "left" };
}

export function addColumn(columns: readonly ProductColumn[], key: ItemFieldKey): ProductColumn[] {
  if (columns.some((column) => column.key === key)) return [...columns];
  return [...columns, newColumn(key)];
}

/** Without the column at `index`; the last column stays (a table needs one). */
export function removeColumn(columns: readonly ProductColumn[], index: number): ProductColumn[] {
  if (columns.length <= 1 || index < 0 || index >= columns.length) return [...columns];
  return columns.filter((_, at) => at !== index);
}

/** A column with fields changed; `undefined` removes `label` / `widthPct` (back to automatic). */
export function patchColumn(
  columns: readonly ProductColumn[],
  index: number,
  patch: { [K in keyof ProductColumn]?: ProductColumn[K] | undefined },
): ProductColumn[] {
  return columns.map((column, at) => {
    if (at !== index) return column;
    const next = { ...column, ...patch } as ProductColumn;
    if (next.label === undefined || next.label === "") delete next.label;
    if (next.widthPct === undefined) delete next.widthPct;
    return next;
  });
}

/** The widths the columns claim, in percent (automatic columns claim none). */
export function columnWidthTotal(columns: readonly ProductColumn[]): number {
  return Math.round(columns.reduce((sum, column) => sum + (column.widthPct ?? 0), 0) * 10) / 10;
}

/** The narrowest width a column may claim (the schema's minimum). */
export const MIN_COLUMN_WIDTH = 1;

/**
 * The most a column may claim without the widths passing 100 % (the schema's
 * rule): what the other columns leave, 0 when they already take it all. It can
 * be under `MIN_COLUMN_WIDTH`; then no width fits (`canSetColumnWidth`).
 */
export function maxColumnWidth(columns: readonly ProductColumn[], index: number): number {
  const others = columns.reduce((sum, column, at) => (at === index ? sum : sum + (column.widthPct ?? 0)), 0);
  return Math.max(0, Math.floor((100 - Math.round(others * 10) / 10) * 10) / 10);
}

/** Whether the column at `index` can be given a width: the others leave at least the minimum. */
export function canSetColumnWidth(columns: readonly ProductColumn[], index: number): boolean {
  return maxColumnWidth(columns, index) >= MIN_COLUMN_WIDTH;
}

/**
 * The columns with one width set, capped at what the others leave; `undefined`
 * clears it (automatic). When the others leave less than the minimum, nothing
 * changes: the total never passes 100 %.
 */
export function setColumnWidth(columns: readonly ProductColumn[], index: number, widthPct: number | undefined): ProductColumn[] {
  if (widthPct === undefined) return patchColumn(columns, index, { widthPct: undefined });
  if (!canSetColumnWidth(columns, index)) return [...columns];
  const capped = Math.min(Math.max(widthPct, MIN_COLUMN_WIDTH), maxColumnWidth(columns, index));
  return patchColumn(columns, index, { widthPct: capped });
}

// ---------------------------------------------------------------------------
// Product rows fields
// ---------------------------------------------------------------------------

export function addRowsField(fields: readonly ItemFieldKey[], key: ItemFieldKey): ItemFieldKey[] {
  return fields.includes(key) ? [...fields] : [...fields, key];
}

export function removeRowsField(fields: readonly ItemFieldKey[], key: ItemFieldKey): ItemFieldKey[] {
  return fields.length <= 1 ? [...fields] : fields.filter((each) => each !== key);
}

// ---------------------------------------------------------------------------
// Price summary rows
// ---------------------------------------------------------------------------

/** A new row: what the block starts with for that figure (§5.3). */
export function newPriceRow(key: PriceSummaryRow["key"]): PriceSummaryRow {
  return {
    key,
    hideWhenZero: key === "discount" || key === "paid" || key === "tax" || key === "duty",
    asDeduction: key === "discount" || key === "paid",
    bold: key === "total" || key === "due",
  };
}

export function addPriceRow(rows: readonly PriceSummaryRow[], key: PriceSummaryRow["key"]): PriceSummaryRow[] {
  return rows.some((row) => row.key === key) ? [...rows] : [...rows, newPriceRow(key)];
}

export function removePriceRow(rows: readonly PriceSummaryRow[], key: PriceSummaryRow["key"]): PriceSummaryRow[] {
  return rows.length <= 1 ? [...rows] : rows.filter((row) => row.key !== key);
}

/** The figures a summary can still list. */
export function missingPriceRows(rows: readonly PriceSummaryRow[]): PriceSummaryRow["key"][] {
  return PRICE_SUMMARY_ROWS.filter((key) => !rows.some((row) => row.key === key));
}

export function patchPriceRow(
  rows: readonly PriceSummaryRow[],
  key: PriceSummaryRow["key"],
  patch: { [K in keyof PriceSummaryRow]?: PriceSummaryRow[K] | undefined },
): PriceSummaryRow[] {
  return rows.map((row) => {
    if (row.key !== key) return row;
    const next = { ...row, ...patch } as PriceSummaryRow;
    if (next.label === undefined || next.label === "") delete next.label;
    return next;
  });
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

/** The element with some of its block settings changed (the same element when nothing differs). */
export function withConfig<T extends TemplateElement>(element: T, patch: Partial<ElementConfigMap[T["type"]]>): T {
  const config = element.config as Record<string, unknown>;
  const changes = patch as Record<string, unknown>;
  const same = Object.keys(changes).every((key) => Object.is(config[key], changes[key]) || JSON.stringify(config[key]) === JSON.stringify(changes[key]));
  if (same) return element;
  return { ...element, config: { ...config, ...changes } } as T;
}

/** The element with its page-flow settings changed; `undefined` removes an optional value. */
export function withFlow(
  element: TemplateElement,
  patch: { [K in keyof FlowConfig]?: FlowConfig[K] | undefined },
): TemplateElement {
  if (!element.flow) return element;
  const next: FlowConfig = { ...element.flow, ...(patch as Partial<FlowConfig>) };
  if (next.continuationTopMm === undefined) delete next.continuationTopMm;
  if (next.rowsPerPage) {
    const rows = { ...next.rowsPerPage };
    for (const key of ["first", "middle", "last"] as const) if (rows[key] === undefined) delete rows[key];
    if (Object.keys(rows).length === 0) delete next.rowsPerPage;
    else next.rowsPerPage = rows;
  } else {
    delete next.rowsPerPage;
  }
  if (JSON.stringify(next) === JSON.stringify(element.flow)) return element;
  return { ...element, flow: next } as TemplateElement;
}

/** The element's rows-per-page value for one kind of page, with `undefined` = automatic. */
export function withRowsPerPage(element: TemplateElement, page: "first" | "middle" | "last", value: number | undefined): TemplateElement {
  if (!element.flow) return element;
  return withFlow(element, { rowsPerPage: { ...(element.flow.rowsPerPage ?? {}), [page]: value } });
}

/** A line turned the other way: its box turns with it, so it still shows (the thickness stays). */
export function withLineOrientation(element: TemplateElement, orientation: "horizontal" | "vertical"): TemplateElement {
  if (element.type !== "line" || element.config.orientation === orientation) return element;
  return { ...element, widthMm: element.heightMm, heightMm: element.widthMm, config: { ...element.config, orientation } };
}

/** The element with one setting removed from its config (an optional value cleared). */
export function withoutConfigKey<T extends TemplateElement>(element: T, key: string): T {
  const config = element.config as Record<string, unknown>;
  if (!(key in config)) return element;
  const { [key]: _removed, ...rest } = config;
  return { ...element, config: rest } as T;
}
