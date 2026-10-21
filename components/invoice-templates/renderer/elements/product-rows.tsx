import { BLOCK_WORDS, itemFieldText } from "@/lib/invoice-templates/bindings";
import { formatDigits } from "@/lib/invoice-templates/formats";
import { bindingOptions } from "../render-context";
import { mm } from "../styles";
import type { ElementRenderProps } from "../types";
import { visibleRows } from "./product-table";

/** Compact one-line rows ("Jamdani saree · JAM-RED ×1"), with "+ N more" when they don't fit and flow is off (§5.7). */
export function ProductRowsElement(props: ElementRenderProps<"productRows">) {
  const { element, context, design, placed } = props;
  const options = bindingOptions(element, design);
  const { fields, quantityFormat, showMore } = element.config;
  const rows = visibleRows(props);
  const total = context.items.length;
  // Without flow, a row makes way for the "+ N more" line.
  const truncated = !placed.rows && rows.end < total;
  const end = truncated && showMore ? Math.max(0, rows.end - 1) : rows.end;
  const more = total - end;
  return (
    <div className="it-rows" style={{ display: "flex", flexDirection: "column" }}>
      {context.items.slice(rows.start, end).map((item, index) => {
        const parts: string[] = [];
        for (const key of fields) {
          if (key === "item.qty") {
            const qty = formatDigits(String(item.qty), options.format.digits);
            parts.push(quantityFormat === "pcs" ? `${qty} ${BLOCK_WORDS.pcs[options.locale]}` : `×${qty}`);
            continue;
          }
          const text = itemFieldText(key, item, context, options);
          if (text !== null && key !== "item.image") parts.push(text);
        }
        return (
          <div key={rows.start + index} className="it-row" data-row={rows.start + index} style={{ paddingBottom: mm(element.style.gapMm), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {parts.join(" · ")}
          </div>
        );
      })}
      {truncated && showMore && more > 0 && (
        <div className="it-rows-more" style={{ fontStyle: "italic" }}>
          {formatDigits(BLOCK_WORDS.moreRows[options.locale](more), options.format.digits)}
        </div>
      )}
    </div>
  );
}
