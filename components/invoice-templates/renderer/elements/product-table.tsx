import type { CSSProperties } from "react";
import { itemFieldLabel, itemFieldText } from "@/lib/invoice-templates/bindings";
import {
  blockChromeMm,
  estimateRowMeasure,
  rowsThatFit,
  TABLE_CELL_PADDING_MM,
  type FlowingElement,
  type PlacedElement,
} from "@/lib/invoice-templates/pagination";
import type { ContextItem, PrintContext } from "@/lib/invoice-templates/context-types";
import { bindingOptions } from "../render-context";
import { mm } from "../styles";
import type { ElementRenderProps } from "../types";

/** Which rows a page shows: the pagination's slice, or what fits when the block doesn't flow. */
export function visibleRows(props: {
  element: FlowingElement;
  placed: PlacedElement;
  context: Pick<PrintContext, "items">;
}): { start: number; end: number; header: boolean } {
  const { element, placed, context } = props;
  const total = context.items.length;
  if (placed.rows) return { start: placed.rows.start, end: Math.min(placed.rows.end, total), header: placed.rows.header };
  const measure = estimateRowMeasure(element, total);
  const capacity = placed.heightMm - blockChromeMm(element) - measure.headerMm;
  return { start: 0, end: rowsThatFit(measure, 0, capacity), header: measure.headerMm > 0 };
}

/** Columns of item fields, with a header, grid or row lines, stripes and wrap or one-line cells (§5.7). */
export function ProductTableElement(props: ElementRenderProps<"productTable">) {
  const { element, context, design } = props;
  const options = bindingOptions(element, design);
  const { columns, lines, headerFill, headerColor, stripeColor, cells } = element.config;
  const rows = visibleRows(props);
  const borderColor = element.style.borderColor || "#cccccc";
  const cellBorder: CSSProperties =
    lines === "grid"
      ? { border: `1px solid ${borderColor}` }
      : lines === "rows"
        ? { borderBottom: `1px solid ${borderColor}` }
        : {};
  const cell: CSSProperties = {
    padding: mm(TABLE_CELL_PADDING_MM),
    verticalAlign: "top",
    ...cellBorder,
    ...(cells === "oneLine" ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } : { overflowWrap: "anywhere" }),
  };
  const cellText = (column: (typeof columns)[number], item: ContextItem) => {
    const text = itemFieldText(column.key, item, context, options);
    if (column.key === "item.image") {
      return text ? (
        // eslint-disable-next-line @next/next/no-img-element -- printed markup
        <img src={text} alt="" draggable={false} style={{ display: "block", height: "2em", width: "auto" }} />
      ) : null;
    }
    return text;
  };
  return (
    <table className="it-table" style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", fontSize: "inherit" }}>
      <colgroup>
        {columns.map((column, index) => (
          <col key={`${column.key}-${index}`} style={column.widthPct ? { width: `${column.widthPct}%` } : undefined} />
        ))}
      </colgroup>
      {rows.header && (
        <thead>
          <tr className="it-header">
            {columns.map((column, index) => (
              <th
                key={`${column.key}-${index}`}
                style={{ ...cell, textAlign: column.align, fontWeight: 700, background: headerFill || undefined, color: headerColor || undefined }}
              >
                {column.label ?? itemFieldLabel(column.key, options.locale)}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {context.items.slice(rows.start, rows.end).map((item, index) => (
          <tr
            key={rows.start + index}
            className="it-row"
            data-row={rows.start + index}
            style={stripeColor && index % 2 === 1 ? { background: stripeColor } : undefined}
          >
            {columns.map((column, columnIndex) => (
              <td key={`${column.key}-${columnIndex}`} style={{ ...cell, textAlign: column.align }}>
                {cellText(column, item)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
